import { supabase } from './supabase'

export async function getDefaultEmpresaId() {
  const { data } = await supabase.from('empresas').select('id').limit(1).single()
  return data?.id || null
}

export async function deleteMovimiento(id) {
  const { error } = await supabase.from('movimientos').delete().eq('id', id)
  return !error
}

/**
 * Obtener los KPIs principales para el Dashboard
 */
export async function getDashboardKPIs(empresaId, tiendaId = null, range = 'today') {
  let query = supabase
    .from('movimientos')
    .select(`
      id,
      tipo,
      total,
      created_at,
      tienda_origen (id, empresa_id),
      tienda_destino (id, empresa_id)
    `)

  // Determinar rango de fecha
  const now = new Date()
  let startDate = new Date()
  if (range === 'today') {
    startDate.setHours(0, 0, 0, 0)
  } else if (range === '7d') {
    startDate.setDate(now.getDate() - 7)
  } else if (range === '30d') {
    startDate.setDate(now.getDate() - 30)
  }
  
  query = query.gte('created_at', startDate.toISOString())

  const { data, error } = await query

  if (error) {
    console.error('Error fetching KPIs:', error)
    return { ventas: 0, ingresos: 0, gastos: 0, totalMovimientos: 0 }
  }

  // Filtrar en memoria para asegurar que correspondan a la empresa y tienda correcta
  const filtered = data.filter(mov => {
    // 1. Filtrar por empresa (basado en tienda origen o destino)
    const empresaOrig = mov.tienda_origen?.empresa_id
    const empresaDest = mov.tienda_destino?.empresa_id
    const belongsToEmpresa = (empresaOrig === empresaId || empresaDest === empresaId)
    if (!belongsToEmpresa) return false

    // 2. Filtrar por tienda si está seleccionada
    if (tiendaId) {
      const isTiendaOrig = mov.tienda_origen?.id === Number(tiendaId)
      const isTiendaDest = mov.tienda_destino?.id === Number(tiendaId)
      return isTiendaOrig || isTiendaDest
    }

    return true
  })

  let ventas = 0
  let ingresos = 0
  let gastos = 0

  filtered.forEach(mov => {
    const totalVal = Number(mov.total) || 0
    if (mov.tipo === 'venta') ventas += totalVal
    else if (mov.tipo === 'ingreso') ingresos += totalVal
    else if (mov.tipo === 'gasto') gastos += totalVal
  })

  return {
    ventas,
    ingresos,
    gastos,
    totalMovimientos: filtered.length
  }
}

/**
 * Obtener lista de movimientos con filtros detallados
 */
export async function getMovimientos(empresaId, filters = {}) {
  const { tiendaId, tipo, search, limit = 50 } = filters

  let query = supabase
    .from('movimientos')
    .select(`
      id,
      tipo,
      cantidad,
      precio_unitario,
      total,
      transcripcion,
      created_at,
      productos (id, nombre, categoria_id, categorias (id, nombre)),
      tienda_origen (id, nombre, empresa_id),
      tienda_destino (id, nombre, empresa_id),
      usuarios (id, nombre)
    `)
    .order('created_at', { ascending: false })

  if (limit) {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching movimientos:', error)
    return []
  }

  // Filtrado multi-tenant y dinámico en memoria para precisión y manejo de relaciones complejas en Supabase sin triggers costosos
  return data.filter(mov => {
    // Aislamiento de empresa
    const empresaOrig = mov.tienda_origen?.empresa_id
    const empresaDest = mov.tienda_destino?.empresa_id
    if (empresaOrig !== empresaId && empresaDest !== empresaId) return false

    // Filtro por tienda
    if (tiendaId) {
      const matchOrig = mov.tienda_origen?.id === Number(tiendaId)
      const matchDest = mov.tienda_destino?.id === Number(tiendaId)
      if (!matchOrig && !matchDest) return false
    }

    // Filtro por tipo
    if (tipo && mov.tipo !== tipo) return false

    // Filtro por término de búsqueda (producto)
    if (search) {
      const prodName = mov.productos?.nombre?.toLowerCase() || ''
      if (!prodName.includes(search.toLowerCase())) return false
    }

    return true
  })
}

/**
 * Obtener catálogo e inventario (stock)
 */
export async function getStock(empresaId, tiendaId = null) {
  let query = supabase
    .from('stock')
    .select(`
      id,
      cantidad,
      updated_at,
      tiendas (id, nombre, empresa_id),
      productos (
        id, 
        nombre, 
        ultimo_costo, 
        precio_venta_sugerido,
        categorias (id, nombre)
      )
    `)

  const { data, error } = await query

  if (error) {
    console.error('Error fetching stock:', error)
    return []
  }

  // Filtrado multi-tenant
  return data.filter(item => {
    if (item.tiendas?.empresa_id !== empresaId) return false
    if (tiendaId && item.tiendas?.id !== Number(tiendaId)) return false
    return true
  })
}

/**
 * Obtener tiendas asociadas a una empresa
 */
export async function getTiendas(empresaId) {
  const { data, error } = await supabase
    .from('tiendas')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('activa', true)

  if (error) {
    console.error('Error fetching tiendas:', error)
    return []
  }
  return data
}
