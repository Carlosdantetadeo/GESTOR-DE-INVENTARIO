import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { getModelosNlu, crearModelo } from '@/lib/superadmin/data'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

// GET  /api/superadmin/modelos        → lista el catálogo
// POST /api/superadmin/modelos        → crea un modelo
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const modelos = await getModelosNlu()
  return NextResponse.json({ ok: true, modelos })
}

export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const res = await crearModelo(body)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
