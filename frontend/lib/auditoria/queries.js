// Queries de AuditorIA a Supabase. Módulo propio: NO se toca frontend/lib/queries.js.
// El cliente `supabase` (anon key + sesión) aplica RLS, que filtra por
// empresa_id vía get_my_empresa_id() (app_metadata).
import { supabase } from '../supabase'
import { normalizar } from './matching'

export { supabase }

// Catálogo del tenant para sincronizar a IndexedDB (matching + semáforo offline).
// RLS ya limita a la empresa del usuario.
export async function fetchCatalogo() {
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, referencia, unidad_medida, stock_minimo, punto_reorden, stock_maximo, ultima_salida_at')
  if (error) throw error
  return data || []
}

// Sesión de auditoría activa de la sede, o la crea si no hay ninguna abierta.
// (La gestión completa de sesiones —cierre, resumen— es US3.)
export async function getOrCreateSesionActiva({ empresaId, tiendaId, uid }) {
  const { data: existente } = await supabase
    .from('sesiones_auditoria')
    .select('id')
    .eq('tienda_id', tiendaId)
    .eq('estado', 'abierta')
    .limit(1)
    .maybeSingle()
  if (existente) return existente.id

  const { data, error } = await supabase
    .from('sesiones_auditoria')
    .insert({ empresa_id: empresaId, tienda_id: tiendaId, abierta_por: uid })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// Sube un conteo. Idempotente por client_op_id (un reintento no duplica).
export async function subirConteo(c) {
  const row = {
    client_op_id: c.client_op_id,
    empresa_id: c.empresa_id,
    tienda_id: c.tienda_id,
    sesion_id: c.sesion_id,
    producto_id: c.producto_id ?? null,
    cantidad: c.cantidad,
    estado_fisico: c.estado_fisico,
    semaforo_color: c.semaforo_color,
    semaforo_razon: c.semaforo_razon ?? null,
    canal: c.canal ?? 'manual',
    transcripcion: c.transcripcion ?? null,
    auditor_uid: c.auditor_uid,
  }
  const { error } = await supabase
    .from('conteos')
    .upsert(row, { onConflict: 'client_op_id', ignoreDuplicates: true })
  if (error) throw error
  await marcarDuplicados(c.sesion_id, c.producto_id)
}

// FR-015: si hay más de un conteo de la misma pieza en la sesión, marcarlos como
// duplicado para revisión del supervisor. Sin bloquear ni sobreescribir.
async function marcarDuplicados(sesionId, productoId) {
  if (!productoId) return
  const { data } = await supabase
    .from('conteos')
    .select('id')
    .eq('sesion_id', sesionId)
    .eq('producto_id', productoId)
  if (data && data.length > 1) {
    await supabase.from('conteos').update({ duplicado: true }).in('id', data.map((r) => r.id))
  }
}

// ── Dashboard del supervisor (US3) ────────────────────────────────────────────

// Sesiones abiertas de la empresa (RLS ya filtra por tenant).
export async function getSesionesAbiertas() {
  const { data, error } = await supabase
    .from('sesiones_auditoria')
    .select('id, tienda_id, created_at, tiendas(nombre)')
    .eq('estado', 'abierta')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Conteos de las sesiones dadas, con el nombre de la pieza (embed por FK).
export async function getConteosDeSesiones(sesionIds) {
  if (!sesionIds.length) return []
  const { data, error } = await supabase
    .from('conteos')
    .select('id, cantidad, estado_fisico, semaforo_color, semaforo_razon, created_at, duplicado, sesion_id, producto_id, productos(nombre, referencia), evidencias(storage_path)')
    .in('sesion_id', sesionIds)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Cierra una sesión con su resumen (totales por color). US3.
export async function cerrarSesion({ sesionId, resumen, uid }) {
  const { error } = await supabase
    .from('sesiones_auditoria')
    .update({ estado: 'cerrada', resumen, cerrada_por: uid, closed_at: new Date().toISOString() })
    .eq('id', sesionId)
  if (error) throw error
}

// Piezas detectadas en facturas pendientes de aprobación (panel del supervisor).
export async function getPiezasPendientes() {
  const { data, error } = await supabase
    .from('piezas_pendientes')
    .select('id, descripcion_extraida, unidad_sugerida, cantidad, precio_unitario, tienda_id, created_at')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ── Recepción por factura (US4) ───────────────────────────────────────────────

// Ingreso de mercadería al ledger. tipo='ingreso' → el trigger suma stock en la
// sede destino y actualiza ultimo_costo. Idempotente por client_op_id.
export async function crearIngreso({ productoId, tiendaId, cantidad, costo, authUid, clientOpId }) {
  const { error } = await supabase.from('movimientos').upsert(
    {
      tipo: 'ingreso',
      producto_id: productoId,
      tienda_destino: tiendaId,
      cantidad,
      costo_unitario: costo ?? 0,
      auth_uid: authUid ?? null,
      client_op_id: clientOpId,
    },
    { onConflict: 'client_op_id', ignoreDuplicates: true },
  )
  if (error) throw error
}

// Ingreso manual de inventario (sin factura). Solo supervisor/admin (rol en UI).
// seccion_id es la ubicación dentro de la sede (opcional; no afecta el stock).
// Devuelve el movimiento para poder deshacerlo.
export async function registrarIngresoManual({ productoId, tiendaId, seccionId, cantidad, costo, authUid, clientOpId }) {
  const { data, error } = await supabase
    .from('movimientos')
    .insert({
      tipo: 'ingreso',
      producto_id: productoId,
      tienda_destino: tiendaId,
      seccion_id: seccionId ?? null,
      cantidad,
      costo_unitario: costo ?? 0,
      auth_uid: authUid ?? null,
      client_op_id: clientOpId,
    })
    .select('id, created_at')
    .single()
  if (error) throw error
  return data
}

// ── Secciones (ubicaciones dentro de una sede) ────────────────────────────────

// Secciones de una sede, ordenadas por nombre. RLS filtra por empresa.
export async function getSecciones(tiendaId) {
  const { data, error } = await supabase
    .from('secciones')
    .select('id, nombre, tienda_id')
    .eq('tienda_id', tiendaId)
    .order('nombre')
  if (error) throw error
  return data || []
}

// Crea una sección en una sede. empresa_id explícito (RLS lo exige en el CHECK).
export async function crearSeccion({ empresaId, tiendaId, nombre }) {
  const { data, error } = await supabase
    .from('secciones')
    .insert({ empresa_id: empresaId, tienda_id: tiendaId, nombre })
    .select('id, nombre, tienda_id')
    .single()
  if (error) throw error
  return data
}

export async function renombrarSeccion({ id, nombre }) {
  const { error } = await supabase.from('secciones').update({ nombre }).eq('id', id)
  if (error) throw error
}

// Borra una sección. La FK ON DELETE SET NULL (migración 035) desvincula los
// movimientos que la usaban (conserva el historial).
export async function borrarSeccion(id) {
  const { error } = await supabase.from('secciones').delete().eq('id', id)
  if (error) throw error
}

// ── Sedes (tiendas) ───────────────────────────────────────────────────────────

export async function crearTienda({ empresaId, nombre }) {
  const { data, error } = await supabase
    .from('tiendas')
    .insert({ empresa_id: empresaId, nombre })
    .select('id, nombre, activa')
    .single()
  if (error) throw error
  return data
}

export async function renombrarTienda({ id, nombre }) {
  const { error } = await supabase.from('tiendas').update({ nombre }).eq('id', id)
  if (error) throw error
}

// "Quitar" una sede = desactivarla (soft-delete). No se borra para no romper
// movimientos/stock/usuarios históricos; se oculta de los selectores de carga.
export async function setTiendaActiva({ id, activa }) {
  const { error } = await supabase.from('tiendas').update({ activa }).eq('id', id)
  if (error) throw error
}

// Pieza de factura sin match en el catálogo: queda pendiente de aprobación (FR-007).
export async function crearPiezaPendiente({ empresaId, tiendaId, descripcion, unidad, cantidad, precio, recepcionRef }) {
  const { error } = await supabase.from('piezas_pendientes').insert({
    empresa_id: empresaId,
    tienda_id: tiendaId,
    descripcion_extraida: descripcion,
    unidad_sugerida: unidad ?? null,
    cantidad: cantidad ?? null,
    precio_unitario: precio ?? null,
    recepcion_ref: recepcionRef ?? null,
  })
  if (error) throw error
}

// Aprueba una pieza pendiente: crea el producto, registra el ingreso (si hay
// cantidad) y marca la pieza como aprobada. Solo supervisor/admin (US4/T031).
export async function aprobarPieza({ pieza, empresaId, uid }) {
  const { data: prod, error: e1 } = await supabase
    .from('productos')
    .insert({
      nombre: pieza.descripcion_extraida,
      empresa_id: empresaId,
      unidad_medida: pieza.unidad_sugerida ?? 'unidad',
    })
    .select('id')
    .single()
  if (e1) throw e1

  if (pieza.cantidad && pieza.tienda_id) {
    await crearIngreso({
      productoId: prod.id,
      tiendaId: pieza.tienda_id,
      cantidad: pieza.cantidad,
      costo: pieza.precio_unitario ?? 0,
      authUid: uid,
      clientOpId: crypto.randomUUID(),
    })
  }

  const { error: e2 } = await supabase
    .from('piezas_pendientes')
    .update({ estado: 'aprobada', producto_id: prod.id, resuelta_por: uid, resolved_at: new Date().toISOString() })
    .eq('id', pieza.id)
  if (e2) throw e2
}

export async function rechazarPieza({ piezaId, uid }) {
  const { error } = await supabase
    .from('piezas_pendientes')
    .update({ estado: 'rechazada', resuelta_por: uid, resolved_at: new Date().toISOString() })
    .eq('id', piezaId)
  if (error) throw error
}

// ── Catálogo y configuración (US6) ────────────────────────────────────────────

// Importa filas de catálogo: actualiza las piezas existentes (por nombre) e
// inserta las nuevas. Devuelve { insertados, actualizados }.
export async function importarCatalogo({ empresaId, filas, onProgreso }) {
  // Traer TODOS los existentes paginando (el select corta en 1000 por defecto;
  // con catálogos grandes esto es indispensable para cruzar bien).
  const existentes = []
  const PAGE = 1000
  for (let desde = 0; ; desde += PAGE) {
    const { data, error } = await supabase
      .from('productos').select('id, nombre, referencia').range(desde, desde + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    existentes.push(...data)
    if (data.length < PAGE) break
  }

  // La base exige nombre y referencia únicos por empresa. Cruzamos por referencia
  // primero (si la fila la trae) y si no, por nombre.
  const porNombre = new Map()
  const porRef = new Map()
  for (const p of existentes) {
    if (p.nombre) porNombre.set(p.nombre.trim().toLowerCase(), p.id)
    if (p.referencia) porRef.set(p.referencia.trim().toLowerCase(), p.id)
  }

  const nuevos = []
  const updates = []
  const refsVistas = new Set()      // referencias ya usadas en este archivo
  const nombresVistos = new Set()   // nombres ya usados en este archivo
  const idsVistos = new Set()       // no actualizar dos veces el mismo producto
  const omitidos = []

  for (const f of filas) {
    const refKey = f.referencia ? f.referencia.trim().toLowerCase() : null
    const nombreKey = f.nombre.trim().toLowerCase()
    const campos = { unidad_medida: f.unidad_medida, referencia: f.referencia }
    const id = (refKey && porRef.get(refKey)) || porNombre.get(nombreKey)

    if (id) {
      if (idsVistos.has(id)) { omitidos.push(`${f.nombre} (repetido en el archivo)`); continue }
      idsVistos.add(id)
      updates.push({ id, campos, nombre: f.nombre })
      continue
    }
    // Producto nuevo: descartar duplicados dentro del mismo archivo (chocan con los índices únicos).
    if (nombresVistos.has(nombreKey)) { omitidos.push(`${f.nombre} (nombre repetido en el archivo)`); continue }
    if (refKey && refsVistas.has(refKey)) { omitidos.push(`${f.nombre} (referencia repetida: ${f.referencia})`); continue }
    nombresVistos.add(nombreKey)
    if (refKey) refsVistas.add(refKey)
    nuevos.push({ empresa_id: empresaId, nombre: f.nombre, ...campos })
  }

  // Insertar en lotes (evita un POST gigante y timeouts). Si un lote falla,
  // reintenta fila por fila para no perder el resto.
  let insertados = 0
  const LOTE_INS = 500
  for (let i = 0; i < nuevos.length; i += LOTE_INS) {
    const grupo = nuevos.slice(i, i + LOTE_INS)
    const { data, error } = await supabase.from('productos').insert(grupo).select('id')
    if (error) {
      for (const row of grupo) {
        const r = await supabase.from('productos').insert(row).select('id')
        if (r.error) omitidos.push(`${row.nombre} (${r.error.message})`)
        else insertados += 1
      }
    } else {
      insertados += data?.length ?? grupo.length
    }
    onProgreso?.({ fase: 'insertando', hechos: insertados, total: nuevos.length })
  }

  // Actualizar existentes en lotes paralelos (evita miles de llamadas en serie).
  let actualizados = 0
  const LOTE_UPD = 50
  for (let i = 0; i < updates.length; i += LOTE_UPD) {
    const grupo = updates.slice(i, i + LOTE_UPD)
    const res = await Promise.all(grupo.map((u) => supabase.from('productos').update(u.campos).eq('id', u.id)))
    res.forEach((r, k) => { if (r.error) omitidos.push(`${grupo[k].nombre} (${r.error.message})`); else actualizados += 1 })
    onProgreso?.({ fase: 'actualizando', hechos: actualizados, total: updates.length })
  }

  return { insertados, actualizados, omitidos }
}

// Carga de stock inicial: NO escribe stock directo (Constitución IV/V). Matchea
// cada fila con un producto (por referencia, o por nombre) y crea un movimiento
// de ingreso en la sede; el trigger tr_actualizar_stock suma el stock.
// Devuelve { cargados, sinMatch: [texto de las filas sin producto] }.
export async function cargarStockInicial({ tiendaId, filas, authUid }) {
  const { data: prods, error } = await supabase.from('productos').select('id, nombre, referencia')
  if (error) throw error

  const porRef = new Map()
  const porNombre = new Map()
  for (const p of prods || []) {
    if (p.referencia) porRef.set(normalizar(p.referencia), p.id)
    porNombre.set(normalizar(p.nombre), p.id)
  }

  const nuevos = []
  const sinMatch = []
  for (const f of filas) {
    const id = (f.referencia && porRef.get(normalizar(f.referencia))) || porNombre.get(normalizar(f.nombre || ''))
    if (!id) { sinMatch.push(f.referencia || f.nombre || '(fila sin identificador)'); continue }
    nuevos.push({
      tipo: 'ingreso',
      producto_id: id,
      tienda_destino: tiendaId,
      cantidad: f.cantidad,
      costo_unitario: f.costo ?? 0,
      auth_uid: authUid ?? null,
      client_op_id: crypto.randomUUID(),
    })
  }

  let cargados = 0
  if (nuevos.length) {
    const { data, error: e2 } = await supabase.from('movimientos').insert(nuevos).select('id')
    if (e2) throw e2
    cargados = data?.length ?? nuevos.length
  }
  return { cargados, sinMatch }
}

// Config del tenant (RLS de empresas devuelve solo la propia).
export async function getEmpresaConfig() {
  const { data, error } = await supabase.from('empresas').select('rubro, meses_stock_muerto').single()
  if (error) throw error
  return data
}

// Tokens de conexión al bot de Telegram de la empresa (read-only; RLS por empresa).
export async function getTelegramTokens(empresaId) {
  const { data, error } = await supabase
    .from('empresas')
    .select('telegram_token, telegram_token_admin')
    .eq('id', empresaId)
    .single()
  if (error) throw error
  return { operario: data?.telegram_token ?? '', admin: data?.telegram_token_admin ?? '' }
}

export async function updateEmpresaConfig({ empresaId, mesesStockMuerto }) {
  const { error } = await supabase
    .from('empresas')
    .update({ meses_stock_muerto: mesesStockMuerto })
    .eq('id', empresaId)
  if (error) throw error
}

// ── Búsqueda semántica de productos (embeddings, online) ──────────────────────

// Devuelve [{ pieza, score }] usando embeddings (HuggingFace) + pgvector.
// Requiere conexión. Si algo falla, devuelve null para que el caller caiga al
// matching por trigramas (offline). Mismo formato de salida que buscarLocal.
export async function buscarSemantico(texto, limite = 5) {
  try {
    const res = await fetch('/api/auditoria/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textos: texto }),
    })
    if (!res.ok) return null
    const emb = (await res.json()).vectores?.[0]
    if (!emb?.length) return null
    const { data, error } = await supabase.rpc('buscar_productos_semantico', {
      query_embedding: `[${emb.join(',')}]`,
      match_count: limite,
    })
    if (error || !data) return null
    return data.map((p) => ({
      pieza: { id: p.id, producto_id: p.id, nombre: p.nombre, referencia: p.referencia },
      score: 1 - p.distancia,
    }))
  } catch {
    return null
  }
}

// Productos sin embedding (para el backfill del admin). Trae hasta 1000 por vez;
// el caller repite hasta terminar.
export async function productosSinEmbedding() {
  const { data, error } = await supabase.from('productos').select('id, nombre, referencia').is('embedding', null)
  if (error) throw error
  return data || []
}

// Cuántos productos siguen sin embedding (para mostrar el progreso total).
export async function contarSinEmbedding() {
  const { count, error } = await supabase
    .from('productos').select('id', { count: 'exact', head: true }).is('embedding', null)
  if (error) throw error
  return count ?? 0
}

// Estado de embeddings del catálogo: { total, con, sin } (para el cartel de la UI).
export async function getEstadoEmbeddings() {
  const [{ count: total }, { count: sin }] = await Promise.all([
    supabase.from('productos').select('id', { count: 'exact', head: true }),
    supabase.from('productos').select('id', { count: 'exact', head: true }).is('embedding', null),
  ])
  const t = total ?? 0
  const s = sin ?? 0
  return { total: t, sin: s, con: t - s }
}

// Guarda el embedding de un producto (formato texto de pgvector: '[...]').
export async function guardarEmbedding(id, emb) {
  const { error } = await supabase.from('productos').update({ embedding: `[${emb.join(',')}]` }).eq('id', id)
  if (error) throw error
}

// ── Salidas / ventas (FR-021) ─────────────────────────────────────────────────

// Busca un producto por nombre exacto (case-insensitive) y, si no existe, lo crea.
// Se usa para vender un ítem que la búsqueda no encontró en el catálogo, sin
// duplicar si ya estaba. Devuelve el mismo formato que usa la pantalla de venta.
export async function buscarOCrearProducto(nombre, empresaId) {
  const nom = (nombre || '').trim()
  if (!nom) throw new Error('nombre vacío')
  const { data: existentes } = await supabase
    .from('productos').select('id, nombre, referencia').ilike('nombre', nom).limit(1)
  if (existentes?.length) {
    const p = existentes[0]
    return { id: p.id, producto_id: p.id, nombre: p.nombre, referencia: p.referencia }
  }
  const { data, error } = await supabase
    .from('productos').insert({ empresa_id: empresaId, nombre: nom, unidad_medida: 'unidad' })
    .select('id, nombre, referencia').single()
  if (error) throw error
  return { id: data.id, producto_id: data.id, nombre: data.nombre, referencia: data.referencia }
}

// Precio sugerido para una venta: el de la última venta del producto (lo más
// útil), o el precio de referencia del catálogo. Devuelve number o null.
export async function getPrecioSugerido(productoId) {
  const { data: mov } = await supabase
    .from('movimientos').select('precio_unitario')
    .eq('producto_id', productoId).eq('tipo', 'venta')
    .order('created_at', { ascending: false }).limit(1)
  if (mov?.[0]?.precio_unitario) return Number(mov[0].precio_unitario)
  const { data: prod } = await supabase
    .from('productos').select('precio_referencial').eq('id', productoId).maybeSingle()
  return prod?.precio_referencial != null ? Number(prod.precio_referencial) : null
}

// Stock actual de una pieza en una sede (tabla derivada por trigger).
export async function getStock(productoId, tiendaId) {
  const { data, error } = await supabase
    .from('stock')
    .select('cantidad')
    .eq('producto_id', productoId)
    .eq('tienda_id', tiendaId)
    .maybeSingle()
  if (error) throw error
  return data?.cantidad ?? 0
}

// Registra una salida (venta) en el ledger. El trigger descuenta el stock.
// Mismo ledger que el bot; NUNCA se escribe stock directo (Constitución IV/V).
export async function registrarSalida({ productoId, tiendaId, cantidad, precio, authUid, clientOpId }) {
  const { data, error } = await supabase
    .from('movimientos')
    .insert({
      tipo: 'venta',
      producto_id: productoId,
      tienda_origen: tiendaId,
      cantidad,
      precio_unitario: precio ?? 0,
      auth_uid: authUid ?? null,
      client_op_id: clientOpId,
    })
    .select('id, created_at')
    .single()
  if (error) throw error
  return data
}

// Deshacer = DELETE del movimiento (el trigger revierte el stock). Ventana corta.
export async function deshacerSalida(movimientoId) {
  const { error } = await supabase.from('movimientos').delete().eq('id', movimientoId)
  if (error) throw error
}

// ── Evidencia fotográfica (US5) ───────────────────────────────────────────────

// Resuelve el id de DB de un conteo por su client_op_id (para enlazar la foto
// una vez que el conteo se sincronizó).
export async function getConteoIdByClientOp(clientOpId) {
  const { data } = await supabase.from('conteos').select('id').eq('client_op_id', clientOpId).maybeSingle()
  return data?.id ?? null
}

// Sube la foto a Storage y registra la fila de evidencia. Idempotente.
export async function subirEvidencia({ clientOpId, empresaId, sesionId, conteoId, blob }) {
  const path = `${empresaId}/${sesionId}/${conteoId}/${clientOpId}.jpg`
  const { error: upErr } = await supabase.storage
    .from('evidencias')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (upErr) throw upErr
  const { error } = await supabase.from('evidencias').upsert(
    { client_op_id: clientOpId, empresa_id: empresaId, conteo_id: conteoId, storage_path: path },
    { onConflict: 'client_op_id', ignoreDuplicates: true },
  )
  if (error) throw error
}

// URL firmada temporal para ver una evidencia (bucket privado).
export async function urlEvidencia(storagePath) {
  const { data } = await supabase.storage.from('evidencias').createSignedUrl(storagePath, 120)
  return data?.signedUrl ?? null
}

// ── Reportes (US Admin) ───────────────────────────────────────────────────────

// Ventas en un rango. Trae el autor (auth_uid web y usuario_id de Telegram) y
// el total para agregar por usuario. RLS ya filtra por empresa (vía producto).
export async function getVentas({ desde, hasta }) {
  const { data, error } = await supabase
    .from('movimientos')
    .select('auth_uid, usuario_id, tienda_origen, cantidad, total, created_at')
    .eq('tipo', 'venta')
    .gte('created_at', desde)
    .lte('created_at', hasta)
  if (error) throw error
  return data || []
}

// Nombres de los operarios de Telegram (para resolver usuario_id en el reporte).
export async function getUsuariosTelegram() {
  const { data, error } = await supabase.from('usuarios').select('id, nombre')
  if (error) throw error
  return data || []
}

// Nombres de las sedes (para el resumen de ventas por tienda y los selectores).
// Incluye `activa` para poder filtrar sedes desactivadas en la carga.
export async function getTiendas() {
  const { data, error } = await supabase.from('tiendas').select('id, nombre, activa').order('nombre')
  if (error) throw error
  return data || []
}

// ── Consignaciones ────────────────────────────────────────────────────────────

// Registra una consignación sin tocar el stock.
export async function crearConsignacion({ empresaId, tiendaId, productoId, cantidad, precioUnitario, cliente, authUid }) {
  const { data, error } = await supabase
    .from('consignaciones')
    .insert({
      empresa_id: empresaId,
      tienda_id: tiendaId,
      producto_id: productoId,
      cantidad,
      precio_unitario: precioUnitario ?? 0,
      cliente: cliente.trim(),
      auth_uid: authUid,
    })
    .select('id, created_at')
    .single()
  if (error) throw error
  return data
}

// Pendientes de una tienda. authUid filtra solo las del vendedor; sin él trae todas (supervisor).
export async function getConsignacionesPendientes(tiendaId, authUid = null) {
  let q = supabase
    .from('consignaciones')
    .select('id, producto_id, cantidad, precio_unitario, cliente, auth_uid, created_at, productos(id, nombre)')
    .eq('tienda_id', tiendaId)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false })
  if (authUid) q = q.eq('auth_uid', authUid)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Confirma como venta: crea movimiento (trigger descuenta stock) y cierra la consignación.
export async function confirmarConsignacion({ consignacionId, productoId, tiendaId, cantidad, precioUnitario, authUid }) {
  const { data: mov, error: movErr } = await supabase
    .from('movimientos')
    .insert({
      tipo: 'venta',
      producto_id: productoId,
      tienda_origen: tiendaId,
      cantidad,
      precio_unitario: precioUnitario ?? 0,
      auth_uid: authUid ?? null,
      client_op_id: crypto.randomUUID(),
    })
    .select('id')
    .single()
  if (movErr) throw movErr

  const { error } = await supabase
    .from('consignaciones')
    .update({ estado: 'confirmada', cerrada_at: new Date().toISOString(), cerrada_por: authUid, movimiento_id: mov.id })
    .eq('id', consignacionId)
  if (error) throw error
}

// Devuelve la mercadería: cierra sin crear movimiento (stock queda intacto).
export async function devolverConsignacion({ consignacionId, authUid }) {
  const { error } = await supabase
    .from('consignaciones')
    .update({ estado: 'devuelta', cerrada_at: new Date().toISOString(), cerrada_por: authUid })
    .eq('id', consignacionId)
  if (error) throw error
}

// ── Búsqueda de stock por sede ("¿dónde está?") ──────────────────────────────

// Busca productos por nombre (ilike) y devuelve el stock en cada sede activa.
// Útil para cadenas multi-sede: ver qué sede tiene la pieza disponible.
export async function buscarStockPorSede(texto) {
  const { data: prods, error: e1 } = await supabase
    .from('productos')
    .select('id, nombre, referencia')
    .ilike('nombre', `%${texto}%`)
    .limit(12)
  if (e1) throw e1
  if (!prods?.length) return []

  const ids = prods.map((p) => p.id)
  const { data: stocks, error: e2 } = await supabase
    .from('stock')
    .select('producto_id, cantidad, tienda_id, tiendas(nombre, activa)')
    .in('producto_id', ids)
  if (e2) throw e2

  return prods.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    referencia: p.referencia,
    sedes: (stocks || [])
      .filter((s) => s.producto_id === p.id && s.tiendas?.activa !== false)
      .sort((a, b) => b.cantidad - a.cantidad)
      .map((s) => ({ tiendaId: s.tienda_id, nombre: s.tiendas?.nombre ?? `Sede ${s.tienda_id}`, cantidad: s.cantidad })),
  }))
}

// Para el reporte de admin: consignaciones en un rango de fechas.
export async function getConsignacionesReporte({ desde, hasta }) {
  const { data, error } = await supabase
    .from('consignaciones')
    .select('id, cantidad, precio_unitario, cliente, estado, auth_uid, tienda_id, created_at, cerrada_at, productos(nombre), tiendas(nombre)')
    .gte('created_at', desde)
    .lte('created_at', hasta)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
