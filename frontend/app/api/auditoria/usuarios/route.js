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

  const usuarios = data.users
    .filter((u) => u.app_metadata?.empresa_id === empresaId)
    .map((u) => ({ id: u.id, email: u.email, rol: u.app_metadata?.rol ?? null, tienda_id: u.app_metadata?.tienda_id ?? null }))
  return NextResponse.json({ usuarios })
}

// POST → crea un usuario en la empresa del admin.
export async function POST(request) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'no_autenticado' }, { status: 401 })
  const empresaId = caller.app_metadata?.empresa_id
  if (caller.app_metadata?.rol !== 'admin') return NextResponse.json({ error: 'no_admin' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { email, password, rol, tienda_id } = body
  if (!email || !password) return NextResponse.json({ error: 'faltan_datos' }, { status: 400 })
  if (!ROLES.includes(rol)) return NextResponse.json({ error: 'rol_invalido' }, { status: 400 })

  const admin = getAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { empresa_id: empresaId, rol, tienda_id: tienda_id ?? null },
  })
  if (error) return NextResponse.json({ error: 'crear_error', detalle: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data.user.id })
}
