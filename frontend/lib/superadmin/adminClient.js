import { createClient } from '@supabase/supabase-js'

// Cliente Supabase con SERVICE_ROLE_KEY: bypassa RLS para que el superadmin
// pueda leer/escribir TODAS las empresas. Solo en server (nunca en el browser).
// La key debe estar en las env de Vercel (no en el repo): SERVICE_ROLE_KEY
// (mismo nombre que usa el bot) o SUPABASE_SERVICE_ROLE_KEY como fallback.

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseUrl = rawUrl.replace(/\/(rest|auth|storage|functions)(\/.*)?$/, '').replace(/\/$/, '')

export function getAdminClient() {
  const key = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !key) {
    throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL o SERVICE_ROLE_KEY para el panel superadmin.')
  }
  return createClient(supabaseUrl, key, { auth: { persistSession: false } })
}
