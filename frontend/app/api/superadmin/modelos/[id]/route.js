import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { actualizarModelo, eliminarModelo } from '@/lib/superadmin/data'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

// PATCH  /api/superadmin/modelos/[id]  → edita un modelo (label, costos, activo, …)
// DELETE /api/superadmin/modelos/[id]  → elimina (bloqueado si alguna empresa lo usa)
export async function PATCH(request, { params }) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const res = await actualizarModelo(params.id, body)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}

export async function DELETE(_request, { params }) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const res = await eliminarModelo(params.id)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
