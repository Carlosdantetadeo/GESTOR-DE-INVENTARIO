// Proxy de transcripción de voz (Groq Whisper). La API key vive SOLO en el
// server (GROQ_API_KEY), nunca en el cliente. Si no está configurada, responde
// 501 y el cliente cae al registro manual por búsqueda (offline-first).
import { NextResponse } from 'next/server'

export async function POST(request) {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'transcripcion_no_configurada' }, { status: 501 })
  }

  const form = await request.formData()
  const audio = form.get('audio')
  if (!audio) {
    return NextResponse.json({ error: 'sin_audio' }, { status: 400 })
  }

  const groqForm = new FormData()
  groqForm.append('file', audio, 'audio.webm')
  groqForm.append('model', 'whisper-large-v3')
  groqForm.append('language', 'es')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: groqForm,
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'groq_error' }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json({ texto: data.text ?? '' })
}
