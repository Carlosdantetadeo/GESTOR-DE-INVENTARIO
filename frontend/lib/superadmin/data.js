import { getAdminClient } from './adminClient'
import { encryptApiKey } from './cryptoModelo'

// ─── Catálogo de modelos NLU (tabla modelos_nlu, sprint 021) ──────────────────
// Antes era una constante hardcodeada; ahora el superadmin lo administra desde
// /superadmin/modelos. El bot resuelve el modelo contra esta misma tabla.

export const PROVEEDORES = ['groq', 'anthropic', 'openrouter', 'openai-compat']

// UUID fijo para el actor superadmin en la tabla de auditoría (único actor de este panel).
const SUPERADMIN_ACTOR = '00000000-0000-0000-0000-000000000001'

// Fallback mínimo por si la tabla todavía no fue migrada (evita romper la UI).
const MODELOS_FALLBACK = [
  { id: 'groq-llama', label: 'Groq Llama 3.3', proveedor: 'groq', api_model_id: 'llama-3.3-70b-versatile', costo_in: 0.00000059, costo_out: 0.00000079, badge: 'Recomendado', estado: 'activo', tiene_api_key: false, tipo_hosting: 'cloud', rol: 'conversacion', ultima_prueba_at: null, ultima_prueba_latencia_ms: null, empresas_count: 0 },
]

export async function getModelosNlu({ soloActivos = false } = {}) {
  const supa = getAdminClient()
  let q = supa.from('modelos_nlu')
    .select('id, label, proveedor, api_model_id, base_url, costo_in, costo_out, badge, estado, tipo_hosting, rol, ultima_prueba_at, ultima_prueba_latencia_ms, created_at, api_key_enc')
    .order('created_at', { ascending: true })
  if (soloActivos) q = q.eq('estado', 'activo')
  const { data, error } = await q
  if (error || !data) return MODELOS_FALLBACK
  if (!data.length) return MODELOS_FALLBACK

  // Contar empresas por modelo en una sola query.
  const { data: empresasRows } = await supa.from('empresas').select('nlu_model').not('nlu_model', 'is', null)
  const countMap = {}
  for (const e of empresasRows ?? []) {
    if (e.nlu_model) countMap[e.nlu_model] = (countMap[e.nlu_model] || 0) + 1
  }

  // Precio vigente: el registro más reciente por modelo.
  const { data: pricingRows } = await supa.from('nlu_model_pricing')
    .select('modelo_id, vigente_desde, fuente')
    .order('vigente_desde', { ascending: false })
  const pricingMap = {}
  for (const p of pricingRows ?? []) {
    if (!pricingMap[p.modelo_id]) pricingMap[p.modelo_id] = p
  }

  return data.map(({ api_key_enc, ...rest }) => ({
    ...rest,
    tiene_api_key: !!api_key_enc,
    empresas_count: countMap[rest.id] || 0,
    precio_vigente_desde: pricingMap[rest.id]?.vigente_desde ?? null,
    precio_fuente: pricingMap[rest.id]?.fuente ?? null,
  }))
}

// Retorna las empresas que usan un modelo específico.
export async function getEmpresasByModelo(modeloId) {
  const supa = getAdminClient()
  const { data } = await supa.from('empresas')
    .select('id, nombre, rubro, activa')
    .eq('nlu_model', modeloId)
    .order('nombre', { ascending: true })
  return data ?? []
}

// Reasigna todas las empresas de `fromId` al modelo `toId` en una transacción.
// Registra en auditoría.
export async function migrarEmpresasModelo(fromId, toId) {
  const supa = getAdminClient()

  // Verificar que el modelo destino existe y es activo.
  const { data: dest } = await supa.from('modelos_nlu').select('id, label, estado').eq('id', toId).maybeSingle()
  if (!dest) return { ok: false, message: 'El modelo destino no existe.' }
  if (dest.estado === 'deprecado') return { ok: false, message: 'No se puede migrar a un modelo deprecado.' }

  const { data: afectadas } = await supa.from('empresas').select('id').eq('nlu_model', fromId)
  const ids = (afectadas ?? []).map(e => e.id)
  if (!ids.length) return { ok: false, message: 'El modelo origen no tiene empresas asignadas.' }

  const { error } = await supa.from('empresas').update({ nlu_model: toId }).eq('nlu_model', fromId)
  if (error) return { ok: false, message: error.message }

  await writeAuditLog(supa, 'migrar', fromId, null, { de: fromId, a: toId, empresas: ids.length })
  return { ok: true, empresas: ids.length }
}

