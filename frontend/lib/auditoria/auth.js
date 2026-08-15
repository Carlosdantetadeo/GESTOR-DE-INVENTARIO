// Identidad y rol de AuditorIA. La identidad de tenant vive en app_metadata
// (nunca user_metadata — Constitución III). El middleware global ya exige
// sesión Supabase en /auditoria; aquí resolvemos empresa_id, rol y tienda_id.
import { supabase } from '../supabase'

export const ROLES = {
  VENDEDOR: 'vendedor',
  SUPERVISOR: 'supervisor',
  ADMIN: 'admin',
}

// Rol de campo: solo registra ventas (no toca inventario ni cuenta).
export function isVendedor(rol) {
  return rol === ROLES.VENDEDOR
}

// Devuelve { user, empresaId, rol, tiendaId } o null si no hay sesión.
export async function getAuditoriaSession() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const md = user.app_metadata || {}
  return {
    user,
    empresaId: md.empresa_id ?? null,
    rol: md.rol ?? null,
    tiendaId: md.tienda_id ?? null,
  }
}

// Supervisor y admin pueden aprobar piezas nuevas y cerrar sesiones (FR-007).
export function canSupervise(rol) {
  return rol === ROLES.SUPERVISOR || rol === ROLES.ADMIN
}

// Admin gestiona catálogo, usuarios y configuración.
export function isAdmin(rol) {
  return rol === ROLES.ADMIN
}
