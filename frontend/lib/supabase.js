import { createBrowserClient } from '@supabase/ssr'

// createBrowserClient (de @supabase/ssr) almacena la sesión en cookies
// además de localStorage, lo que permite que el middleware de Next.js
// lea el JWT sin necesidad de llamadas adicionales al servidor.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)
