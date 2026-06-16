import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from './session'

// Verifica la sesión superadmin en server components (defensa en profundidad,
// además del middleware). Redirige al login si no hay sesión válida.
export async function requireSuperadmin() {
  const token = cookies().get(SESSION_COOKIE)?.value
  const payload = await verifySession(token, process.env.SUPERADMIN_SECRET)
  if (!payload) redirect('/superadmin/login')
  return payload
}
