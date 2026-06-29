import { getAdminClient } from './adminClient'
import { encryptApiKey } from './cryptoModelo'

// ─── Catálogo de modelos NLU (tabla modelos_nlu, sprint 021) ──────────────────
// Antes era una constante hardcodeada; ahora el superadmin lo administra desde
// /superadmin/modelos. El bot resuelve el modelo contra esta misma tabla.

export const PROVEEDORES = ['groq', 'anthropic', 'openrouter', 'openai-compat']

// Fallback mínimo por si la tabla todavía no fue migrada (evita romper la UI).
const MODELOS_FALLBACK = [
  { id: 'groq-llama', label: 'Groq Llama 3.3', proveedor: 'groq', api_model_id: 'llama-3.3-70b-versatile', costo_in: 0.00000059, costo_out: 0.00000079, badge: 'Recomendado', activo: true, tiene_api_key: false },
]

export async function getModelosNlu({ soloActivos = false } = {}) {
  const supa = getAdminClient()
  let q = supa.from('modelos_nlu')
    .select('id, label, proveedor, api_model_id, base_url, costo_in, costo_out, badge, activo, created_at, api_key_enc')
    .order('created_at', { ascending: true })
  if (soloActivos) q = q.eq('activo', true)
  const { data, error } = await q
  if (error || !data) return MODELOS_FALLBACK
  if (!data.length) return MODELOS_FALLBACK
  // Nunca exponer el blob cifrado al cliente; solo un flag de si hay key propia.
  return data.map(({ api_key_enc, ...rest }) => ({ ...rest, tiene_api_key: !!api_key_enc }))
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
  const { id, label, proveedor, api_model_id, base_url, costo_in, costo_out, badge, api_key } = input ?? {}
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
  const { error } = await supa.from('modelos_nlu').insert({
    id: finalId,
    label: label.trim(),
    proveedor,
    api_model_id: api_model_id.trim(),
    base_url: baseUrl,
    costo_in: Number(costo_in) || 0,
    costo_out: Number(costo_out) || 0,
    badge: badge?.trim() || null,
    ...(api_key_enc ? { api_key_enc } : {}),
  })
  if (error) return { ok: false, message: error.code === '23505' ? 'Ya existe un modelo con ese id.' : error.message }
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
  if (patch.activo !== undefined)       allowed.activo = !!patch.activo
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
    .select('id, nombre, rubro, nlu_model, created_at, activa, suspendida_at, telegram_token, telegram_token_admin')
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
  const catalogo = await getModelosNlu()
  if (!catalogo.some(m => m.id === modelo)) {
    return { ok: false, message: 'Modelo no válido.' }
  }
  const supa = getAdminClient()
  const { error } = await supa.from('empresas').update({ nlu_model: modelo }).eq('id', empresaId)
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
