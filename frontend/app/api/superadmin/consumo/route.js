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
  // Mapear al formato que espera la tabla del cliente (snake_case).
  const consumo = data.map((e) => ({
    empresa_id:          e.id,
    empresa_nombre:      e.nombre,
    modelo:              e.nluModel,
    tokens_entrada:      e.tokensEntrada,
    tokens_salida:       e.tokensSalida,
    costo_usd:           e.costoMes,
    limite_mensual_usd:  e.limiteMensual,
    accion_al_superar:   e.accionAlSuperar,
    alerta_al_pct:       e.alertaAlPct,
    modelo_degradado_id: e.modeloDegradadoId,
  }))
  return NextResponse.json({ ok: true, consumo })
}
