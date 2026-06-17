import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { updateEmpresaModelo, setEmpresaActiva } from '@/lib/superadmin/data'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

// PATCH /api/superadmin/empresa/[id]
//   body: { modelo }          → cambia el modelo NLU activo
//   body: { activa: boolean } → suspende / reactiva la empresa
// Service role, bypassa RLS.
export async function PATCH(request, { params }) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))

  if (typeof body.activa === 'boolean') {
    const res = await setEmpresaActiva(params.id, body.activa)
    return NextResponse.json(res, { status: res.ok ? 200 : 400 })
  }

  if (body.modelo !== undefined) {
    const res = await updateEmpresaModelo(params.id, body.modelo)
    return NextResponse.json(res, { status: res.ok ? 200 : 400 })
  }

  return NextResponse.json({ ok: false, message: 'Nada para actualizar.' }, { status: 400 })
}
