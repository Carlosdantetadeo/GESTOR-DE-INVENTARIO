import { supabase } from './supabase'

/** empresa_id del tenant actual (viene del JWT tras login o registro). */
export async function getEmpresaId() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user.app_metadata?.empresa_id ?? null
}

/** Nombre y rubro de la empresa (encabezados de PDF). RLS limita a la propia. */
export async function getEmpresa(empresaId) {
  const { data, error } = await supabase
    .from('empresas')
    .select('nombre, rubro')
    .eq('id', empresaId)
    .single()

  if (error) {
    console.error('Error fetching empresa:', error)
    return null
  }

  return data
}

export async function deleteMovimiento(id) {
  const { error } = await supabase.from('movimientos').delete().eq('id', id)
  return !error
}

/**
 * KPIs del Dashboard.
 * El aislamiento por empresa lo aplica RLS automáticamente con el JWT del usuario.
 * Los filtros de tienda y rango de fechas se aplican directamente en SQL.
 */
export async function getDashboardKPIs(empresaId, tiendaId = null, range = 'today') {
  const now = new Date()
  const startDate = new Date()

  if (range === 'today') {
    startDate.setHours(0, 0, 0, 0)
  } else if (range === '7d') {
    startDate.setDate(now.getDate() - 7)
  } else if (range === '30d') {
    startDate.setDate(now.getDate() - 30)
  }

  let query = supabase
    .from('movimientos')
    .select('id, tipo, total, created_at')
    .gte('created_at', startDate.toISOString())

  if (tiendaId) {
    query = query.or(`tienda_origen.eq.${tiendaId},tienda_destino.eq.${tiendaId}`)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching KPIs:', error)
    return { ventas: 0, ingresos: 0, gastos: 0, totalMovimientos: 0 }
  }

  let ventas = 0
  let ingresos = 0
  let gastos = 0

  ;(data ?? []).forEach(mov => {
    const total = Number(mov.total) || 0
    if (mov.tipo === 'venta')   ventas   += total
    else if (mov.tipo === 'ingreso') ingresos += total
    else if (mov.tipo === 'gasto')   gastos   += total
  })

  return { ventas, ingresos, gastos, totalMovimientos: (data ?? []).length }
}

/**
 * Lista de movimientos con filtros.
 * - Tienda y tipo: filtros SQL directos.
 * - Búsqueda por nombre de producto: filtro en memoria (columna de tabla relacionada,
 *   no filtreable directamente con PostgREST sin una vista o función RPC).
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
      motivo,
      created_at,
      productos (id, nombre, categorias (id, nombre)),
      tienda_origen (id, nombre),
      tienda_destino (id, nombre),
      usuarios (id, nombre)
    `)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (tiendaId) {
    query = query.or(`tienda_origen.eq.${tiendaId},tienda_destino.eq.${tiendaId}`)
  }

  if (tipo) {
    query = query.eq('tipo', tipo)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching movimientos:', error)
    return []
  }

  if (!search) return data ?? []

  const term = search.toLowerCase()
  return (data ?? []).filter(mov =>
    mov.productos?.nombre?.toLowerCase().includes(term)
  )
}

/**
 * Stock por tienda.
 * - Tienda: filtro SQL directo sobre tienda_id (columna propia de stock).
 * - Empresa: aislado por RLS automáticamente.
 */
