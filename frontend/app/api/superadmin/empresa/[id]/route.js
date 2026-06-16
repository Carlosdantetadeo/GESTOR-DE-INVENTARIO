import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { updateEmpresaModelo } from '@/lib/superadmin/data'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

// PATCH /api/superadmin/empresa/[id]  body: { modelo }
// Cambia el modelo NLU activo de una empresa (service role, bypassa RLS).
export async function PATCH(request, { params }) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const { modelo } = await request.json().catch(() => ({}))
  const res = await updateEmpresaModelo(params.id, modelo)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
