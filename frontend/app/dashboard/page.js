'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, RefreshCw, BarChart2,
  Package, AlertTriangle, Wifi, WifiOff, ChevronRight,
} from 'lucide-react'
import { getDashboardKPIs, getMovimientos, getTiendas, getStock, getEmpresaId } from '../../lib/queries'
import { useRealtimeMovimientos } from '../../lib/realtime'

function formatFecha(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Ahora mismo'
  if (mins < 60) return `Hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Hace ${hours} h`
  return new Date(dateStr).toLocaleDateString('es-PE')
}

function getTiendaNombre(mov) {
  if (mov.tipo === 'traslado') return `${mov.tienda_origen?.nombre || '?'} → ${mov.tienda_destino?.nombre || '?'}`
  return mov.tienda_origen?.nombre || mov.tienda_destino?.nombre || '—'
}

const TIPO_LABELS = { venta: 'Venta', ingreso: 'Ingreso', gasto: 'Gasto', traslado: 'Traslado', ajuste: 'Ajuste' }

export default function Dashboard() {
  const [empresaId, setEmpresaId] = useState(null)
  const [tiendas, setTiendas] = useState([])
  const [tiendaSeleccionada, setTiendaSeleccionada] = useState('all')
  const [range, setRange] = useState('today')
  const [filterTipo, setFilterTipo] = useState('all')
  const [movimientos, setMovimientos] = useState([])
  const [kpis, setKpis] = useState({ ventas: 0, ingresos: 0, gastos: 0, totalMovimientos: 0 })
  const [stockProblemas, setStockProblemas] = useState([])
  const [loading, setLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => { getEmpresaId().then(setEmpresaId) }, [])
  useEffect(() => { if (!empresaId) return; getTiendas(empresaId).then(setTiendas) }, [empresaId])

  const loadData = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    const tiendaId = tiendaSeleccionada === 'all' ? null : tiendaSeleccionada

    const [kpisData, movsData, stockData] = await Promise.all([
      getDashboardKPIs(empresaId, tiendaId, range),
      getMovimientos(empresaId, { tiendaId, limit: 20 }),
      getStock(empresaId, tiendaId),
    ])

    setKpis(kpisData)
    setMovimientos(movsData)

    // Agrupar stock por producto para detectar problemas
    const map = {}
    stockData.forEach(s => {
      const p = s.productos
      if (!p) return
      if (!map[p.id]) map[p.id] = { id: p.id, nombre: p.nombre, referencia: p.referencia || null, stockMinimo: p.stock_minimo ?? 5, total: 0 }
      map[p.id].total += s.cantidad ?? 0
    })
    const problemas = Object.values(map)
      .filter(p => p.total < p.stockMinimo)
      .sort((a, b) => a.total - b.total)
      .slice(0, 6)
    setStockProblemas(problemas)

    setLoading(false)
  }, [empresaId, tiendaSeleccionada, range])

  useEffect(() => { loadData() }, [loadData])

  const handleNewMovimiento = useCallback((newMov) => {
    setIsUpdating(true)
    setTimeout(() => {
      setMovimientos(prev => [newMov, ...prev.slice(0, 19)])
      setKpis(prev => {
        const val = Number(newMov.total) || 0
        return {
          ...prev,
          totalMovimientos: prev.totalMovimientos + 1,
          ventas: newMov.tipo === 'venta' ? prev.ventas + val : prev.ventas,
          ingresos: newMov.tipo === 'ingreso' ? prev.ingresos + val : prev.ingresos,
          gastos: newMov.tipo === 'gasto' ? prev.gastos + val : prev.gastos,
        }
      })
      setIsUpdating(false)
    }, 300)
  }, [])

  const isRealtimeActive = useRealtimeMovimientos(empresaId, handleNewMovimiento)
  const fmt = (n) => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const movsFiltrados = filterTipo === 'all' ? movimientos : movimientos.filter(m => m.tipo === filterTipo)
  const rangeLabelMap = { today: 'hoy', '7d': 'últimos 7 días', '30d': 'último mes' }

  const agotados = stockProblemas.filter(p => p.total <= 0)
  const bajos = stockProblemas.filter(p => p.total > 0)

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '1.7rem', fontWeight: 800, marginBottom: '4px' }}>Panel de control</h1>
          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.88rem' }}>
            Resumen operativo del negocio: ventas, movimientos y alertas de stock.
          </p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '7px',
          padding: '7px 14px', borderRadius: 'var(--radius-sm)',
          background: isRealtimeActive ? 'hsl(142 72% 29% / 0.12)' : 'hsl(var(--bg-surface))',
          border: `1px solid ${isRealtimeActive ? 'hsl(142 72% 29% / 0.35)' : 'hsl(var(--border))'}`,
          fontSize: '0.78rem', fontWeight: 600,
          color: isRealtimeActive ? 'hsl(142 72% 38%)' : 'hsl(var(--text-muted))',
        }}>
          {isRealtimeActive ? <><Wifi size={14} /> En vivo</> : <><WifiOff size={14} /> Sin conexión en vivo</>}
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="glass-card" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Sede</label>
            <select value={tiendaSeleccionada} onChange={e => setTiendaSeleccionada(e.target.value)} className="input-field">
              <option value="all">Todas las sedes</option>
              {tiendas.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Período</label>
            <select value={range} onChange={e => setRange(e.target.value)} className="input-field">
              <option value="today">Hoy</option>
              <option value="7d">Últimos 7 días</option>
              <option value="30d">Último mes</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Tipo de operación</label>
            <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} className="input-field">
              <option value="all">Todos</option>
              <option value="venta">Ventas</option>
              <option value="ingreso">Ingresos de stock</option>
              <option value="gasto">Gastos</option>
              <option value="traslado">Traslados</option>
              <option value="ajuste">Ajustes</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <KpiCard delay="0.1s" label="Total vendido" hint={`Cobrado a clientes ${rangeLabelMap[range] || ''}`}
          value={loading ? null : `S/ ${fmt(kpis.ventas)}`} icon={<TrendingUp size={20} />} color="var(--color-venta)" />
        <KpiCard delay="0.2s" label="Mercadería ingresada" hint="Valor del stock recibido en el período"
          value={loading ? null : `S/ ${fmt(kpis.ingresos)}`} icon={<Package size={20} />} color="var(--color-ingreso)" />
        <KpiCard delay="0.3s" label="Gastos registrados" hint="Egresos de caja chica y materiales"
          value={loading ? null : `S/ ${fmt(kpis.gastos)}`} icon={<TrendingDown size={20} />} color="var(--color-gasto)" />
        <KpiCard delay="0.4s" label="Movimientos totales" hint={`Operaciones registradas ${rangeLabelMap[range] || ''}`}
          value={loading ? null : String(kpis.totalMovimientos)} icon={<BarChart2 size={20} />} color="var(--accent)" />
      </div>

      {/* ── Alertas de stock ── */}
      {!loading && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0', padding: 0, overflow: 'hidden' }}>
          {/* Cabecera */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: stockProblemas.length > 0 ? '1px solid hsl(var(--border))' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle size={17} style={{ color: stockProblemas.length > 0 ? 'hsl(38 85% 40%)' : 'hsl(142 60% 32%)' }} />
              <div>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Estado del stock</span>
                <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', marginLeft: '10px' }}>
                  {stockProblemas.length === 0
                    ? 'Todo en orden — sin productos críticos'
                    : `${agotados.length} agotado${agotados.length !== 1 ? 's' : ''} · ${bajos.length} bajo mínimo`}
                </span>
              </div>
            </div>
            <Link href="/inventario" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--accent))', textDecoration: 'none' }}>
              Ver inventario completo <ChevronRight size={14} />
            </Link>
          </div>

          {/* Lista de productos críticos */}
          {stockProblemas.length > 0 && (
            <div>
              {stockProblemas.map((p, i) => {
                const agotado = p.total <= 0
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: '14px',
                    padding: '11px 20px',
                    borderBottom: i < stockProblemas.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                    background: agotado ? 'hsl(0 75% 55% / 0.04)' : 'transparent',
                  }}>
                    {/* Dot de estado */}
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: agotado ? 'hsl(0 75% 48%)' : 'hsl(38 92% 50%)',
                    }} />
                    {/* Nombre + ref */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.nombre}
                      </div>
                      {p.referencia && (
                        <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', fontFamily: 'monospace' }}>{p.referencia}</div>
                      )}
                    </div>
                    {/* Cantidad */}
                    <span style={{
                      fontSize: '0.82rem', fontWeight: 700,
                      color: agotado ? 'hsl(0 75% 48%)' : 'hsl(38 85% 40%)',
                      background: agotado ? 'hsl(0 75% 55% / 0.1)' : 'hsl(38 92% 50% / 0.1)',
                      padding: '3px 10px', borderRadius: '99px',
                      whiteSpace: 'nowrap',
                    }}>
                      {agotado ? 'Agotado' : `${p.total} und`}
                    </span>
                    {/* Mínimo */}
                    {!agotado && (
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', whiteSpace: 'nowrap' }}>
                        mín. {p.stockMinimo}
                      </span>
                    )}
                  </div>
                )
              })}
              {/* Footer: ir a inventario */}
              <Link href="/inventario?stock=critico" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '11px', borderTop: '1px solid hsl(var(--border))',
                fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--accent))',
                textDecoration: 'none', background: 'hsl(var(--bg-base))',
                transition: 'background 0.15s',
              }}>
                Ver todos los productos con alerta <ChevronRight size={14} />
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── Últimos movimientos ── */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '3px' }}>Últimos movimientos</h3>
            <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.8rem' }}>
              Las 20 operaciones más recientes de tu equipo.
            </p>
          </div>
          {isUpdating && (
            <span style={{ fontSize: '0.78rem', color: 'hsl(var(--accent))', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Actualizando…
            </span>
          )}
        </div>

        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Total</th>
                <th>Sede</th>
                <th>Hora</th>
                <th>Descripción</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>Cargando…</td></tr>
              ) : movsFiltrados.length === 0 ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>Sin movimientos en este período.</td></tr>
              ) : movsFiltrados.map((mov) => (
                <tr key={mov.id}>
                  <td><span className={`badge badge-${mov.tipo}`}>{TIPO_LABELS[mov.tipo] || mov.tipo}</span></td>
                  <td style={{ fontWeight: 600 }}>{mov.productos?.nombre || '—'}</td>
                  <td>{mov.cantidad} und</td>
                  <td style={{ fontWeight: 700 }}>S/ {Number(mov.total).toFixed(2)}</td>
                  <td>{getTiendaNombre(mov)}</td>
                  <td style={{ color: 'hsl(var(--text-secondary))' }}>{formatFecha(mov.created_at)}</td>
                  <td style={{ color: 'hsl(var(--text-muted))', fontSize: '0.8rem', fontStyle: 'italic', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={mov.transcripcion || ''}>
                    {mov.transcripcion ? `"${mov.transcripcion}"` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx global>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: '0.75rem', fontWeight: 600,
  color: 'hsl(var(--text-secondary))', marginBottom: '6px',
  textTransform: 'uppercase', letterSpacing: '0.04em',
}

function KpiCard({ label, hint, value, icon, color, delay }) {
  return (
    <div className="glass-card animate-fade-in" style={{ animationDelay: delay }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
          <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', marginTop: '2px' }}>{hint}</div>
        </div>
        <div style={{ color: `hsl(${color})`, opacity: 0.85 }}>{icon}</div>
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
        {value ?? <span style={{ color: 'hsl(var(--text-muted))' }}>—</span>}
      </div>
    </div>
  )
}