export async function getStock(empresaId, tiendaId = null) {
  let query = supabase
    .from('stock')
    .select(`
      id,
      cantidad,
      updated_at,
      tiendas (id, nombre),
      productos (
        id,
        nombre,
        ultimo_costo,
        precio_venta_sugerido,
        stock_minimo,
        categorias (id, nombre)
      )
    `)

  if (tiendaId) {
    query = query.eq('tienda_id', tiendaId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching stock:', error)
    return []
  }

  return data ?? []
}

/**
 * Inserta los movimientos de ajuste de una sesión de conteo en un solo
 * INSERT (atómico: o entran todos o ninguno). El trigger actualiza stock
 * por cada fila. RLS (WITH CHECK sobre producto_id → productos.empresa_id)
 * garantiza que solo se aceptan productos de la empresa del usuario.
 */
export async function createAjustes(rows) {
  const { error } = await supabase
    .from('movimientos')
    .insert(rows)

  if (error) {
    console.error('Error creando ajustes:', error)
    return { ok: false, message: error.message }
  }

  return { ok: true }
}

/**
 * Actualiza campos de un producto (ej: stock_minimo desde el inline edit
 * de inventario). RLS garantiza que solo afecta productos de la empresa
 * del usuario autenticado.
 */
export async function updateProducto(productoId, fields) {
  const { error } = await supabase
    .from('productos')
    .update(fields)
    .eq('id', productoId)

  if (error) {
    console.error('Error updating producto:', error)
    return false
  }

  return true
}

/**
 * Categorías de la empresa (para el datalist del alta de producto).
 * empresa_id está en la tabla directamente → filtro SQL explícito.
 */
export async function getCategorias(empresaId) {
  const { data, error } = await supabase
    .from('categorias')
    .select('id, nombre')
    .eq('empresa_id', empresaId)
    .order('nombre')

  if (error) {
    console.error('Error fetching categorias:', error)
    return []
  }

  return data ?? []
}

/**
 * Resuelve (o crea) una categoría por nombre dentro de una empresa, case-insensitive.
 * Mismo patrón que usa el bot al auto-crear productos. Cadena vacía → 'General'.
 * Devuelve el id de categoría o null si no se pudo crear.
 */
async function resolveCategoriaId(empresaId, categoria) {
  const catName = (categoria || '').trim() || 'General'
  const { data: catExistente } = await supabase
    .from('categorias')
    .select('id')
    .eq('empresa_id', empresaId)
    .ilike('nombre', catName)
    .maybeSingle()
  if (catExistente) return catExistente.id

  const { data: catNueva, error: catErr } = await supabase
    .from('categorias')
    .insert({ nombre: catName, empresa_id: empresaId })
    .select('id')
    .single()
  if (catErr) {
    console.error('Error creando categoría:', catErr)
    return null
  }
  return catNueva?.id ?? null
}

/**
 * Alta manual de un producto. Resuelve (o crea) la categoría por nombre — mismo
 * patrón que el bot al auto-crear productos: categoría "General" por defecto.
 * RLS (WITH CHECK sobre empresa_id) garantiza que solo se inserta en la empresa
 * del admin autenticado. El choque con el unique (empresa_id, LOWER(nombre)) se
 * traduce a un mensaje amable.
 *
 * `unidad` y `precioReferencial` son del catálogo (sprint 020) y opcionales:
 * solo se escriben si vienen definidos, para no pisar el flujo de inventario.
 */
export async function createProducto(empresaId, { nombre, categoria, costo, precio, stockMinimo, unidad, precioReferencial }) {
  const categoriaId = await resolveCategoriaId(empresaId, categoria)
  if (categoriaId === null) return { ok: false, message: 'No se pudo crear la categoría.' }

  const fila = {
    nombre:                nombre.trim(),
    empresa_id:            empresaId,
    categoria_id:          categoriaId,
    ultimo_costo:          costo ?? 0,
    precio_venta_sugerido: precio ?? 0,
    stock_minimo:          stockMinimo ?? 5,
  }
  if (unidad !== undefined)           fila.unidad = (unidad || 'und')
  if (precioReferencial !== undefined) fila.precio_referencial = precioReferencial

  const { data, error } = await supabase
    .from('productos')
    .insert(fila)
    .select('id')
    .single()

  if (error) {
    console.error('Error creando producto:', error)
    const dup = error.code === '23505'
    return { ok: false, message: dup ? 'Ya existe un producto con ese nombre en tu catálogo.' : error.message }
  }

  return { ok: true, id: data.id }
}

/**
 * Catálogo de productos de la empresa con su stock total agregado (todas las
 * tiendas). RLS limita a la empresa del usuario. El stock se suma en memoria
 * a partir de la tabla `stock`.
 */
export async function getCatalogo(empresaId) {
  const [{ data: prods, error: pErr }, { data: stockRows }] = await Promise.all([
    supabase
      .from('productos')
      .select('id, nombre, unidad, precio_referencial, categorias (nombre)')
      .order('nombre'),
    supabase.from('stock').select('producto_id, cantidad'),
  ])

  if (pErr) {
    console.error('Error fetching catálogo:', pErr)
    return []
  }

  const stockPorProducto = {}
  ;(stockRows ?? []).forEach(s => {
    stockPorProducto[s.producto_id] = (stockPorProducto[s.producto_id] ?? 0) + (s.cantidad ?? 0)
  })

  return (prods ?? []).map(p => ({
    id:                p.id,
    nombre:            p.nombre,
    categoria:         p.categorias?.nombre || 'General',
    unidad:            p.unidad || 'und',
    precioReferencial: p.precio_referencial,
    stockTotal:        stockPorProducto[p.id] ?? 0,
  }))
}

/**
 * Edita los campos de catálogo de un producto (nombre, categoría por nombre,
 * unidad, precio referencial). RLS garantiza que solo afecta la empresa propia.
 */
export async function updateProductoCatalogo(empresaId, productoId, { nombre, categoria, unidad, precioReferencial }) {
  const fila = {}
  if (nombre !== undefined) fila.nombre = nombre.trim()
  if (unidad !== undefined) fila.unidad = unidad || 'und'
  if (precioReferencial !== undefined) fila.precio_referencial = precioReferencial
  if (categoria !== undefined) {
    const categoriaId = await resolveCategoriaId(empresaId, categoria)
    if (categoriaId === null) return { ok: false, message: 'No se pudo resolver la categoría.' }
    fila.categoria_id = categoriaId
  }

  const { error } = await supabase.from('productos').update(fila).eq('id', productoId)
  if (error) {
    console.error('Error actualizando producto:', error)
    const dup = error.code === '23505'
    return { ok: false, message: dup ? 'Ya existe un producto con ese nombre.' : error.message }
  }
  return { ok: true }
}

/**
 * Elimina un producto del catálogo. Si tiene movimientos o stock asociados, la
 * FK lo impide (23503) y se devuelve un mensaje amable en vez de un error crudo.
 */
export async function deleteProducto(productoId) {
  const { error } = await supabase.from('productos').delete().eq('id', productoId)
  if (error) {
    console.error('Error eliminando producto:', error)
    const enUso = error.code === '23503'
    return { ok: false, message: enUso
      ? 'No se puede eliminar: el producto tiene movimientos o stock registrados.'
      : error.message }
  }
  return { ok: true }
}

/**
 * Importa filas de catálogo (de un Excel/CSV ya parseado). Cada fila:
 *   { nombre, categoria?, unidad?, precioReferencial? }
 * Upsert por (empresa_id, LOWER(nombre)): si el producto ya existe, actualiza
 * precio referencial / categoría / unidad; si no, lo crea. No duplica.
 * Devuelve { importados, actualizados, errores }.
 */
export async function importProductosCatalogo(empresaId, filas) {
  // Mapa de nombres existentes (lower) → id, para decidir insert vs update.
  const { data: existentes } = await supabase
    .from('productos')
    .select('id, nombre')
  const porNombre = {}
  ;(existentes ?? []).forEach(p => { porNombre[p.nombre.trim().toLowerCase()] = p.id })

  let importados = 0, actualizados = 0, errores = 0

  for (const fila of filas) {
    const nombre = (fila.nombre || '').trim()
    if (!nombre) { errores++; continue }
    const existenteId = porNombre[nombre.toLowerCase()]

    if (existenteId) {
      const res = await updateProductoCatalogo(empresaId, existenteId, {
        categoria:         fila.categoria,
        unidad:            fila.unidad,
        precioReferencial: fila.precioReferencial,
      })
      if (res.ok) actualizados++; else errores++
    } else {
      const res = await createProducto(empresaId, {
        nombre,
        categoria:         fila.categoria,
        unidad:            fila.unidad,
        precioReferencial: fila.precioReferencial,
      })
      if (res.ok) { importados++; porNombre[nombre.toLowerCase()] = res.id }
      else errores++
    }
  }

  return { importados, actualizados, errores }
}

/**
 * Tiendas activas de la empresa.
 * empresa_id está en la tabla directamente → filtro SQL explícito.
 */
export async function getTiendas(empresaId) {
  const { data, error } = await supabase
    .from('tiendas')
    .select('id, nombre, activa')
    .eq('empresa_id', empresaId)
    .eq('activa', true)
    .order('nombre')

  if (error) {
    console.error('Error fetching tiendas:', error)
    return []
  }

  return data ?? []
}
