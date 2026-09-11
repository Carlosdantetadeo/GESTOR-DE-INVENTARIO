// POST /api/superadmin/modelos/test
// Prueba la conexión con un proveedor NLU ANTES de guardar el modelo.
// La llamada al proveedor ocurre SIEMPRE en el servidor — la API key nunca
// viaja del navegador directo al proveedor.
//
// Body:  { proveedor, api_model_id, api_key?, base_url?, modelo_id? }
// Si se envía modelo_id, usa la api_key_enc cifrada en la BD y guarda el resultado.
//
// Response: { ok, latencia_ms, error?, modelo_confirmado? }

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { getAdminClient } from '@/lib/superadmin/adminClient'
import { decryptApiKey } from '@/lib/superadmin/cryptoModelo'

const TIMEOUT_MS = 15_000

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

// Keys globales del entorno (fallback cuando el modelo no tiene key propia).
// El frontend usa API_GROQ; el bot usa GROQ_API_KEY. Se acepta cualquiera de los dos.
function globalKey(proveedor) {
  if (proveedor === 'groq')       return process.env.API_GROQ || process.env.GROQ_API_KEY || ''
  if (proveedor === 'anthropic')  return process.env.ANTHROPIC_API_KEY || ''
  if (proveedor === 'openrouter') return process.env.OPENROUTER_API_KEY || ''
  return ''
}

const OPENAI_BASE_URLS = {
  groq:       'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
}

function mapError(status, body) {
  if (status === 401) return 'API key inválida.'
  if (status === 404) return 'El modelo no existe en este proveedor.'
  if (status === 429) return 'Límite de tasa alcanzado. Intentá en unos minutos.'
  const msg = body?.error?.message || body?.error?.msg || ''
  return msg || `Error del proveedor (HTTP ${status}).`
}

async function probarConexion({ proveedor, api_model_id, api_key, base_url }) {
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  try {
    let resp, data

    // ── Anthropic ──
    if (proveedor === 'anthropic') {
      const key = api_key || globalKey('anthropic')
      if (!key) return { ok: false, error: 'No hay API key para Anthropic (configurá ANTHROPIC_API_KEY en Vercel o usá una key por modelo).' }
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: api_model_id, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
      })
      data = await resp.json().catch(() => ({}))
      if (!resp.ok) return { ok: false, error: mapError(resp.status, data) }
      return { ok: true, latencia_ms: Date.now() - t0, modelo_confirmado: data.model ?? api_model_id }
    }

    // ── OpenAI-compatible: groq / openrouter / openai-compat ──
    const rawBase = OPENAI_BASE_URLS[proveedor] ?? (base_url ?? '').replace(/\/+$/, '')
    if (!rawBase) return { ok: false, error: 'Falta la Base URL para este proveedor.' }
    const url = rawBase.endsWith('/chat/completions') ? rawBase : `${rawBase}/chat/completions`

    const fallback = proveedor === 'groq' || proveedor === 'openrouter' ? globalKey(proveedor) : ''
    const key = api_key || fallback
    if (!key) return { ok: false, error: `No hay API key para ${proveedor}. Configurá la key global en Vercel o ingresá una por modelo.` }

    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
    if (proveedor === 'openrouter') {
      headers['HTTP-Referer'] = process.env.NEXT_PUBLIC_APP_URL || 'https://almacenero.digital'
      headers['X-Title'] = 'Almacenero Digital'
    }

    resp = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers,
      body: JSON.stringify({ model: api_model_id, max_tokens: 5, temperature: 0, messages: [{ role: 'user', content: 'ping' }] }),
    })
    data = await resp.json().catch(() => ({}))
    if (!resp.ok) return { ok: false, error: mapError(resp.status, data) }
    return { ok: true, latencia_ms: Date.now() - t0, modelo_confirmado: data.model ?? api_model_id }

  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'El proveedor no respondió en 15s.' }
    const msg = String(e)
    if (msg.includes('ECONNREFUSED') || msg.includes('Connection refused')) {
      return { ok: false, error: 'No se pudo alcanzar el servidor en esa URL. ¿Está corriendo y es alcanzable desde el backend? (Vercel no puede alcanzar localhost ni IPs 192.168.x.x — usá un túnel como Cloudflare Tunnel o Tailscale).' }
    }
    return { ok: false, error: `Error de conexión: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }

  const { proveedor, api_model_id, api_key: apiKeyInput, base_url, modelo_id } = await request.json().catch(() => ({}))

  if (!proveedor || !api_model_id?.trim()) {
    return NextResponse.json({ ok: false, error: 'Faltan proveedor o api_model_id.' }, { status: 400 })
  }

  // Si se envía modelo_id, usamos la key cifrada de la BD (no el input del form).
  let resolvedKey = apiKeyInput?.trim() || ''
  if (modelo_id) {
    const supa = getAdminClient()
    const { data: modelo } = await supa.from('modelos_nlu').select('api_key_enc').eq('id', modelo_id).maybeSingle()
    if (modelo?.api_key_enc) {
      resolvedKey = (await decryptApiKey(modelo.api_key_enc)) ?? ''
    }
  }

  const resultado = await probarConexion({ proveedor, api_model_id: api_model_id.trim(), api_key: resolvedKey, base_url })

  // Si fue una prueba de modelo existente, guardar timestamp y latencia.
  if (modelo_id && resultado.ok) {
    const supa = getAdminClient()
    await supa.from('modelos_nlu').update({
      ultima_prueba_at: new Date().toISOString(),
      ultima_prueba_latencia_ms: resultado.latencia_ms,
    }).eq('id', modelo_id)
  }

  return NextResponse.json(resultado)
}
