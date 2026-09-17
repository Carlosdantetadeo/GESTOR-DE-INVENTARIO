import { requireSuperadmin } from '../../../lib/superadmin/guard'
import NuevaEmpresaForm from './NuevaEmpresaForm'

export const dynamic = 'force-dynamic'

export default async function NuevaEmpresaPage() {
  await requireSuperadmin()
  return <NuevaEmpresaForm />
}
