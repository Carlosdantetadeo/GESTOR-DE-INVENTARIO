import { getAdminClient } from './adminClient'

// Etiquetas y costos de referencia de los modelos NLU (solo visibles al superadmin).
export const MODELOS_NLU = [
  { id: 'groq-llama',      label: 'Groq Llama 3.3', badge: 'Recomendado', costo: '~$0.37 / 1,000 mensajes' },
  { id: 'anthropic-haiku', label: 'Claude Haiku',   badge: 'Balanceado',  costo: '~$0.80 / 1,000 mensajes' },
  { id: 'anthropic-sonnet',label: 'Claude Sonnet',  badge: 'Premium',     costo: '~$3.00 / 1,000 mensajes' },
]
export function modeloLabel(id) {
  return MODELOS_NLU.find(m => m.id === id)?.label ?? (id || '—')
}

function inicioMesUTC() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

async function ultimoMovimientoEmpresa(supa, empresaId) {
  const { data } = await supa
    .from('movimientos')
    .select('created_at, productos!inner(empresa_id)')
    .eq('productos.empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0]?.created_at ?? null
}

// Resumen para la tabla principal del superadmin: una fila por empresa.
export async function getEmpresasResumen() {
  const supa = getAdminClient()
  const desdeMes = inicioMesUTC()

  const { data: empresas } = await supa
    .from('empresas')
    .select('id, nombre, rubro, nlu_model, created_at')
    .order('created_at', { ascending: false })

  return Promise.all((empresas ?? []).map(async (e) => {
    const [{ count: operarios }, { data: consumo }, ultimoMov] = await Promise.all([
      supa.from('usuarios').select('id', { count: 'exact', head: true })
        .eq('empresa_id', e.id).eq('rol', 'vendedor'),
      supa.from('consumo_ia').select('tokens_entrada, tokens_salida, costo_usd')
        .eq('empresa_id', e.id).gte('created_at', desdeMes),
      ultimoMovimientoEmpresa(supa, e.id),
    ])

    const tokensMes = (consumo ?? []).reduce((s, c) => s + (c.tokens_entrada ?? 0) + (c.tokens_salida ?? 0), 0)
    const costoMes  = (consumo ?? []).reduce((s, c) => s + Number(c.costo_usd ?? 0), 0)

    return {
      id: e.id,
      nombre: e.nombre,
      rubro: e.rubro,
      nluModel: e.nlu_model,
      operarios: operarios ?? 0,
      tokensMes,
      costoMes,
      ultimoMovimiento: ultimoMov,
    }
  }))
}

// Detalle de una empresa: info, consumo mensual agregado y operarios.
export async function getEmpresaDetalle(empresaId) {
  const supa = getAdminClient()

  const { data: empresa } = await supa
    .from('empresas')
    .select('id, nombre, rubro, nlu_model, created_at, activa')
    .eq('id', empresaId)
    .single()
  if (!empresa) return null

  const { data: consumo } = await supa
    .from('consumo_ia')
    .select('modelo, tokens_entrada, tokens_salida, costo_usd, created_at')
    .eq('empresa_id', empresaId)

  // Agregar por mes + modelo.
  const agg = {}
  ;(consumo ?? []).forEach(c => {
    const mes = (c.created_at ?? '').slice(0, 7)   // YYYY-MM
    const k = `${mes}|${c.modelo}`
    if (!agg[k]) agg[k] = { mes, modelo: c.modelo, llamadas: 0, tokens: 0, costo: 0 }
    agg[k].llamadas += 1
    agg[k].tokens   += (c.tokens_entrada ?? 0) + (c.tokens_salida ?? 0)
    agg[k].costo    += Number(c.costo_usd ?? 0)
  })
  const consumoMensual = Object.values(agg).sort((a, b) => b.mes.localeCompare(a.mes))

  const { data: usuarios } = await supa
    .from('usuarios')
    .select('id, nombre, rol, created_at, tiendas (nombre)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })

  const operarios = await Promise.all((usuarios ?? []).map(async (u) => {
    const { data: m } = await supa
      .from('movimientos').select('created_at')
      .eq('usuario_id', u.id).order('created_at', { ascending: false }).limit(1)
    return {
      id: u.id,
      nombre: u.nombre,
      rol: u.rol,
      sede: u.tiendas?.nombre ?? 'Sin asignar',
      ultimoRegistro: m?.[0]?.created_at ?? null,
    }
  }))

  return { empresa, consumoMensual, operarios }
}

export async function updateEmpresaModelo(empresaId, modelo) {
  if (!MODELOS_NLU.some(m => m.id === modelo)) {
    return { ok: false, message: 'Modelo no válido.' }
  }
  const supa = getAdminClient()
  const { error } = await supa.from('empresas').update({ nlu_model: modelo }).eq('id', empresaId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
