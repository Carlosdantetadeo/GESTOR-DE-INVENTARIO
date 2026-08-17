// Genera embeddings de texto con HuggingFace (para búsqueda semántica de productos).
// La key vive SOLO en el server (HUGGING_API). Si no está, responde 501.
// Modelo multilingüe por defecto (español), configurable por env HF_EMBED_MODEL.
import { NextResponse } from 'next/server'

const MODEL = process.env.HF_EMBED_MODEL || 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'

export async function POST(request) {
  const key = process.env.HUGGING_API
  if (!key) return NextResponse.json({ error: 'embeddings_no_configurado' }, { status: 501 })

  const { textos } = await request.json().catch(() => ({}))
  const inputs = Array.isArray(textos) ? textos : textos ? [textos] : []
  if (!inputs.length) return NextResponse.json({ error: 'sin_texto' }, { status: 400 })

  // HF migró la Inference API al router (api-inference.huggingface.co ya no resuelve).
  const res = await fetch(`https://router.huggingface.co/hf-inference/models/${MODEL}/pipeline/feature-extraction`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs }),
  })

  if (!res.ok) {
    const detalle = await res.text().catch(() => '')
    console.error('hf embeddings error', res.status, detalle)
    return NextResponse.json({ error: 'hf_error', status: res.status, detalle: detalle.slice(0, 200) }, { status: 502 })
  }

  const data = await res.json()
  const vectores = inputs.map((_, i) => aVector(inputs.length === 1 ? data : data[i]))
  return NextResponse.json({ vectores, dim: vectores[0]?.length ?? 0, model: MODEL })
}

// Normaliza la respuesta a un vector plano. sentence-transformers ya devuelve el
// embedding de oración (1D). Si llegan embeddings por token (2D), promedia (mean-pool).
function aVector(x) {
  if (Array.isArray(x) && Array.isArray(x[0])) {
    const dim = x[0].length
    const out = new Array(dim).fill(0)
    for (const tok of x) for (let d = 0; d < dim; d++) out[d] += tok[d]
    return out.map((v) => v / x.length)
  }
  return x
}
