// Interpreta una frase de venta hablada (Groq NLU) → { descripcion, cantidad, precio }.
// La key vive SOLO en el server (API_GROQ). Si no está configurada responde 501 y
// el cliente cae al registro manual por búsqueda de texto. El precio es UNITARIO.
import { NextResponse } from 'next/server'

const PROMPT =
  'Interpretás frases de venta habladas por un vendedor de una tienda (ropa, calzado, ferretería, etc.) en español latinoamericano. ' +
  'De la frase extraé el producto, la cantidad y el precio unitario. ' +
  'Devolvé SOLO un JSON sin texto extra ni markdown: {"descripcion": string, "cantidad": number|null, "precio": number|null}.\n' +
  'Muchos productos se identifican por un CÓDIGO (letras y números juntos, ej. "EM0021" o "EM0021-M4") y una TALLA (ej. "T-39", "T40", "talla 40"). ' +
  'Los dígitos que forman parte del CÓDIGO o de la TALLA NO son la cantidad ni el precio.\n' +
  'EJEMPLOS:\n' +
  '"15 EM0021 talla 40 a 20 soles cada uno" → {"descripcion":"EM0021 T40","cantidad":15,"precio":20}\n' +
  '"dos EM0034 T38 a diez cincuenta" → {"descripcion":"EM0034 T38","cantidad":2,"precio":10.5}\n' +
  '"vendí tres bolsas de cemento a quince soles" → {"descripcion":"bolsa de cemento","cantidad":3,"precio":15}\n' +
  '"cinco metros de cable por veinte" → {"descripcion":"cable","cantidad":5,"precio":20}\n' +
  '"una llave francesa" → {"descripcion":"llave francesa","cantidad":1,"precio":null}\n' +
  'REGLAS:\n' +
  '- "descripcion": el producto tal como se menciona; INCLUÍ el código y la talla si los dice. Sin verbos, cantidad, precio ni palabras como "soles" o "cada uno".\n' +
  '- "cantidad": unidades vendidas (suele ser el número al inicio). Si dice "un/una" → 1.\n' +
  '- "precio": valor UNITARIO. Es el número junto a "soles" o después de "a"/"por". "cada uno" indica que es unitario.\n' +
  '- Convertí números escritos en palabras: uno→1, dos→2, quince→15, veinte→20, etc.\n' +
  '- Los dígitos pegados a letras (EM0021, T40, M4) son parte del producto, NUNCA cantidad ni precio.\n' +
  '- Si un dato no está en la frase, poné null.'

export async function POST(request) {
  const key = process.env.API_GROQ
  if (!key) {
    return NextResponse.json({ error: 'nlu_no_configurado' }, { status: 501 })
  }

  const { texto } = await request.json().catch(() => ({}))
  if (!texto || !texto.trim()) {
    return NextResponse.json({ error: 'sin_texto' }, { status: 400 })
  }

  const model = process.env.GROQ_NLU_MODEL || 'llama-3.3-70b-versatile'

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PROMPT },
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

// Extrae el objeto del texto del modelo, tolerante a envoltorios/markdown.
function parseVenta(texto) {
  try {
    const match = texto.match(/\{[\s\S]*\}/)
    const obj = JSON.parse(match ? match[0] : texto)
    return {
      descripcion: String(obj.descripcion ?? '').trim(),
      cantidad: numeroONull(obj.cantidad),
      precio: numeroONull(obj.precio),
    }
  } catch {
    return { descripcion: '', cantidad: null, precio: null }
  }
}

function numeroONull(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
