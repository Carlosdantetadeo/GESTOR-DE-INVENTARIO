// Extracción de ítems de una foto de factura (Groq Vision). Key SOLO en server.
// Si no está configurada, responde 501 y el cliente lo informa. El modelo es
// configurable por env (GROQ_VISION_MODEL) para no atarse a un nombre puntual.
import { NextResponse } from 'next/server'

const PROMPT =
  'Sos un extractor de facturas de compra de repuestos/autopartes. ' +
  'Devolvé SOLO un JSON array (sin texto extra, sin markdown) con un objeto por ' +
  'ítem: {"descripcion": string, "cantidad": number, "precio_unitario": number}. ' +
  'Si un dato no está, poné null.'

export async function POST(request) {
  const key = process.env.API_GROQ
  if (!key) {
    return NextResponse.json({ error: 'ocr_no_configurado' }, { status: 501 })
  }

  const form = await request.formData()
  const imagen = form.get('imagen')
  if (!imagen) {
    return NextResponse.json({ error: 'sin_imagen' }, { status: 400 })
  }

  const base64 = Buffer.from(await imagen.arrayBuffer()).toString('base64')
  const dataUrl = `data:${imagen.type || 'image/jpeg'};base64,${base64}`
  const model = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'groq_error' }, { status: 502 })
  }

  const data = await res.json()
  const texto = data.choices?.[0]?.message?.content ?? '[]'
  return NextResponse.json({ items: parseItems(texto) })
}

// Extrae el JSON array del texto del modelo, tolerante a envoltorios/markdown.
function parseItems(texto) {
  try {
    const match = texto.match(/\[[\s\S]*\]/)
    const arr = JSON.parse(match ? match[0] : texto)
    if (!Array.isArray(arr)) return []
    return arr.map((it) => ({
      descripcion: String(it.descripcion ?? '').trim(),
      cantidad: it.cantidad ?? null,
      precio_unitario: it.precio_unitario ?? null,
    })).filter((it) => it.descripcion)
  } catch {
    return []
  }
}
