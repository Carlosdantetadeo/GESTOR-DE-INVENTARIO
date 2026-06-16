import Link from 'next/link'
import { requireSuperadmin } from '../../lib/superadmin/guard'
import { getEmpresasResumen, modeloLabel } from '../../lib/superadmin/data'

export const dynamic = 'force-dynamic'

function fmtFecha(s) {
  if (!s) return 'Sin actividad'
  return new Date(s).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const th = { padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--text-muted))', fontSize: '0.75rem', whiteSpace: 'nowrap' }
const td = { padding: '12px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap' }

export default async function SuperadminEmpresas() {
  await requireSuperadmin()
  const empresas = await getEmpresasResumen()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1100px' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px' }}>Empresas suscritas</h1>
        <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
          {empresas.length} {empresas.length === 1 ? 'empresa' : 'empresas'} · consumo del mes en curso
        </p>
      </div>

      <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-base))' }}>
              <th style={th}>Empresa</th>
              <th style={th}>Rubro</th>
              <th style={th}>Operarios</th>
              <th style={th}>Modelo NLU</th>
              <th style={th}>Tokens (mes)</th>
              <th style={th}>Costo est. (mes)</th>
              <th style={th}>Último movimiento</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {empresas.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', padding: '32px' }} colSpan={8}>No hay empresas registradas.</td></tr>
            ) : empresas.map((e, i) => (
              <tr key={e.id} style={{ borderBottom: i < empresas.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}>
                <td style={{ ...td, fontWeight: 600 }}>{e.nombre}</td>
                <td style={{ ...td, color: 'hsl(var(--text-secondary))' }}>{e.rubro || '—'}</td>
                <td style={td}>{e.operarios}</td>
                <td style={td}>{modeloLabel(e.nluModel)}</td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{e.tokensMes.toLocaleString()}</td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>${e.costoMes.toFixed(4)}</td>
                <td style={{ ...td, color: 'hsl(var(--text-secondary))' }}>{fmtFecha(e.ultimoMovimiento)}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <Link href={`/superadmin/empresa/${e.id}`} className="btn btn-primary" style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
                    Gestionar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