// Últimos N eventos de auditoría del catálogo NLU.
export async function getAuditLog(limit = 200) {
  const supa = getAdminClient()
  const { data } = await supa.from('nlu_model_audit')
    .select('id, accion, modelo_id, empresa_id, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}

// Escribe una fila en nlu_model_audit. Fire-and-forget: nunca bloquea la operación principal.
async function writeAuditLog(supa, accion, modeloId, empresaId, payload) {
  try {
    await supa.from('nlu_model_audit').insert({
      actor_id: SUPERADMIN_ACTOR,
      accion,
      modelo_id: modeloId ?? null,
      empresa_id: empresaId ?? null,
      payload: payload ?? null,
    })
  } catch { /* silencioso */ }
}

// Etiqueta legible de un modelo. Recibe el catálogo ya cargado (las páginas son
// server components async). Cae al id crudo si no lo encuentra.
export function modeloLabel(id, catalogo = []) {
  return catalogo.find(m => m.id === id)?.label ?? (id || '—')
}

// Formato de costo de referencia para mostrar en el selector / ABM.
export function costoLabel(m) {
  // costo aproximado por 1,000 mensajes asumiendo ~700 tok in + ~120 tok out.
  const usdMil = (Number(m.costo_in) * 700 + Number(m.costo_out) * 120) * 1000
  return `~$${usdMil.toFixed(2)} / 1,000 mensajes`
}

function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita acentos
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function crearModelo(input) {
  const { id, label, proveedor, api_model_id, base_url, costo_in, costo_out, badge, api_key, tipo_hosting, rol } = input ?? {}
  const finalId = slugify(id || label)
  if (!finalId || !label?.trim() || !api_model_id?.trim()) {
    return { ok: false, message: 'Faltan datos: id/label/api_model_id.' }
  }
  if (!PROVEEDORES.includes(proveedor)) {
    return { ok: false, message: 'Proveedor no válido.' }
  }
  const baseUrl = base_url?.trim() || null
  if (proveedor === 'openai-compat' && !baseUrl) {
    return { ok: false, message: 'El proveedor openai-compat requiere una Base URL (ej. el endpoint MaaS de Huawei).' }
  }
  let api_key_enc = null
  if (api_key && String(api_key).trim()) {
    try { api_key_enc = await encryptApiKey(String(api_key).trim()) }
    catch (e) { return { ok: false, message: `No se pudo cifrar la API key (config del servidor — revisar MODELOS_ENC_KEY): ${e.message}` } }
  }
  const supa = getAdminClient()
  const TIPOS_HOSTING_VALIDOS = ['cloud', 'local', 'self_hosted']
  const ROLES_VALIDOS = ['clasificacion', 'extraccion', 'conversacion', 'razonamiento', 'embeddings']
  const tipoHosting = TIPOS_HOSTING_VALIDOS.includes(tipo_hosting) ? tipo_hosting : 'cloud'
  const rolModelo   = ROLES_VALIDOS.includes(rol) ? rol : 'conversacion'

  const { error } = await supa.from('modelos_nlu').insert({
    id: finalId,
    label: label.trim(),
    proveedor,
    api_model_id: api_model_id.trim(),
    base_url: baseUrl,
    costo_in: Number(costo_in) || 0,
    costo_out: Number(costo_out) || 0,
    badge: badge?.trim() || null,
    tipo_hosting: tipoHosting,
    rol: rolModelo,
    estado: 'activo',
    ...(api_key_enc ? { api_key_enc } : {}),
  })
  if (error) return { ok: false, message: error.code === '23505' ? 'Ya existe un modelo con ese id.' : error.message }
  await writeAuditLog(supa, 'crear', finalId, null, { label: label.trim(), proveedor })
  // Registrar precio inicial en el historial.
  const ci = Number(costo_in) || 0
  const co = Number(costo_out) || 0
  if (ci > 0 || co > 0) {
    supa.from('nlu_model_pricing').insert({
      modelo_id: finalId,
      costo_in_por_token: ci,
      costo_out_por_token: co,
      fuente: input.fuente?.trim() || null,
    }).catch(() => {})
  }
  return { ok: true, id: finalId }
}

export async function actualizarModelo(id, patch) {
  const supa = getAdminClient()
  const allowed = {}
  if (patch.label !== undefined)        allowed.label = String(patch.label).trim()
  if (patch.proveedor !== undefined) {
    if (!PROVEEDORES.includes(patch.proveedor)) return { ok: false, message: 'Proveedor no válido.' }
    allowed.proveedor = patch.proveedor
  }
  if (patch.api_model_id !== undefined) allowed.api_model_id = String(patch.api_model_id).trim()
  if (patch.base_url !== undefined)     allowed.base_url = String(patch.base_url).trim() || null
  if (patch.costo_in !== undefined)     allowed.costo_in = Number(patch.costo_in) || 0
  if (patch.costo_out !== undefined)    allowed.costo_out = Number(patch.costo_out) || 0
  if (patch.badge !== undefined)        allowed.badge = patch.badge?.trim() || null
  if (patch.estado !== undefined) {
    const ESTADOS = ['activo', 'inactivo', 'deprecado']
    if (ESTADOS.includes(patch.estado)) allowed.estado = patch.estado
  }
  if (patch.tipo_hosting !== undefined) {
    const TIPOS = ['cloud', 'local', 'self_hosted']
    if (TIPOS.includes(patch.tipo_hosting)) allowed.tipo_hosting = patch.tipo_hosting
  }
  if (patch.rol !== undefined) {
    const ROLES = ['clasificacion', 'extraccion', 'conversacion', 'razonamiento', 'embeddings']
    if (ROLES.includes(patch.rol)) allowed.rol = patch.rol
  }
  if (patch.api_key !== undefined) {
    const v = String(patch.api_key).trim()
    if (v === '') {
      allowed.api_key_enc = null   // limpiar → vuelve a usar el secret del proveedor
    } else {
      try { allowed.api_key_enc = await encryptApiKey(v) }
      catch (e) { return { ok: false, message: `No se pudo cifrar la API key (config del servidor — revisar MODELOS_ENC_KEY): ${e.message}` } }
    }
  }
  const { error } = await supa.from('modelos_nlu').update(allowed).eq('id', id)
  if (error) return { ok: false, message: error.message }
  const accion = allowed.estado ?? 'editar'
  await writeAuditLog(supa, accion, id, null, { campos: Object.keys(allowed) })
  // Si se actualizaron ambos costos, registrar en historial de precios.
  if (allowed.costo_in !== undefined && allowed.costo_out !== undefined) {
    supa.from('nlu_model_pricing').insert({
      modelo_id: id,
      costo_in_por_token: allowed.costo_in,
      costo_out_por_token: allowed.costo_out,
      fuente: patch.fuente?.trim() || null,
    }).catch(() => {})
  }
  return { ok: true }
}

export async function eliminarModelo(id) {
  const supa = getAdminClient()
  const { count } = await supa.from('empresas')
    .select('id', { count: 'exact', head: true }).eq('nlu_model', id)
  if (count && count > 0) {
    return { ok: false, message: `No se puede eliminar: ${count} empresa(s) usan este modelo.` }
  }
  const { error } = await supa.from('modelos_nlu').delete().eq('id', id)
  if (error) return { ok: false, message: error.message }
  await writeAuditLog(supa, 'eliminar', id, null, null)
  return { ok: true }
}

// ─── Resúmenes de empresas ────────────────────────────────────────────────────

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
    .select('id, nombre, rubro, nlu_model, activa, created_at')
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
      activa: e.activa !== false,
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
    .select('id, nombre, rubro, nlu_model, created_at, activa, suspendida_at, telegram_token, telegram_token_admin, nlu_instrucciones, max_usuarios')
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

// Instrucciones de reconocimiento (NLU/visión) por empresa. Texto libre que se
// inyecta al prompt de voz/foto/texto para adaptar el sistema al rubro.
export async function setEmpresaInstrucciones(empresaId, texto) {
  const supa = getAdminClient()
  const valor = (texto ?? '').trim() || null
  const { error } = await supa.from('empresas').update({ nlu_instrucciones: valor }).eq('id', empresaId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

// Límite de usuarios (plan) por empresa. null/'' → ilimitado.
export async function setEmpresaMaxUsuarios(empresaId, valor) {
  const supa = getAdminClient()
  const n = (valor === '' || valor == null) ? null : Math.max(1, Math.floor(Number(valor)))
  if (n != null && !Number.isFinite(n)) return { ok: false, message: 'Número inválido.' }
  const { error } = await supa.from('empresas').update({ max_usuarios: n }).eq('id', empresaId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

export async function updateEmpresaModelo(empresaId, modelo) {
  const catalogo = await getModelosNlu()
  if (!catalogo.some(m => m.id === modelo)) {
    return { ok: false, message: 'Modelo no válido.' }
  }
  const supa = getAdminClient()
  const { error } = await supa.from('empresas').update({ nlu_model: modelo }).eq('id', empresaId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

// ─── Consumo y límites de gasto ──────────────────────────────────────────────

// Consumo del mes (YYYY-MM o mes actual), una fila por EMPRESA + MODELO.
// Así, si una empresa cambió de modelo en el mes, se ve cuánto gastó con cada uno.
// El límite/gasto es por empresa: `costo_empresa` trae el total para el % vs límite.
export async function getConsumoResumen(mes) {
  const supa = getAdminClient()
  const ahora = new Date()
  const mesStr = mes || `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`
  const [year, month] = mesStr.split('-').map(Number)
  const desde = new Date(Date.UTC(year, month - 1, 1)).toISOString()
  const hasta  = new Date(Date.UTC(year, month, 1)).toISOString()

  const [{ data: empresas }, { data: consumoRows }, { data: limites }] = await Promise.all([
    supa.from('empresas').select('id, nombre, activa').order('nombre'),
    supa.from('consumo_ia').select('empresa_id, modelo, tokens_entrada, tokens_salida, costo_usd')
      .gte('created_at', desde).lt('created_at', hasta),
    supa.from('nlu_spend_limits').select('*'),
  ])

  // Agrupar por empresa+modelo y llevar el total por empresa (para el % vs límite).
  const porEmpModelo = {}
  const totalEmpresa = {}
  for (const c of consumoRows ?? []) {
    const modelo = c.modelo || '—'
    const k = `${c.empresa_id}|${modelo}`
    if (!porEmpModelo[k]) porEmpModelo[k] = { empresa_id: c.empresa_id, modelo, entrada: 0, salida: 0, costo: 0 }
    porEmpModelo[k].entrada += (c.tokens_entrada ?? 0)
    porEmpModelo[k].salida  += (c.tokens_salida ?? 0)
    porEmpModelo[k].costo   += Number(c.costo_usd ?? 0)
    totalEmpresa[c.empresa_id] = (totalEmpresa[c.empresa_id] ?? 0) + Number(c.costo_usd ?? 0)
  }

  const limitesMap = {}
  for (const l of limites ?? []) limitesMap[l.empresa_id] = l

  const filas = []
  for (const e of empresas ?? []) {
    const lim = limitesMap[e.id]
    const base = {
      empresa_id:          e.id,
      empresa_nombre:      e.nombre,
      costo_empresa:       totalEmpresa[e.id] ?? 0,
      limite_mensual_usd:  lim?.limite_mensual_usd ?? null,
      accion_al_superar:   lim?.accion_al_superar ?? null,
      alerta_al_pct:       lim?.alerta_al_pct ?? 80,
      modelo_degradado_id: lim?.modelo_degradado_id ?? null,
    }
    const modelos = Object.values(porEmpModelo).filter((r) => r.empresa_id === e.id)
    if (modelos.length === 0) {
      filas.push({ ...base, modelo: null, tokens_entrada: 0, tokens_salida: 0, costo_usd: 0 })
    } else {
      for (const r of modelos) {
        filas.push({ ...base, modelo: r.modelo, tokens_entrada: r.entrada, tokens_salida: r.salida, costo_usd: r.costo })
      }
    }
  }
  return filas
}

// Crea o actualiza el límite de gasto de una empresa.
export async function upsertSpendLimit(empresaId, datos) {
  const supa = getAdminClient()
  const allowed = {}
  if (datos.limite_mensual_usd !== undefined)  allowed.limite_mensual_usd  = Number(datos.limite_mensual_usd)
  if (datos.accion_al_superar  !== undefined)  allowed.accion_al_superar   = datos.accion_al_superar
  if (datos.modelo_degradado_id !== undefined) allowed.modelo_degradado_id = datos.modelo_degradado_id || null
  if (datos.alerta_al_pct !== undefined)       allowed.alerta_al_pct       = Number(datos.alerta_al_pct)
  const { error } = await supa.from('nlu_spend_limits')
    .upsert({ empresa_id: empresaId, ...allowed }, { onConflict: 'empresa_id' })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

// Suspensión reversible (sprint 021). `activa = false` bloquea login de clientes
// y procesamiento del bot. `suspendida_at` queda como auditoría.
export async function setEmpresaActiva(empresaId, activa) {
  const supa = getAdminClient()
  const patch = { activa: !!activa, suspendida_at: activa ? null : new Date().toISOString() }
  const { error } = await supa.from('empresas').update(patch).eq('id', empresaId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

// Rota un token de conexión Telegram de la empresa (solo superadmin). `tipo`:
// 'vendedor' → telegram_token; 'admin' → telegram_token_admin. Genera un UUID nuevo
// e invalida el anterior para CONEXIONES NUEVAS (los operadores ya vinculados siguen).
export async function rotarTokenEmpresa(empresaId, tipo) {
  const campo = tipo === 'admin' ? 'telegram_token_admin'
    : tipo === 'vendedor' ? 'telegram_token'
    : null
  if (!campo) return { ok: false, message: 'Tipo de token no válido (vendedor | admin).' }
  const nuevo = crypto.randomUUID()
  const supa = getAdminClient()
  const { error } = await supa.from('empresas').update({ [campo]: nuevo }).eq('id', empresaId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, tipo, token: nuevo }
}

// Desconecta (elimina) un operador de Telegram de la empresa (solo superadmin).
// Scoped por empresa_id para no borrar de otra empresa por id equivocado.
export async function desconectarOperador(empresaId, usuarioId) {
  if (!usuarioId) return { ok: false, message: 'Falta el id del operador.' }
  const supa = getAdminClient()
  const { error } = await supa.from('usuarios').delete().eq('id', usuarioId).eq('empresa_id', empresaId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
