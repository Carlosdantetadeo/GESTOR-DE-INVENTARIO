'use client'

import { useState, useEffect } from 'react'
import { BarChart3, FileSpreadsheet, FileText, TrendingUp, Package, ArrowLeftRight } from 'lucide-react'
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

const REPORTES_DISPONIBLES = [
  { id: 'ventas', nombre: 'Reporte General de Ventas', desc: 'Desglose detallado de las ventas por sucursal y vendedor.', icon: TrendingUp },
  { id: 'inventario', nombre: 'Valorización de Almacén', desc: 'Resumen financiero del valor de la mercadería en todas las sedes.', icon: Package },
  { id: 'movimientos', nombre: 'Historial de Transacciones', desc: 'Registro de auditoría de todas las operaciones realizadas por voz.', icon: ArrowLeftRight }
]

export default function Reportes() {
  const [empresaId, setEmpresaId] = useState(null)
  const [empresa, setEmpresa] = useState(null)
  const [tiendas, setTiendas] = useState([])
  const [tienda, setTienda] = useState('all')
  const [fecha, setFecha] = useState('today')
  const [generando, setGenerando] = useState(null) // reporteId being generated

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
    const rangeLabel = tienda === 'all' ? 'Todas las Tiendas' : (tiendas.find(t => String(t.id) === tienda)?.nombre || tienda)

    try {
      if (reporteId === 'inventario') {
        const stockData = await getStock(empresaId, tiendaId)

        // Pivot by producto
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
        // ventas or movimientos
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
            : `HISTORIAL DE TRANSACCIONES — ${rangeLabel}`
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

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* Header */}
      <div>
        <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Centro de Reportes</h1>
        <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.9rem' }}>
          Genera balances, conciliaciones y valorizaciones del negocio al instante.
        </p>
      </div>

      {/* Parámetros */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h3 style={{ fontSize: '1.2rem' }}>1. Parámetros del Reporte</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
          <div>
            <label style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              FILTRAR POR SUCURSAL
            </label>
            <select value={tienda} onChange={(e) => setTienda(e.target.value)} className="input-field">
              <option value="all">Todas las Tiendas (Consolidado)</option>
              {tiendas.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              RANGO DE TIEMPO
            </label>
            <select value={fecha} onChange={(e) => setFecha(e.target.value)} className="input-field">
              <option value="today">Hoy</option>
              <option value="7d">Últimos 7 Días</option>
              <option value="30d">Último Mes</option>
              <option value="all">Histórico Completo</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tarjetas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h3 style={{ fontSize: '1.2rem' }}>2. Selecciona el Formato de Descarga</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          {REPORTES_DISPONIBLES.map((rep) => {
            const Icon = rep.icon
            const isGeneratingExcel = generando === `${rep.id}-excel`
            const isGeneratingPDF = generando === `${rep.id}-pdf`
            const anyGenerating = generando !== null

            return (
              <div key={rep.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '20px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ background: 'hsl(var(--accent) / 0.15)', color: 'hsl(var(--accent))', padding: '12px', borderRadius: 'var(--radius-sm)' }}>
                    <Icon size={24} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>{rep.nombre}</h4>
                    <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.8rem', lineHeight: '1.4' }}>{rep.desc}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid hsl(var(--border))', paddingTop: '16px' }}>
                  <button
                    onClick={() => triggerDownload(rep.id, 'excel')}
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '10px', fontSize: '0.8rem' }}
                    disabled={anyGenerating || !empresaId}
                  >
                    <FileSpreadsheet size={16} />
                    {isGeneratingExcel ? 'Generando...' : 'Excel (.xlsx)'}
                  </button>
                  <button
                    onClick={() => triggerDownload(rep.id, 'pdf')}
                    className="btn btn-primary"
                    style={{ flex: 1, padding: '10px', fontSize: '0.8rem' }}
                    disabled={anyGenerating || !empresaId}
                  >
                    <FileText size={16} />
                    {isGeneratingPDF ? 'Generando...' : 'PDF Oficial'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
