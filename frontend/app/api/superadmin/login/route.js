import { NextResponse } from 'next/server'
import { signSession, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/superadmin/session'

// Valida email + password contra las env vars del proveedor y, si coinciden,
// firma una cookie de sesión superadmin (HMAC) válida por 8h.
export async function POST(request) {
  const { email, password } = await request.json().catch(() => ({}))

  const EMAIL  = process.env.SUPERADMIN_EMAIL
  const PASS   = process.env.SUPERADMIN_PASSWORD
  const SECRET = process.env.SUPERADMIN_SECRET
  if (!EMAIL || !PASS || !SECRET) {
    return NextResponse.json({ ok: false, message: 'Panel superadmin no configurado.' }, { status: 500 })
  }

  const ok = typeof email === 'string' && typeof password === 'string'
    && email.trim().toLowerCase() === EMAIL.trim().toLowerCase()
    && password === PASS
  if (!ok) {
    return NextResponse.json({ ok: false, message: 'Credenciales incorrectas.' }, { status: 401 })
  }

  const token = await signSession({ sub: 'superadmin', exp: Date.now() + SESSION_TTL_MS }, SECRET)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
  return res
}
