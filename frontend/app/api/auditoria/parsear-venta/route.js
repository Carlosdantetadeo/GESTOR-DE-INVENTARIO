// Interpreta una frase de venta hablada (Groq NLU) → { descripcion, cantidad, precio }.
// La key vive SOLO en el server (API_GROQ). Si no está configurada responde 501 y
// el cliente cae al registro manual por búsqueda de texto. El precio es UNITARIO.
import { NextResponse } from 'next/server'

const PROMPT =
  'Interpretás frases de venta habladas por un vendedor de una tienda (ropa, calzado, ferretería, etc.) en español latinoamericano. ' +
  'Una frase puede contener UNO O VARIOS productos (separados por "y", comas o enumerados). ' +
  'Devolvé SOLO un JSON sin texto extra ni markdown: {"items":[{"descripcion": string, "cantidad": number|null, "precio": number|null}]}. Un objeto por producto.\n' +
  'Muchos productos se identifican por un CÓDIGO (letras y números juntos, ej. "EM0021" o "EM0021-M4") y una TALLA (ej. "T-39", "T40", "talla 40"). ' +
  'Los dígitos que forman parte del CÓDIGO o de la TALLA NO son la cantidad ni el precio.\n' +
  'A veces el vendedor dicta las LETRAS del código por su nombre (equis→X, eme→M, be→B, ce→C, de→D, efe→F, ge→G, jota→J, ka→K, ele→L, ene→N, pe→P, ere/erre→R, ese→S, te→T, uve/ve→V, doble ve→W, zeta→Z, i griega→Y). Reconstruí el código con esas letras.\n' +
  'EJEMPLOS:\n' +
  '"15 EM0021 talla 40 a 20 soles cada uno" → {"items":[{"descripcion":"EM0021 T40","cantidad":15,"precio":20}]}\n' +
  '"un par equis 4444 eme 5 talla 43 a 80 soles" → {"items":[{"descripcion":"X4444-M5 T-43","cantidad":1,"precio":80}]}\n' +
  '"5 polos EM0021 a 20 y 3 gorras EM0034 a 15" → {"items":[{"descripcion":"polo EM0021","cantidad":5,"precio":20},{"descripcion":"gorra EM0034","cantidad":3,"precio":15}]}\n' +
  '"dos EM0034 T38 a diez cincuenta" → {"items":[{"descripcion":"EM0034 T38","cantidad":2,"precio":10.5}]}\n' +
  '"una llave francesa" → {"items":[{"descripcion":"llave francesa","cantidad":1,"precio":null}]}\n' +
  'REGLAS:\n' +
  '- "descripcion": el producto tal como se menciona; INCLUÍ el código y la talla si los dice. Sin verbos, cantidad, precio ni palabras como "soles" o "cada uno".\n' +
  '- "cantidad": unidades vendidas. Si dice "un/una" → 1.\n' +
  '- "precio": valor UNITARIO. Es el número junto a "soles" o después de "a"/"por". "cada uno" indica que es unitario.\n' +
  '- Convertí números escritos en palabras: uno→1, dos→2, quince→15, veinte→20, etc.\n' +
  '- Los dígitos pegados a letras (EM0021, T40, M4) son parte del producto, NUNCA cantidad ni precio.\n' +
  '- Si un dato no está en la frase, poné null.'

export async function POST(request) {
  const key = process.env.API_GROQ
  if (!key) {
    return NextResponse.json({ error: 'nlu_no_configurado' }, { status: 501 })
  }

  const { texto, instrucciones } = await request.json().catch(() => ({}))
  if (!texto || !texto.trim()) {
    return NextResponse.json({ error: 'sin_texto' }, { status: 400 })
  }

  // Instrucciones del rubro de la empresa (se agregan al prompt base si vienen).
  const system = instrucciones && String(instrucciones).trim()
    ? `${PROMPT}\n\nCONTEXTO DE ESTA TIENDA (aplicá estas reglas del rubro):\n${String(instrucciones).trim()}`
    : PROMPT

  const model = process.env.GROQ_NLU_MODEL || 'llama-3.3-70b-versatile'

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: texto },
      ],
    }),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'groq_error' }, { status: 502 })
  }

  const data = await res.json()
  const contenido = data.choices?.[0]?.message?.content ?? '{}'
  return NextResponse.json(parseVenta(contenido))
}

// Extrae los ítems del texto del modelo, tolerante a envoltorios/markdown.
// Devuelve { items:[...] } y además el primer ítem en plano (descripcion/cantidad/
// precio) para compatibilidad con los clientes que esperan un solo producto.
function parseVenta(texto) {
  try {
    const match = texto.match(/\{[\s\S]*\}/)
    const obj = JSON.parse(match ? match[0] : texto)
    const arr = Array.isArray(obj.items) ? obj.items : (obj.descripcion ? [obj] : [])
    const items = arr
      .map((it) => ({
        descripcion: String(it.descripcion ?? '').trim(),
        cantidad: numeroONull(it.cantidad),
        precio: numeroONull(it.precio),
      }))
      .filter((it) => it.descripcion)
    const first = items[0] ?? { descripcion: '', cantidad: null, precio: null }
    return { items, descripcion: first.descripcion, cantidad: first.cantidad, precio: first.precio }
  } catch {
    return { items: [], descripcion: '', cantidad: null, precio: null }
  }
}

function numeroONull(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
