// scripts/crear-empresa-test.mjs
//
// Crea UNA empresa de test nueva + su usuario admin (Supabase Auth), para
// validar el login SIN tocar ninguna empresa/cuenta real.
//
// - NO modifica datos existentes: solo INSERT de una empresa nueva y createUser.
// - El service_role se lee de la env var SERVICE_ROLE_KEY (no queda en el código).
// - La password se genera aleatoria y se imprime UNA vez al final.
//
// Uso (desde frontend/):
//   $env:SERVICE_ROLE_KEY = "eyJ...el-service_role..."   # Settings > API > service_role
//   node scripts/crear-empresa-test.mjs
//
// Limpieza después de validar (borra SOLO lo que creó este script):
//   - Auth: Dashboard > Authentication > Users > borrar el email de abajo
//   - DB:   delete from empresas where id = '<empresa_id impreso>';
//           (las filas hijas caen por ON DELETE CASCADE si las hubiera)

import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'

// ── Config ────────────────────────────────────────────────────────────────
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://sqsqyzqwysygoperjwsd.supabase.co'
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY

// Email del admin de prueba. email_confirm: true => no necesita recibir correo.
// Cambialo si querés; no hace falta que sea una casilla real para hacer login.
const TEST_EMAIL = `qa-login+${Date.now()}@agent-gms.test`

if (!SERVICE_ROLE_KEY) {
  console.error('✗ Falta la env var SERVICE_ROLE_KEY. Seteala y reintentá.')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// password aleatoria fuerte (24 bytes => ~32 chars base64url)
const tempPassword = randomBytes(24).toString('base64url')

async function main() {
  // 1) Empresa de test nueva (activa = true). telegram_token* son UNIQUE => UUID.
  const { data: empresa, error: e1 } = await admin
    .from('empresas')
    .insert({
      nombre: `ZZZ EMPRESA TEST (QA login) ${new Date().toISOString().slice(0, 16)}`,
      rubro: 'ferretería',
      activa: true,
      telegram_token: randomUUID(),
      telegram_token_admin: randomUUID(),
    })
    .select('id, nombre, activa')
    .single()

  if (e1) {
    console.error('✗ Error creando empresa:', e1.message)
    process.exit(1)
  }

  // 2) Usuario admin en Supabase Auth. empresa_id/rol van en app_metadata
  //    (NUNCA en user_metadata: es editable por el usuario). email_confirm: true.
  const { data: user, error: e2 } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { empresa_id: empresa.id, rol: 'admin' },
  })

  if (e2) {
    console.error('✗ Error creando usuario auth:', e2.message)
    console.error('  La empresa quedó creada. Para revertir: delete from empresas where id =', `'${empresa.id}';`)
    process.exit(1)
  }

  // 3) Credenciales (se muestran una sola vez)
  console.log('\n✅ Empresa de test + admin creados (no se tocó ninguna empresa real)\n')
  console.log('  empresa_id :', empresa.id)
  console.log('  empresa    :', empresa.nombre, '| activa:', empresa.activa)
  console.log('  user_id    :', user.user.id)
  console.log('  ── credenciales de login ──')
  console.log('  email      :', TEST_EMAIL)
  console.log('  password   :', tempPassword)
  console.log('\n  Probá el login en el preview/login con ese email + password.')
  console.log('  Cuando termines, borrá el user en Auth y la empresa (ver cabecera del script).\n')
}

main().catch((err) => {
  console.error('✗ Falla inesperada:', err)
  process.exit(1)
})
