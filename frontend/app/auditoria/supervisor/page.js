'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuditoria } from '../AuditoriaShell'
import { canSupervise } from '../../../lib/auditoria/auth'
import { supabase } from '../../../lib/auditoria/queries'
import { Page, Title, Note, T } from '../../../lib/auditoria/ui'

export default function SupervisorPage() {
  const { session } = useAuditoria()
  const [critico, setCritico]           = useState({ agotados: [], bajo: [] })
  const [sinMovimiento, setSinMovimiento] = useState([])
  const [masVendidos, setMasVendidos]   = useState([])
  const [tab, setTab]                   = useState('critico')
  const [cargando, setCargando]         = useState(true)
  const [error, setError]               = useState('')
  const [expanded, setExpanded]         = useState(false)

  const cargar = useCallback(async () => {
    try {
      // Stock crítico
      const { data: stockRows } = await supabase
        .from('stock')
        .select('cantidad, productos(id, nombre, stock_minimo)')

      const porProducto = {}
      ;(stockRows ?? []).forEach(row => {
        const p = row.productos
        if (!p) return
        if (!porProducto[p.id])
          porProducto[p.id] = { id: p.id, nombre: p.nombre, minimo: p.stock_minimo ?? 5, total: 0 }
        porProducto[p.id].total += row.cantidad ?? 0
      })
      const todos = Object.values(porProducto)
      const agotados = todos.filter(p => p.total <= 0)
      const bajo     = todos.filter(p => p.total > 0 && p.total < p.minimo)

      // Sin movimiento 60+ días
      const hace180 = new Date(); hace180.setDate(hace180.getDate() - 180)
      const { data: historial } = await supabase
        .from('movimientos')
        .select('producto_id, created_at')
        .eq('tipo', 'venta')
        .gte('created_at', hace180.toISOString())
        .order('created_at', { ascending: false })

      const ultimaVenta = {}
      ;(historial ?? []).forEach(m => {
        if (!ultimaVenta[m.producto_id]) ultimaVenta[m.producto_id] = m.created_at
      })
      const hoy   = new Date()
      const hace60 = new Date(); hace60.setDate(hoy.getDate() - 60)

      const parados = todos
        .filter(p => p.total > 0)
        .filter(p => !ultimaVenta[p.id] || new Date(ultimaVenta[p.id]) < hace60)
        .map(p => ({
          ...p,
          dias: ultimaVenta[p.id]
            ? Math.floor((hoy - new Date(ultimaVenta[p.id])) / 86400000)
            : null,
        }))
        .sort((a, b) => (b.dias ?? 9999) - (a.dias ?? 9999))

      // Más vendidos 30 días
      const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30)
      const { data: ventas30 } = await supabase
        .from('movimientos')
        .select('producto_id, cantidad, productos(nombre)')
        .eq('tipo', 'venta')
        .gte('created_at', hace30.toISOString())

      const vendidos = {}
      ;(ventas30 ?? []).forEach(m => {
        const nombre = m.productos?.nombre
        if (!nombre) return
        if (!vendidos[m.producto_id])
          vendidos[m.producto_id] = { id: m.producto_id, nombre, total: 0 }
        vendidos[m.producto_id].total += m.cantidad ?? 0
      })
      const ranking = Object.values(vendidos).sort((a, b) => b.total - a.total)

      setCritico({ agotados, bajo })
      setSinMovimiento(parados)
      setMasVendidos(ranking)
      setError('')
    } catch (e) {
      console.error('Panel error:', e)
      setError('No se pudieron cargar los datos. Toca para reintentar.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    if (!canSupervise(session.rol)) { setCargando(false); return }
    cargar()
  }, [session, cargar])

  useEffect(() => { setExpanded(false) }, [tab])

  if (!session || cargando) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!canSupervise(session.rol)) return <Page><p style={{ color: T.muted }}>No tienes permiso.</p></Page>

  const totalCritico = critico.agotados.length + critico.bajo.length

  const LIMIT = 10
  const agotadosVis    = expanded ? critico.agotados : critico.agotados.slice(0, LIMIT)
  const bajoVis        = expanded ? critico.bajo : critico.bajo.slice(0, Math.max(0, LIMIT - agotadosVis.length))
  const criticoOcultos = totalCritico - agotadosVis.length - bajoVis.length
  const paradosVis     = expanded ? sinMovimiento : sinMovimiento.slice(0, LIMIT)
  const paradosOcultos = sinMovimiento.length - paradosVis.length
  const vendidosVis    = expanded ? masVendidos : masVendidos.slice(0, LIMIT)
  const vendidosOcultos = masVendidos.length - vendidosVis.length

  const TABS = [
    { id: 'critico',  icon: '⚠️', label: 'Falta stock',   sub: 'agotado o bajo mín.', value: totalCritico,        color: '#dc2626', bg: '#fef2f2' },
    { id: 'parados',  icon: '📦', label: 'Sin vender',     sub: '60+ días parado',      value: sinMovimiento.length, color: '#92400e', bg: '#fffbeb' },
    { id: 'vendidos', icon: '🔥', label: 'Más vendidos',   sub: 'últimos 30 días',      value: masVendidos.length,   color: '#065f46', bg: '#ecfdf5' },
  ]

  return (
    <Page>
      <Title>Panel</Title>
      {error && (
        <div onClick={cargar} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 12, cursor: 'pointer' }}>
          <p style={{ margin: 0, color: '#dc2626', fontSize: '0.88rem', fontWeight: 600 }}>{error}</p>
        </div>
      )}

      {/* ── Selector de vista ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            border: `2px solid ${tab === t.id ? t.color : T.line}`,
            borderRadius: 12, padding: '10px 6px', background: tab === t.id ? t.bg : '#fff',
            cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
          }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: t.color, lineHeight: 1 }}>{t.value}</div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: tab === t.id ? t.color : T.ink, marginTop: 4, lineHeight: 1.2 }}>{t.icon} {t.label}</div>
            <div style={{ fontSize: '0.62rem', color: T.faint, marginTop: 2, lineHeight: 1.2 }}>{t.sub}</div>
          </button>
        ))}
      </div>

      {/* ── Vista: Stock crítico ── */}
      {tab === 'critico' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {totalCritico === 0 ? (
            <Vacio>Todo en orden — sin alertas de stock</Vacio>
          ) : (
            <>
              {agotadosVis.length > 0 && <>
                <Etiqueta color="#dc2626">Agotados · {critico.agotados.length}</Etiqueta>
                {agotadosVis.map(p => (
                  <FilaSimple key={p.id} nombre={p.nombre}
                    badge="Sin stock" badgeColor="#dc2626" badgeBg="#fef2f2" />
                ))}
              </>}
              {bajoVis.length > 0 && <>
                <Etiqueta color="#92400e" style={{ marginTop: 10 }}>Bajo mínimo · {critico.bajo.length}</Etiqueta>
                {bajoVis.map(p => (
                  <FilaSimple key={p.id} nombre={p.nombre}
                    badge={`${p.total} / mín ${p.minimo}`} badgeColor="#92400e" badgeBg="#fffbeb" />
                ))}
              </>}
              {criticoOcultos > 0 && (
                <button onClick={() => setExpanded(true)} style={verMasStyle}>Ver {criticoOcultos} más</button>
              )}
              <Link href="/auditoria/inventario" style={{ marginTop: 8, fontSize: '0.82rem', color: T.primary, fontWeight: 600, textDecoration: 'none' }}>
                Ver inventario completo →
              </Link>
            </>
          )}
        </div>
      )}

      {/* ── Vista: Sin movimiento ── */}
      {tab === 'parados' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sinMovimiento.length === 0 ? (
            <Vacio>Todos los productos vendieron en los últimos 60 días</Vacio>
          ) : (
            <>
              <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: T.muted }}>
                Productos con stock que no vendieron en 60+ días — ordenados por más tiempo parado
              </p>
              {paradosVis.map((p, i) => {
                const maxDias = sinMovimiento[0]?.dias ?? 1
                const pct = p.dias != null ? Math.round((p.dias / (maxDias || 1)) * 100) : 100
                return (
                  <div key={p.id} style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                      <span style={{ fontSize: '0.88rem', color: T.ink, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
                        {p.nombre}
                      </span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400e', whiteSpace: 'nowrap' }}>
                        {p.dias != null ? `${p.dias} días` : 'Nunca vendido'}
                      </span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: '#f1f5f9' }}>
                      <div style={{ height: '100%', borderRadius: 99, background: pct > 80 ? '#dc2626' : pct > 50 ? '#f59e0b' : '#94a3b8', width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
              {paradosOcultos > 0 && (
                <button onClick={() => setExpanded(true)} style={verMasStyle}>Ver {paradosOcultos} más</button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Vista: Más vendidos ── */}
      {tab === 'vendidos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {masVendidos.length === 0 ? (
            <Vacio>Sin ventas registradas en los últimos 30 días</Vacio>
          ) : (
            <>
              <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: T.muted }}>
                Productos más vendidos en los últimos 30 días — por unidades
              </p>
              {vendidosVis.map((p, i) => {
                const max = masVendidos[0]?.total ?? 1
                const pct = Math.round((p.total / max) * 100)
                return (
                  <div key={p.id} style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: T.faint, marginRight: 6 }}>#{i + 1}</span>
                      <span style={{ fontSize: '0.88rem', color: T.ink, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
                        {p.nombre}
                      </span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#065f46', whiteSpace: 'nowrap' }}>
                        {p.total} und
                      </span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: '#f1f5f9' }}>
                      <div style={{ height: '100%', borderRadius: 99, background: '#10b981', width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
              {vendidosOcultos > 0 && (
                <button onClick={() => setExpanded(true)} style={verMasStyle}>Ver {vendidosOcultos} más</button>
              )}
            </>
          )}
        </div>
      )}
    </Page>
  )
}

function Etiqueta({ children, color, style }) {
  return (
    <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em', ...style }}>
      {children}
    </p>
  )
}

function FilaSimple({ nombre, badge, badgeColor, badgeBg }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 8, border: `1px solid ${T.line}` }}>
      <span style={{ fontSize: '0.88rem', color: T.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {nombre}
      </span>
      <span style={{ fontSize: '0.74rem', fontWeight: 600, color: badgeColor, background: badgeBg, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {badge}
      </span>
    </div>
  )
}

function Vacio({ children }) {
  return <p style={{ color: T.faint, fontSize: '0.88rem', margin: 0, padding: '16px 0' }}>{children}</p>
}

const verMasStyle = {
  marginTop: 4, width: '100%', padding: '10px', border: `1px dashed ${T.line}`,
  borderRadius: 10, background: 'transparent', cursor: 'pointer',
  fontSize: '0.82rem', fontWeight: 600, color: T.primary,
}
