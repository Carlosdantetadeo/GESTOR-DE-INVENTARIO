// GET /api/superadmin/modelos/[id]/empresas
// Lista las empresas que tienen asignado este modelo NLU.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { getEmpresasByModelo } from '@/lib/superadmin/data'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

export async function GET(_request, { params }) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const empresas = await getEmpresasByModelo(params.id)
  return NextResponse.json({ ok: true, empresas })
}
