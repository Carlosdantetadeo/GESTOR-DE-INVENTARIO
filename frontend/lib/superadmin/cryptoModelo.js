// Cifrado de la API key por modelo (sprint 021, columna modelos_nlu.api_key_enc).
// AES-GCM-256 con clave maestra MODELOS_ENC_KEY (base64 de 32 bytes), server-only.
// Mismo formato que descifra el bot en Deno: "v1.<iv_b64>.<ct_b64>" (base64 estándar).
//
// MODELOS_ENC_KEY nunca llega al cliente: este módulo solo se importa desde la
// capa de datos del superadmin (server). Si la key no está, encrypt lanza error.

const VERSION = 'v1'

function bytesToB64(buf) {
  const arr = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i])
  return btoa(s)
}

function b64ToBytes(str) {
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importMasterKey() {
  const b64 = process.env.MODELOS_ENC_KEY
  if (!b64) throw new Error('MODELOS_ENC_KEY no está configurada.')
  const raw = b64ToBytes(b64)
  if (raw.length !== 32) throw new Error('MODELOS_ENC_KEY debe ser 32 bytes en base64.')
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// Devuelve el string cifrado, o null si no hay texto. Lanza si falta la clave maestra.
export async function encryptApiKey(plain) {
  if (!plain) return null
  const key = await importMasterKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  return `${VERSION}.${bytesToB64(iv)}.${bytesToB64(ct)}`
}

// Descifra; devuelve null si el formato/clave no calzan (no lanza).
export async function decryptApiKey(enc) {
  if (!enc) return null
  try {
    const [v, ivB64, ctB64] = String(enc).split('.')
    if (v !== VERSION || !ivB64 || !ctB64) return null
    const key = await importMasterKey()
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64),
    )
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}
