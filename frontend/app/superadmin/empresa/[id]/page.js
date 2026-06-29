import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSuperadmin } from '../../../../lib/superadmin/guard'
import { getEmpresaDetalle, getModelosNlu, modeloLabel, costoLabel } from '../../../../lib/superadmin/data'
import ModeloSelector from './ModeloSelector'
import EstadoEmpresa from './EstadoEmpresa'
import TokensTelegram from './TokensTelegram'
import OperariosSuperadmin from './OperariosSuperadmin'

export const dynamic = 'force-dynamic'

function fmtFecha(s, conHora = false) {
  if (!s) return 'Sin actividad'
  return new Date(s).toLocaleString('es-PE', conHora
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const card = { background: 'hsl(var(--bg-surface))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius-lg)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }
const label = { fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.04em' }
const th = { padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--text-muted))', fontSize: '0.74rem', whiteSpace: 'nowrap' }
const td = { padding: '10px 14px', fontSize: '0.84rem', whiteSpace: 'nowrap' }

export default async function EmpresaDetalle({ params }) {
  await requireSuperadmin()
  const [detalle, catalogo] = await Promise.all([getEmpresaDetalle(params.id), getModelosNlu()])
  if (!detalle) notFound()
  const { empresa, consumoMensual, operarios } = detalle
  const modelosActivos = catalogo
    .filter(m => m.activo)
    .map(m => ({ id: m.id, label: m.label, badge: m.badge || '', costo: costoLabel(m) }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '900px' }}>
      <div>
        <Link href="/superadmin" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'hsl(var(--text-muted))', textDecoration: 'none', marginBottom: '10px' }}>
          <ArrowLeft size={14} /> Empresas
        </Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{empresa.nombre}</h1>
      </div>

      {/* Sección 1 — Info general */}
      <section style={card}>
        <div style={label}>Información general</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
          <Info k="Nombre" v={empresa.nombre} />
          <Info k="Rubro" v={empresa.rubro || '—'} />
          <Info k="Fecha de alta" v={fmtFecha(empresa.created_at)} />
          <Info k="Estado" v={empresa.activa === false ? '⛔ Suspendida' : '🟢 Activa'} />
        </div>
      </section>

      {/* Sección — Estado / suspensión */}
      <section style={card}>
        <div style={label}>Suspensión</div>
        <EstadoEmpresa empresaId={empresa.id} activa={empresa.activa !== false} />
      </section>

      {/* Sección — Tokens de conexión Telegram */}
      <section style={card}>
        <div style={label}>Conexión Telegram</div>
        <TokensTelegram
          empresaId={empresa.id}
          tokenVendedor={empresa.telegram_token}
          tokenAdmin={empresa.telegram_token_admin}
        />
      </section>

      {/* Sección 2 — Modelo NLU */}
      <section style={card}>
        <div style={label}>Modelo NLU</div>
        <p style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))', margin: 0 }}>
          El cambio aplica al siguiente mensaje del bot de esta empresa.
        </p>
        <ModeloSelector empresaId={empresa.id} current={empresa.nlu_model} modelos={modelosActivos} />
      </section>

      {/* Sección 3 — Consumo de tokens */}
      <section style={card}>
        <div style={label}>Consumo de tokens (historial mensual)</div>
        {consumoMensual.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))', margin: 0 }}>Sin consumo registrado todavía.</p>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius-md)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'hsl(var(--bg-base))' }}>
                  <th style={th}>Mes</th><th style={th}>Modelo</th><th style={th}>Llamadas</th><th style={th}>Tokens</th><th style={th}>Costo USD</th>
                </tr>
              </thead>
              <tbody>
                {consumoMensual.map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid hsl(var(--border))' }}>
                    <td style={td}>{c.mes}</td>
                    <td style={td}>{modeloLabel(c.modelo, catalogo)}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{c.llamadas.toLocaleString()}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{c.tokens.toLocaleString()}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>${c.costo.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sección 4 — Operarios (con Desconectar) */}
      <section style={card}>
        <div style={label}>Operarios</div>
        <OperariosSuperadmin empresaId={empresa.id} operarios={operarios} />
      </section>
    </div>
  )
}

function Info({ k, v }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', marginBottom: '3px' }}>{k}</div>
      <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{v}</div>
    </div>
  )
}
