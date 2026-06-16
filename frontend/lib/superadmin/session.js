// Sesión del panel superadmin — token firmado con HMAC-SHA256 vía Web Crypto.
// Funciona tanto en el runtime Edge (middleware) como en Node (route handlers),
// sin dependencias npm nuevas. Formato del token:  base64url(payload).base64url(sig)
// El payload incluye `exp` (epoch ms). Sesión independiente del auth de Supabase.

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64urlFromBytes(bytes) {
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesFromB64url(s) {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(norm)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function hmacB64(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return b64urlFromBytes(new Uint8Array(sig))
}

// Comparación en tiempo (casi) constante para evitar timing attacks.
function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const SESSION_COOKIE = 'superadmin_session'
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000   // 8 horas

export async function signSession(payload, secret) {
  const body = b64urlFromBytes(enc.encode(JSON.stringify(payload)))
  const sig = await hmacB64(body, secret)
  return `${body}.${sig}`
}

// Devuelve el payload si el token es válido y no expiró; null en cualquier otro caso.
export async function verifySession(token, secret) {
  if (!token || !secret) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = await hmacB64(body, secret)
  if (!safeEqual(sig, expected)) return null
  let payload
  try { payload = JSON.parse(dec.decode(bytesFromB64url(body))) } catch { return null }
  if (!payload?.exp || Date.now() > payload.exp) return null
  return payload
}
