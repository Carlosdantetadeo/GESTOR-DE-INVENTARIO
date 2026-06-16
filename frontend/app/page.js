'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Activity,
  Package,
  AlertTriangle
} from 'lucide-react'
import { getDashboardKPIs, getMovimientos, getTiendas, getStock, getEmpresaId } from '../lib/queries'
import { useRealtimeMovimientos } from '../lib/realtime'

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
  if (mov.tipo === 'traslado') {
    return `${mov.tienda_origen?.nombre || '?'} → ${mov.tienda_destino?.nombre || '?'}`
  }
  return mov.tienda_origen?.nombre || mov.tienda_destino?.nombre || '—'
}

export default function Dashboard() {
  const [empresaId, setEmpresaId] = useState(null)
  const [tiendas, setTiendas] = useState([])
  const [tiendaSeleccionada, setTiendaSeleccionada] = useState('all')
  const [range, setRange] = useState('today')
  const [movimientos, setMovimientos] = useState([])
  const [kpis, setKpis] = useState({ ventas: 0, ingresos: 0, gastos: 0, totalMovimientos: 0 })
  const [sinStockCount, setSinStockCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    getEmpresaId().then(setEmpresaId)
  }, [])

  useEffect(() => {
    if (!empresaId) return
    getTiendas(empresaId).then(setTiendas)
  }, [empresaId])

  const loadData = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    const tiendaId = tiendaSeleccionada === 'all' ? null : tiendaSeleccionada

    const [kpisData, movsData, stockData] = await Promise.all([
      getDashboardKPIs(empresaId, tiendaId, range),
      getMovimientos(empresaId, { tiendaId, limit: 20 }),
      getStock(empresaId, tiendaId)
    ])

    setKpis(kpisData)
    setMovimientos(movsData)

    // Productos sin stock: total ≤ 0 agregando todas las tiendas del alcance.
    // Es el dato del indicador simple (lenguaje no técnico, sin tabla).
    const totalPorProducto = {}
    stockData.forEach(s => {
      const pid = s.productos?.id
      if (!pid) return
      totalPorProducto[pid] = (totalPorProducto[pid] ?? 0) + (s.cantidad ?? 0)
    })
    setSinStockCount(Object.values(totalPorProducto).filter(t => t <= 0).length)

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

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '20px'
      }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Dashboard Consolidado</h1>
          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.9rem' }}>
            Monitoreo en tiempo real del stock e ingresos de tu cadena comercial.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="glass" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            fontWeight: 600,
            border: '1px solid hsl(var(--border))'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isRealtimeActive ? 'hsl(var(--color-ingreso))' : 'hsl(var(--text-muted))',
              display: 'inline-block',
              boxShadow: isRealtimeActive ? '0 0 10px hsl(var(--color-ingreso))' : 'none'
            }} />
            {isRealtimeActive ? 'TELEGRAM VINCULADO REALTIME' : 'SIN CONEXIÓN'}
          </div>

          <select
            value={tiendaSeleccionada}
            onChange={(e) => setTiendaSeleccionada(e.target.value)}
            className="input-field"
            style={{ width: '180px', padding: '10px 16px' }}
          >
            <option value="all">Todas las Tiendas</option>
            {tiendas.map(t => (
              <option key={t.id} value={String(t.id)}>{t.nombre}</option>
            ))}
          </select>

          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="input-field"
            style={{ width: '130px', padding: '10px 16px' }}
          >
            <option value="today">Hoy</option>
            <option value="7d">Últimos 7 Días</option>
            <option value="30d">Último Mes</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '24px'
      }}>
        <div className="glass-card animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', fontWeight: 600 }}>VENTAS</span>
            <div style={{ color: 'hsl(var(--color-venta))' }}><TrendingUp size={20} /></div>
          </div>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '8px' }}>
            {loading ? '—' : `S/ ${fmt(kpis.ventas)}`}
          </h2>
          <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.8rem' }}>Período seleccionado</span>
        </div>

        <div className="glass-card animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', fontWeight: 600 }}>STOCK RECIBIDO (VALOR)</span>
            <div style={{ color: 'hsl(var(--color-ingreso))' }}><Package size={20} /></div>
          </div>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '8px' }}>
            {loading ? '—' : `S/ ${fmt(kpis.ingresos)}`}
          </h2>
          <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.8rem' }}>Período seleccionado</span>
        </div>

        <div className="glass-card animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', fontWeight: 600 }}>GASTOS REGISTRADOS</span>
            <div style={{ color: 'hsl(var(--color-gasto))' }}><TrendingDown size={20} /></div>
          </div>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '8px' }}>
            {loading ? '—' : `S/ ${fmt(kpis.gastos)}`}
          </h2>
          <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.8rem' }}>Caja menor / Materiales</span>
        </div>

        <div className="glass-card animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', fontWeight: 600 }}>OPERACIONES POR VOZ</span>
            <div style={{ color: 'hsl(var(--accent))' }}><Activity size={20} /></div>
          </div>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '8px' }}>
            {loading ? '—' : kpis.totalMovimientos}
          </h2>
          <span style={{ color: 'hsl(var(--accent))', fontSize: '0.8rem', fontWeight: 600 }}>
            100% audio procesado
          </span>
        </div>
      </div>

      {/* Indicador simple de stock — sin tabla ni jerga técnica.
          Solo aparece cuando hay productos sin stock (total ≤ 0). */}
      {!loading && sinStockCount > 0 && (
        <Link
          href="/inventario?stock=critico"
          className="glass-card"
          style={{
            display: 'flex', alignItems: 'center', gap: '14px',
            padding: '18px 24px', textDecoration: 'none', color: 'inherit',
            borderLeft: '4px solid hsl(var(--color-gasto))',
          }}
        >
          <AlertTriangle size={22} style={{ color: 'hsl(var(--color-gasto))', flexShrink: 0 }} aria-hidden="true" />
          <span style={{ fontSize: '1rem', fontWeight: 600 }}>
            {sinStockCount} {sinStockCount === 1 ? 'producto sin stock' : 'productos sin stock'}
          </span>
          <span style={{
            color: 'hsl(var(--accent))', fontWeight: 600, marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
          }}>
            revisar inventario →
          </span>
        </Link>
      )}

      {/* Tabla de Movimientos en tiempo real */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '4px' }}>Historial del Operario (Telegram Voice Stream)</h3>
            <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.8rem' }}>Últimos registros auditados por el sistema IA</p>
          </div>
          {isUpdating && (
            <span style={{ fontSize: '0.8rem', color: 'hsl(var(--accent))', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
              Recibiendo audio...
            </span>
          )}
        </div>

        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Operación</th>
                <th>Producto / Item</th>
                <th>Cantidad</th>
                <th>Total</th>
                <th>Sucursal</th>
                <th>Hora</th>
                <th>Audio Transcrito (Groq Whisper)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    Cargando...
                  </td>
                </tr>
              ) : movimientos.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    Sin movimientos en este período.
                  </td>
                </tr>
              ) : movimientos.map((mov) => (
                <tr key={mov.id}>
                  <td><span className={`badge badge-${mov.tipo}`}>{mov.tipo}</span></td>
                  <td style={{ fontWeight: 600 }}>{mov.productos?.nombre || '—'}</td>
                  <td>{mov.cantidad} und</td>
                  <td style={{ fontWeight: 700 }}>S/ {Number(mov.total).toFixed(2)}</td>
                  <td>{getTiendaNombre(mov)}</td>
                  <td style={{ color: 'hsl(var(--text-secondary))' }}>{formatFecha(mov.created_at)}</td>
                  <td style={{
                    color: 'hsl(var(--text-muted))',
                    fontSize: '0.8rem',
                    fontStyle: 'italic',
                    maxWidth: '300px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }} title={mov.transcripcion || ''}>
                    {mov.transcripcion ? `"${mov.transcripcion}"` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
