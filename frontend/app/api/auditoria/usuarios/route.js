// Gestión de usuarios web de Almacenero Digital (US6). Crea usuarios de Supabase
// Auth con la identidad de tenant en app_metadata (empresa_id, rol, tienda_id).
// Requiere service role (solo server) y que quien llama sea ADMIN de su empresa.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getAdminClient } from '@/lib/superadmin/adminClient'

const ROLES = ['vendedor', 'supervisor', 'admin']

function normUrl() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return raw.replace(/\/(rest|auth|storage|functions)(\/.*)?$/, '').replace(/\/$/, '')
}

// Identifica a quien hace la petición a partir de su cookie de sesión.
async function getCaller() {
  const cookieStore = cookies()
  const sb = createServerClient(normUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
  })
  const { data: { user } } = await sb.auth.getUser()
  return user
}

// GET → lista los usuarios de la empresa del admin (app_metadata.empresa_id).
export async function GET() {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'no_autenticado' }, { status: 401 })
  const empresaId = caller.app_metadata?.empresa_id
  if (caller.app_metadata?.rol !== 'admin') return NextResponse.json({ error: 'no_admin' }, { status: 403 })

  const admin = getAdminClient()
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) return NextResponse.json({ error: 'listar_error' }, { status: 502 })

  const ahora = Date.now()
  const usuarios = data.users
    .filter((u) => u.app_metadata?.empresa_id === empresaId)
    .map((u) => ({
      id: u.id,
      email: u.email,
      nombre: u.app_metadata?.nombre ?? null,
      rol: u.app_metadata?.rol ?? null,
      tienda_id: u.app_metadata?.tienda_id ?? null,
      // banned_until en el futuro ⇒ usuario desactivado (no puede ingresar).
      activo: !u.banned_until || new Date(u.banned_until).getTime() <= ahora,
    }))
  return NextResponse.json({ usuarios })
}

// PATCH → actualiza el nombre visible de un usuario de la empresa del admin.
export async function PATCH(request) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'no_autenticado' }, { status: 401 })
  const empresaId = caller.app_metadata?.empresa_id
  if (caller.app_metadata?.rol !== 'admin') return NextResponse.json({ error: 'no_admin' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { id, nombre, activo } = body
  if (!id) return NextResponse.json({ error: 'faltan_datos' }, { status: 400 })

  const admin = getAdminClient()
  const { data: target, error: e0 } = await admin.auth.admin.getUserById(id)
  if (e0 || !target?.user) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 })
  // No dejar tocar usuarios de otra empresa.
  if (target.user.app_metadata?.empresa_id !== empresaId) return NextResponse.json({ error: 'otra_empresa' }, { status: 403 })

  // Activar / desactivar (ban reversible). El admin no puede desactivarse a sí mismo.
  if (typeof activo === 'boolean') {
    if (target.user.id === caller.id) return NextResponse.json({ error: 'no_uno_mismo' }, { status: 400 })
    const { error } = await admin.auth.admin.updateUserById(id, {
      ban_duration: activo ? 'none' : '876000h',
    })
    if (error) return NextResponse.json({ error: 'actualizar_error', detalle: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  const { error } = await admin.auth.admin.updateUserById(id, {
    app_metadata: { ...target.user.app_metadata, nombre: (nombre ?? '').trim() || null },
  })
  if (error) return NextResponse.json({ error: 'actualizar_error', detalle: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// POST → crea un usuario en la empresa del admin.
export async function POST(request) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'no_autenticado' }, { status: 401 })
  const empresaId = caller.app_metadata?.empresa_id
  if (caller.app_metadata?.rol !== 'admin') return NextResponse.json({ error: 'no_admin' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { email, nombre, rol, tienda_id } = body
  if (!email) return NextResponse.json({ error: 'faltan_datos' }, { status: 400 })
  if (!ROLES.includes(rol)) return NextResponse.json({ error: 'rol_invalido' }, { status: 400 })

  const admin = getAdminClient()

  // Reglas de límite por rol:
  // admin → máximo 1 por empresa (fijo)
  // supervisor → máximo 1 por empresa (fijo)
  // vendedor → limitado por max_usuarios de la empresa (configurable por plan)
  const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const mismos = (lista?.users || []).filter((u) => u.app_metadata?.empresa_id === empresaId)

  if (rol === 'admin') {
    const hayAdmin = mismos.some((u) => u.app_metadata?.rol === 'admin')
    if (hayAdmin) {
      return NextResponse.json({
        error: 'limite_usuarios',
        message: 'Esta empresa ya tiene un administrador. Solo se permite uno por empresa.',
      }, { status: 403 })
    }
  }

  if (rol === 'supervisor') {
    const haySupervisor = mismos.some((u) => u.app_metadata?.rol === 'supervisor')
    if (haySupervisor) {
      return NextResponse.json({
        error: 'limite_usuarios',
        message: 'Esta empresa ya tiene un supervisor. Solo se permite uno por empresa.',
      }, { status: 403 })
    }
  }

  if (rol === 'vendedor') {
    const { data: emp } = await admin.from('empresas').select('max_usuarios').eq('id', empresaId).maybeSingle()
    const limite = emp?.max_usuarios ?? null
    if (limite != null) {
      const actualesVendedores = mismos.filter((u) => u.app_metadata?.rol === 'vendedor').length
      if (actualesVendedores >= limite) {
        return NextResponse.json({
          error: 'limite_usuarios',
          message: `Alcanzaste el límite de ${limite} vendedor(es) de tu plan. Contacta al proveedor para ampliarlo.`,
        }, { status: 403 })
      }
    }
  }

  // Contraseña temporal generada por el server (mismo formato que el onboarding
  // del admin). El admin la ve una vez en pantalla y se la pasa al empleado.
  const password = `AD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { empresa_id: empresaId, rol, tienda_id: tienda_id ?? null, nombre: (nombre ?? '').trim() || null },
  })
  if (error) return NextResponse.json({ error: 'crear_error', detalle: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data.user.id, password })
}

// DELETE → elimina de forma permanente un usuario de la empresa del admin.
export async function DELETE(request) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'no_autenticado' }, { status: 401 })
  const empresaId = caller.app_metadata?.empresa_id
  if (caller.app_metadata?.rol !== 'admin') return NextResponse.json({ error: 'no_admin' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'faltan_datos' }, { status: 400 })

  const admin = getAdminClient()
  const { data: target, error: e0 } = await admin.auth.admin.getUserById(id)
  if (e0 || !target?.user) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 })
  if (target.user.app_metadata?.empresa_id !== empresaId) return NextResponse.json({ error: 'otra_empresa' }, { status: 403 })
  if (target.user.id === caller.id) return NextResponse.json({ error: 'no_uno_mismo' }, { status: 400 })

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: 'eliminar_error', detalle: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
