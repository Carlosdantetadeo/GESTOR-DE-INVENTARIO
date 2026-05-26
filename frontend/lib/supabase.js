import { createBrowserClient } from '@supabase/ssr'

// Normaliza la URL por si el env var tiene /rest/v1 u otra ruta de más
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseUrl = rawUrl.replace(/\/(rest|auth|storage|functions)(\/.*)?$/, '').replace(/\/$/, '')

export const supabase = createBrowserClient(
  supabaseUrl,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)
