import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

// URL de la Edge Function onboarding, derivada de NEXT_PUBLIC_SUPABASE_URL
// (que puede traer /rest, /auth, etc. de más).
function onboardingUrl() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const base = raw.replace(/\/(rest|auth|storage|functions)(\/.*)?$/, '').replace(/\/$/, '')
  return `${base}/functions/v1/onboarding`
}

// POST /api/superadmin/empresa — alta de una empresa nueva.
// Proxy server-side hacia la Edge Function onboarding: agrega el secreto
// (ONBOARDING_SECRET) que el browser nunca ve. Solo superadmin autenticado.
export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const empresa_nombre = String(body.empresa_nombre ?? '').trim()
  const rubro          = String(body.rubro ?? '').trim()
  const admin_email    = String(body.admin_email ?? '').trim()
  const sedes = Array.isArray(body.sedes)
    ? body.sedes.map(s => String(s ?? '').trim()).filter(Boolean)
    : []

  if (!empresa_nombre) return NextResponse.json({ ok: false, message: 'Nombre de empresa requerido.' }, { status: 400 })
  if (!admin_email)    return NextResponse.json({ ok: false, message: 'Email del administrador requerido.' }, { status: 400 })
  if (sedes.length < 1) return NextResponse.json({ ok: false, message: 'Agregá al menos una sede.' }, { status: 400 })

  const secret = process.env.ONBOARDING_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, message: 'Falta ONBOARDING_SECRET en el servidor.' }, { status: 500 })
  }

  let res, data
  try {
    res = await fetch(onboardingUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        'x-onboarding-secret': secret,
      },
      body: JSON.stringify({ empresa_nombre, rubro, admin_email, sedes }),
    })
    data = await res.json().catch(() => ({}))
  } catch {
    return NextResponse.json({ ok: false, message: 'No se pudo contactar el servicio de alta.' }, { status: 502 })
  }

  if (!res.ok) {
    return NextResponse.json({ ok: false, message: data.error ?? data.message ?? `Error ${res.status}` }, { status: res.status })
  }

  return NextResponse.json({ ok: true, empresa_id: data.empresa_id, temp_password: data.temp_password })
}
