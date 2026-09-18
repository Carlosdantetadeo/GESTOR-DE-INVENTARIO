// Proxy de transcripción de voz (Groq Whisper). La API key vive SOLO en el
// server (API_GROQ), nunca en el cliente. Si no está configurada, responde
// 501 y el cliente cae al registro manual por búsqueda (offline-first).
import { NextResponse } from 'next/server'

export async function POST(request) {
  const key = process.env.API_GROQ
  if (!key) {
    return NextResponse.json({ error: 'transcripcion_no_configurada' }, { status: 501 })
  }

  const form = await request.formData()
  const audio = form.get('audio')
  if (!audio) {
    return NextResponse.json({ error: 'sin_audio' }, { status: 400 })
  }

  // Groq detecta el formato por la extensión. El navegador puede grabar en webm
  // (Android/Chrome) o mp4 (iPhone/Safari): mandamos la extensión real para que
  // Whisper no rechace el audio. audio/webm;codecs=opus → webm ; audio/mp4 → mp4
  const sub = (audio.type || '').split(';')[0].split('/')[1]
  const ext = ['webm', 'mp4', 'm4a', 'ogg', 'wav', 'mpeg', 'mp3'].includes(sub) ? sub : 'webm'

  const groqForm = new FormData()
  groqForm.append('file', audio, `audio.${ext}`)
  groqForm.append('model', 'whisper-large-v3')
  groqForm.append('language', 'es')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: groqForm,
  })

  if (!res.ok) {
    const detalle = await res.text().catch(() => '')
    console.error('groq transcripcion error', res.status, detalle)
    return NextResponse.json({ error: 'groq_error' }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json({ texto: data.text ?? '' })
}
