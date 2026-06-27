// scripts/rollback-empresa-test.mjs
//
// Borra UNA empresa de test + sus usuarios de Supabase Auth, por empresa_id.
// Pensado para limpiar lo que creó crear-empresa-test.mjs.
//
// SEGURIDAD: por defecto SOLO borra si el nombre empieza con "ZZZ EMPRESA TEST"
// (el prefijo que pone el script de creación). Esto evita borrar una empresa real
// por pegar un id equivocado. Para forzar igual: setear FORCE=1 (usar con cuidado).
//
// Uso (desde frontend/):
//   $env:SERVICE_ROLE_KEY = "eyJ...el-service_role..."
//   $env:EMPRESA_ID       = "<empresa_id que imprimió el script de creación>"
//   node scripts/rollback-empresa-test.mjs
//   # o pasando el id como argumento:
//   node scripts/rollback-empresa-test.mjs <empresa_id>

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://sqsqyzqwysygoperjwsd.supabase.co'
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY
const EMPRESA_ID = process.argv[2] ?? process.env.EMPRESA_ID
const FORCE = process.env.FORCE === '1'
const SAFE_PREFIX = 'ZZZ EMPRESA TEST'

if (!SERVICE_ROLE_KEY) {
  console.error('✗ Falta la env var SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!EMPRESA_ID) {
  console.error('✗ Falta EMPRESA_ID (env var o primer argumento).')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  // 1) Verificar que la empresa existe y es de test (guard anti-borrado real)
  const { data: empresa, error: e0 } = await admin
    .from('empresas')
    .select('id, nombre, activa')
    .eq('id', EMPRESA_ID)
    .maybeSingle()

  if (e0) {
    console.error('✗ Error consultando empresa:', e0.message)
    process.exit(1)
  }
  if (!empresa) {
    console.error(`✗ No existe ninguna empresa con id ${EMPRESA_ID}. Nada que borrar.`)
    process.exit(1)
  }

  if (!empresa.nombre.startsWith(SAFE_PREFIX) && !FORCE) {
    console.error(
      `✗ ABORTADO: "${empresa.nombre}" no parece de test (no empieza con "${SAFE_PREFIX}").`,
    )
    console.error('  Si estás seguro de borrarla igual, reintentá con FORCE=1.')
    process.exit(1)
  }

  console.log(`→ Empresa a borrar: ${empresa.nombre} (${empresa.id})`)

  // 2) Borrar usuarios de Auth cuyo app_metadata.empresa_id == EMPRESA_ID
  const { data: list, error: e1 } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (e1) {
    console.error('✗ Error listando usuarios de Auth:', e1.message)
    process.exit(1)
  }
  const delUsers = list.users.filter(
    (u) => u.app_metadata?.empresa_id === EMPRESA_ID,
  )

  for (const u of delUsers) {
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) console.error(`  ✗ No se pudo borrar auth user ${u.email}: ${error.message}`)
    else console.log(`  ✓ Auth user borrado: ${u.email}`)
  }
  if (delUsers.length === 0) console.log('  (sin usuarios de Auth asociados)')

  // 3) Borrar la empresa (filas hijas caen por ON DELETE CASCADE si las hubiera)
  const { error: e2 } = await admin.from('empresas').delete().eq('id', EMPRESA_ID)
  if (e2) {
    console.error('✗ Error borrando empresa:', e2.message)
    process.exit(1)
  }

  console.log(`\n✅ Listo. Empresa de test eliminada (+${delUsers.length} usuario(s) de Auth).\n`)
}

main().catch((err) => {
  console.error('✗ Falla inesperada:', err)
  process.exit(1)
})
