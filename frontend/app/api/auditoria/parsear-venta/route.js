// Interpreta una frase de venta hablada (Groq NLU) → { descripcion, cantidad, precio }.
// La key vive SOLO en el server (API_GROQ). Si no está configurada responde 501 y
// el cliente cae al registro manual por búsqueda de texto. El precio es UNITARIO.
import { NextResponse } from 'next/server'

const PROMPT =
  'Sos un asistente que interpreta frases de venta de una ferretería/mayorista en español latinoamericano. ' +
  'De la frase del vendedor extraé el producto, la cantidad y el precio unitario. ' +
  'Devolvé SOLO un JSON sin texto extra ni markdown: {"descripcion": string, "cantidad": number|null, "precio": number|null}.\n' +
  'EJEMPLOS:\n' +
  '"vendí tres bolsas de cemento a quince soles" → {"descripcion":"bolsa de cemento","cantidad":3,"precio":15}\n' +
  '"cinco metros de cable por veinte" → {"descripcion":"cable","cantidad":5,"precio":20}\n' +
  '"salida de dos cajas de tornillos a diez cincuenta" → {"descripcion":"caja de tornillos","cantidad":2,"precio":10.5}\n' +
  '"una llave francesa" → {"descripcion":"llave francesa","cantidad":1,"precio":null}\n' +
  '"pintura blanca" → {"descripcion":"pintura blanca","cantidad":null,"precio":null}\n' +
  'REGLAS:\n' +
  '- "descripcion": solo el nombre limpio del producto, sin verbos, cantidades ni precios.\n' +
  '- "cantidad": unidades vendidas. Si dice "un/una" → 1.\n' +
  '- "precio": valor UNITARIO. Si dice "cinco a diez soles" → cantidad=5, precio=10.\n' +
  '- Convertí números escritos en palabras: uno→1, dos→2, tres→3, diez→10, veinte→20, etc.\n' +
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
