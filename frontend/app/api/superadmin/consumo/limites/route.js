// PUT /api/superadmin/consumo/limites
// Body: { empresa_id, limite_mensual_usd, accion_al_superar, modelo_degradado_id, alerta_al_pct }

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { upsertSpendLimit } from '@/lib/superadmin/data'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

export async function PUT(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const body = await request.json()
  const { empresa_id, ...datos } = body
  if (!empresa_id) {
    return NextResponse.json({ ok: false, message: 'empresa_id requerido.' }, { status: 400 })
  }
  const result = await upsertSpendLimit(empresa_id, datos)
  if (result.error) {
    return NextResponse.json({ ok: false, message: result.error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
