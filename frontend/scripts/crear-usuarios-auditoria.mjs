// scripts/crear-usuarios-auditoria.mjs
//
// Crea (o actualiza) 3 usuarios de prueba de Almacenero Digital, uno por rol,
// con app_metadata correcto (empresa_id, rol, tienda_id). Idempotente: si el
// email ya existe, actualiza password + metadata.
//
// - Lee SERVICE_ROLE_KEY desde frontend/.env.local (no queda en el código).
// - Elige automáticamente la empresa con más productos y su primera sede,
//   salvo que pases EMPRESA_ID / TIENDA_ID por env.
//
// Uso (desde frontend/):  node scripts/crear-usuarios-auditoria.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// ── Cargar .env.local ─────────────────────────────────────────────────────────
function envLocal() {
  const out = {}
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* si no existe, usamos process.env */ }
  return out
}
const env = { ...envLocal(), ...process.env }

const SUPABASE_URL = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
const SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✗ Falta NEXT_PUBLIC_SUPABASE_URL o SERVICE_ROLE_KEY en frontend/.env.local')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const USUARIOS = [
  { email: 'vendedor@almacenero.test', password: 'Vendedor1234', rol: 'vendedor' },
  { email: 'supervisor@almacenero.test', password: 'Supervisor1234', rol: 'supervisor' },
  { email: 'admin@almacenero.test', password: 'Admin1234', rol: 'admin' },
]

async function elegirEmpresaYSede() {
  if (env.EMPRESA_ID && env.TIENDA_ID) return { empresaId: env.EMPRESA_ID, tiendaId: Number(env.TIENDA_ID) }

  const { data: prods } = await admin.from('productos').select('empresa_id')
  const conteo = new Map()
  for (const p of prods || []) if (p.empresa_id) conteo.set(p.empresa_id, (conteo.get(p.empresa_id) || 0) + 1)
  let empresaId = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  if (!empresaId) {
    const { data: emp } = await admin.from('empresas').select('id').limit(1).single()
    empresaId = emp?.id
  }
  const { data: tienda } = await admin.from('tiendas').select('id').eq('empresa_id', empresaId).order('id').limit(1).single()
  return { empresaId, tiendaId: tienda?.id ?? null }
}

async function upsertUsuario({ email, password, rol }, app_metadata) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata })
  if (!error) return { email, id: data.user.id, creado: true }

  // Ya existe → buscarlo y actualizar password + metadata.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existente = list.users.find((u) => u.email === email)
  if (!existente) throw new Error(`No se pudo crear ni encontrar ${email}: ${error.message}`)
  await admin.auth.admin.updateUserById(existente.id, { password, app_metadata })
  return { email, id: existente.id, creado: false }
}

async function main() {
  const { empresaId, tiendaId } = await elegirEmpresaYSede()
  if (!empresaId || !tiendaId) {
    console.error('✗ No se encontró empresa/sede. Pasá EMPRESA_ID y TIENDA_ID por env.')
    process.exit(1)
  }
  console.log(`\nEmpresa: ${empresaId}  |  Sede: ${tiendaId}\n`)

  for (const u of USUARIOS) {
    const r = await upsertUsuario(u, { empresa_id: empresaId, rol: u.rol, tienda_id: tiendaId })
    console.log(`  ${r.creado ? '➕ creado ' : '♻️ actualizado'}  ${u.rol.padEnd(10)}  ${u.email}  /  ${u.password}`)
  }
  console.log('\n✅ Listo. Ingresá en /login con cualquiera de esos emails.\n')
}

main().catch((err) => { console.error('✗ Falla:', err.message); process.exit(1) })
