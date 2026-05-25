'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Activity,
  Package,
  AlertCircle
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
  const [alertasStock, setAlertasStock] = useState([])
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

    // Derive low-stock alerts (cantidad < 5), worst first
    const alertas = stockData
      .filter(s => s.cantidad < 5)
      .sort((a, b) => a.cantidad - b.cantidad)
      .slice(0, 4)
    setAlertasStock(alertas)

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

      {/* Gráfico y Alertas */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', alignItems: 'start' }}>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem' }}>Evolución de Ventas vs Gastos</h3>
            <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.8rem' }}>Últimas 24 horas</span>
          </div>
          <div style={{ height: '220px', position: 'relative', paddingTop: '20px' }}>
            <svg style={{ position: 'absolute', width: '100%', height: '100%', top: 0, left: 0 }} viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M 0 80 Q 25 50 50 30 T 100 20" fill="none" stroke="hsl(var(--accent))" strokeWidth="2" />
              <path d="M 0 80 Q 25 50 50 30 T 100 20 L 100 100 L 0 100 Z" fill="url(#gradient-accent)" opacity="0.08" />
              <defs>
                <linearGradient id="gradient-accent" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="hsl(var(--accent))" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', color: 'hsl(var(--text-muted))', fontSize: '0.75rem', position: 'absolute', bottom: '-20px' }}>
              <span>08:00 AM</span><span>12:00 PM</span><span>04:00 PM</span><span>08:00 PM</span>
            </div>
          </div>
        </div>

        {/* Alertas Stock Bajo — datos reales de Supabase */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} style={{ color: 'hsl(var(--color-gasto))' }} />
            Alertas de Stock
          </h3>
          {loading ? (
            <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.85rem' }}>Cargando...</p>
          ) : alertasStock.length === 0 ? (
            <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.85rem' }}>Sin alertas críticas.</p>
          ) : alertasStock.map(s => (
            <div key={s.id} style={{
              padding: '12px',
              background: s.cantidad <= 2 ? 'rgba(244, 63, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)',
              border: `1px solid ${s.cantidad <= 2 ? 'rgba(244, 63, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
              borderRadius: 'var(--radius-sm)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{s.productos?.nombre || '—'}</span>
                <span style={{
                  fontSize: '0.8rem',
                  color: s.cantidad <= 2 ? 'hsl(var(--color-gasto))' : 'hsl(var(--color-traslado))',
                  fontWeight: 700
                }}>{s.cantidad} und</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>
                {s.tiendas?.nombre || '—'}
              </p>
            </div>
          ))}
        </div>
      </div>

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
