// POST /api/superadmin/modelos/migrar
// Reasigna todas las empresas de un modelo a otro.
// Body: { from: string, to: string }

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { migrarEmpresasModelo } from '@/lib/superadmin/data'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const { from, to } = await request.json().catch(() => ({}))
  if (!from || !to || from === to) {
    return NextResponse.json({ ok: false, message: 'Faltan from/to o son iguales.' }, { status: 400 })
  }
  const res = await migrarEmpresasModelo(from, to)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
