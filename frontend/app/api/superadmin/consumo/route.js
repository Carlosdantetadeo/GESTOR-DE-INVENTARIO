// GET /api/superadmin/consumo?mes=YYYY-MM
// Retorna consumo agregado por empresa para el mes indicado (default: mes actual).

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { getConsumoResumen } from '@/lib/superadmin/data'

async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value
  return await verifySession(token, process.env.SUPERADMIN_SECRET)
}

export async function GET(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const mes = searchParams.get('mes') || null
  const data = await getConsumoResumen(mes)
  return NextResponse.json({ ok: true, consumo: data })
}
