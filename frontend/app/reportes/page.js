'use client'

import { useState, useEffect } from 'react'
import { FileSpreadsheet, FileText, TrendingUp, Package, ArrowLeftRight, RefreshCw, Info } from 'lucide-react'
import { getMovimientos, getStock, getTiendas, getEmpresaId, getEmpresa } from '../../lib/queries'
import { exportToPDF, exportToExcel } from '../../lib/export'

function getTiendaNombre(mov) {
  if (mov.tipo === 'traslado') {
    return `${mov.tienda_origen?.nombre || '?'} → ${mov.tienda_destino?.nombre || '?'}`
  }
  return mov.tienda_origen?.nombre || mov.tienda_destino?.nombre || '—'
}

function formatFecha(dateStr) {
  return new Date(dateStr).toLocaleString('es-PE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

const REPORTES = [
  {
    id: 'ventas',
    nombre: 'Reporte de ventas',
    desc: 'Todas las ventas registradas: producto, cantidad, precio y vendedor.',
    paraQue: 'Para revisar cuánto se vendió, qué productos se movieron más y cruzar con tu caja.',
    icon: TrendingUp,
    color: 'var(--color-venta)',
  },
  {
    id: 'inventario',
    nombre: 'Valorización de almacén',
    desc: 'Stock actual por sede con el costo unitario y el valor total del inventario.',
    paraQue: 'Para saber cuánto vale tu mercadería, útil para el contador y para pedir reposición.',
    icon: Package,
    color: 'var(--color-ingreso)',
  },
  {
    id: 'movimientos',
    nombre: 'Historial de operaciones',
    desc: 'Registro completo de ingresos, salidas, traslados y ajustes de stock.',
    paraQue: 'Para auditar cualquier movimiento, detectar errores y tener el historial completo.',
    icon: ArrowLeftRight,
    color: 'var(--accent)',
  },
]

export default function Reportes() {
  const [empresaId, setEmpresaId] = useState(null)
  const [empresa, setEmpresa] = useState(null)
  const [tiendas, setTiendas] = useState([])
  const [tienda, setTienda] = useState('all')
  const [fecha, setFecha] = useState('today')
  const [generando, setGenerando] = useState(null)

  useEffect(() => {
    getEmpresaId().then(id => {
      setEmpresaId(id)
      if (id) {
        getTiendas(id).then(setTiendas)
        getEmpresa(id).then(setEmpresa)
      }
    })
  }, [])

  const getDateRange = () => {
    if (fecha === 'all') return null
    const now = new Date()
    const start = new Date()
    if (fecha === 'today') start.setHours(0, 0, 0, 0)
    else if (fecha === '7d') start.setDate(now.getDate() - 7)
    else if (fecha === '30d') start.setDate(now.getDate() - 30)
    return start.toISOString()
  }

  const triggerDownload = async (reporteId, format) => {
    if (!empresaId) return
    setGenerando(`${reporteId}-${format}`)

    const tiendaId = tienda === 'all' ? null : tienda
    const rangeLabel = tienda === 'all' ? 'Todas las sedes' : (tiendas.find(t => String(t.id) === tienda)?.nombre || tienda)

    try {
      if (reporteId === 'inventario') {
        const stockData = await getStock(empresaId, tiendaId)

        const prodMap = {}
        const tiendaSet = {}
        stockData.forEach(row => {
          const prod = row.productos
          const t = row.tiendas
          if (!prod || !t) return
          tiendaSet[t.id] = t.nombre
          if (!prodMap[prod.id]) {
            prodMap[prod.id] = { nombre: prod.nombre, categoria: prod.categorias?.nombre || '—', costo: Number(prod.ultimo_costo) || 0, stocks: {} }
          }
          prodMap[prod.id].stocks[t.id] = row.cantidad
        })
        const tiendasKeys = Object.entries(tiendaSet).sort((a, b) => Number(a[0]) - Number(b[0]))
        const prods = Object.values(prodMap)

        if (format === 'excel') {
          const rows = prods.map(p => {
            const base = { Producto: p.nombre, Categoria: p.categoria }
            tiendasKeys.forEach(([id, nombre]) => { base[`Stock ${nombre}`] = p.stocks[id] ?? 0 })
            const total = Object.values(p.stocks).reduce((s, v) => s + v, 0)
            base['Stock Total'] = total
            base['Costo Unitario'] = p.costo
            base['Valorizacion'] = total * p.costo
            return base
          })
          exportToExcel(rows, 'Inventario', 'reporte_inventario_gms.xlsx')
        } else {
          const headers = ['Producto', 'Categoría', ...tiendasKeys.map(([, n]) => n), 'Total', 'Costo', 'Valor']
          const rows = prods.map(p => {
            const total = Object.values(p.stocks).reduce((s, v) => s + v, 0)
            return [
              p.nombre,
              p.categoria,
              ...tiendasKeys.map(([id]) => p.stocks[id] ?? 0),
              total,
              `S/ ${p.costo.toFixed(2)}`,
              `S/ ${(total * p.costo).toFixed(2)}`
            ]
          })
          exportToPDF(`VALORIZACIÓN DE ALMACÉN — ${rangeLabel}`, headers, rows, 'reporte_inventario.pdf', empresa?.nombre || 'Empresa', empresa?.rubro || '')
        }

      } else {
        const tipoFiltro = reporteId === 'ventas' ? 'venta' : undefined
        const allMovs = await getMovimientos(empresaId, { tiendaId, tipo: tipoFiltro, limit: 500 })
        const startDate = getDateRange()
        const movs = startDate ? allMovs.filter(m => new Date(m.created_at) >= new Date(startDate)) : allMovs

        if (format === 'excel') {
          const rows = movs.map(m => ({
            Tipo: m.tipo.toUpperCase(),
            Producto: m.productos?.nombre || '—',
            Cantidad: m.cantidad,
            PrecioUnit: Number(m.precio_unitario).toFixed(2),
            Total: Number(m.total).toFixed(2),
            Tienda: getTiendaNombre(m),
            Usuario: m.usuarios?.nombre || '—',
            Fecha: formatFecha(m.created_at),
            Transcripcion: m.transcripcion || ''
          }))
          const filename = reporteId === 'ventas' ? 'reporte_ventas_gms.xlsx' : 'reporte_movimientos_gms.xlsx'
          exportToExcel(rows, reporteId === 'ventas' ? 'Ventas' : 'Movimientos', filename)
        } else {
          const titulo = reporteId === 'ventas'
            ? `REPORTE DE VENTAS — ${rangeLabel}`
            : `HISTORIAL DE OPERACIONES — ${rangeLabel}`
          const headers = ['Tipo', 'Producto', 'Cant', 'P.Unit', 'Total', 'Tienda', 'Fecha']
          const rows = movs.map(m => [
            m.tipo.toUpperCase(),
            m.productos?.nombre || '—',
            m.cantidad,
            `S/ ${Number(m.precio_unitario).toFixed(2)}`,
            `S/ ${Number(m.total).toFixed(2)}`,
            getTiendaNombre(m),
            formatFecha(m.created_at)
          ])
          const filename = reporteId === 'ventas' ? 'reporte_ventas.pdf' : 'reporte_movimientos.pdf'
          exportToPDF(titulo, headers, rows, filename, empresa?.nombre || 'Empresa', empresa?.rubro || '')
        }
      }
    } finally {
      setGenerando(null)
    }
  }

  const periodoLabel = { today: 'hoy', '7d': 'últimos 7 días', '30d': 'último mes', all: 'historial completo' }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* ── Header ── */}
      <div>
        <h1 style={{ fontSize: '1.7rem', fontWeight: 800, marginBottom: '4px' }}>Reportes</h1>
        <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.88rem' }}>
          Descarga la información de tu negocio en Excel o PDF para compartir con tu contador o tu equipo.
        </p>
      </div>

      {/* ── Filtros ── */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Filtrar antes de descargar
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Sede</label>
            <select value={tienda} onChange={(e) => setTienda(e.target.value)} className="input-field">
              <option value="all">Todas las sedes (consolidado)</option>
              {tiendas.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Período</label>
            <select value={fecha} onChange={(e) => setFecha(e.target.value)} className="input-field">
              <option value="today">Hoy</option>
              <option value="7d">Últimos 7 días</option>
              <option value="30d">Último mes</option>
              <option value="all">Historial completo</option>
            </select>
          </div>
        </div>
        {(tienda !== 'all' || fecha !== 'today') && (
          <p style={{ fontSize: '0.78rem', color: 'hsl(var(--accent))', margin: 0 }}>
            Los reportes se descargarán con los filtros aplicados: {tienda === 'all' ? 'todas las sedes' : tiendas.find(t => String(t.id) === tienda)?.nombre}, {periodoLabel[fecha]}.
          </p>
        )}
      </div>

      {/* ── Cards de reportes ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {REPORTES.map((rep) => {
          const Icon = rep.icon
          const isGenExcel = generando === `${rep.id}-excel`
          const isGenPDF = generando === `${rep.id}-pdf`
          const anyGenerando = generando !== null

          return (
            <div key={rep.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {/* Cabecera del reporte */}
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '14px' }}>
                <div style={{
                  background: `hsl(${rep.color} / 0.12)`,
                  color: `hsl(${rep.color})`,
                  padding: '11px',
                  borderRadius: 'var(--radius-sm)',
                  flexShrink: 0,
                }}>
                  <Icon size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '3px' }}>{rep.nombre}</h4>
                  <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.8rem', lineHeight: 1.4, margin: 0 }}>{rep.desc}</p>
                </div>
              </div>

              {/* Para qué sirve */}
              <div style={{
                display: 'flex', gap: '8px', alignItems: 'flex-start',
                background: 'hsl(var(--bg-base))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                marginBottom: '16px',
              }}>
                <Info size={13} style={{ color: 'hsl(var(--text-muted))', flexShrink: 0, marginTop: '2px' }} />
                <span style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5 }}>{rep.paraQue}</span>
              </div>

              {/* Botones de descarga */}
              <div style={{ display: 'flex', gap: '10px', borderTop: '1px solid hsl(var(--border))', paddingTop: '14px' }}>
                <button
                  onClick={() => triggerDownload(rep.id, 'excel')}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '9px 8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  disabled={anyGenerando || !empresaId}
                >
                  {isGenExcel
                    ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generando…</>
                    : <><FileSpreadsheet size={14} /> Excel</>
                  }
                </button>
                <button
                  onClick={() => triggerDownload(rep.id, 'pdf')}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '9px 8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  disabled={anyGenerando || !empresaId}
                >
                  {isGenPDF
                    ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generando…</>
                    : <><FileText size={14} /> PDF oficial</>
                  }
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

const labelStyle = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'hsl(var(--text-secondary))',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

