// Interpreta una frase de venta hablada (Groq NLU) → { descripcion, cantidad, precio }.
// La key vive SOLO en el server (API_GROQ). Si no está configurada responde 501 y
// el cliente cae al registro manual por búsqueda de texto. El precio es UNITARIO.
import { NextResponse } from 'next/server'

const PROMPT =
  'Sos un asistente que interpreta frases de venta de una ferretería/repuestos en español. ' +
  'De la frase del vendedor extraé UN producto y devolvé SOLO un JSON (sin texto extra, sin markdown): ' +
  '{"descripcion": string, "cantidad": number|null, "precio": number|null}. ' +
  'Reglas: "descripcion" es SOLO el nombre del producto (sin verbos como "vendí", sin cantidades ni precios). ' +
  '"cantidad" es cuántas unidades. "precio" es el precio por unidad (individual), nunca el total. ' +
  'Si un dato no aparece, poné null. Interpretá números escritos en palabras (ej: "tres" → 3).'

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
