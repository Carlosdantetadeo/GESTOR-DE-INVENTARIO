import { requireSuperadmin } from '../../../lib/superadmin/guard'
import { getModelosNlu } from '../../../lib/superadmin/data'
import ModelosManager from './ModelosManager'

export const dynamic = 'force-dynamic'

export default async function SuperadminModelos() {
  await requireSuperadmin()
  const modelos = await getModelosNlu()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1000px' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px' }}>Modelos NLU</h1>
        <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
          Catálogo de modelos disponibles para asignar a las empresas. Soporta Groq, Anthropic y OpenRouter.
        </p>
      </div>
      <ModelosManager inicial={modelos} />
    </div>
  )
}
