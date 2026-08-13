// Queries de AuditorIA a Supabase. Módulo propio: NO se toca frontend/lib/queries.js.
// El cliente `supabase` (anon key + sesión) aplica RLS, que filtra por
// empresa_id vía get_my_empresa_id() (app_metadata).
import { supabase } from '../supabase'

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
