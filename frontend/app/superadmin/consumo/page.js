import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/superadmin/session'
import { getModelosNlu } from '@/lib/superadmin/data'
import ConsumoManager from './ConsumoManager'

export const metadata = { title: 'Consumo IA — Superadmin' }

export default async function ConsumoPage() {
  const token = cookies().get(SESSION_COOKIE)?.value
  const ok = await verifySession(token, process.env.SUPERADMIN_SECRET)
  if (!ok) redirect('/superadmin/login')

  const modelos = await getModelosNlu({ soloActivos: true })

  return <ConsumoManager modelosDisponibles={modelos} />
}
