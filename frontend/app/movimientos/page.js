'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, FileText, Search, Undo2, CheckCircle, AlertCircle } from 'lucide-react'
import { getMovimientos, getTiendas, deleteMovimiento, getDefaultEmpresaId } from '../../lib/queries'
import { exportToExcel, exportToPDF } from '../../lib/export'

function formatFecha(dateStr) {
  return new Date(dateStr).toLocaleString('es-PE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

function getTiendaNombre(mov) {
  if (mov.tipo === 'traslado') {
    return `${mov.tienda_origen?.nombre || '?'} → ${mov.tienda_destino?.nombre || '?'}`
  }
  return mov.tienda_origen?.nombre || mov.tienda_destino?.nombre || '—'
}

export default function Movimientos() {
  const [empresaId, setEmpresaId] = useState(null)
  const [tiendas, setTiendas] = useState([])
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [undoingId, setUndoingId] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const showToast = (message, type = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, type })
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  // Filters (client-side over loaded data)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState('all')
  const [tienda, setTienda] = useState('all')

  useEffect(() => {
    getDefaultEmpresaId().then(setEmpresaId)
  }, [])

  useEffect(() => {
    if (!empresaId) return
    getTiendas(empresaId).then(setTiendas)
  }, [empresaId])

  const loadMovimientos = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    const result = await getMovimientos(empresaId, { limit: 100 })
    setData(result)
    setLoading(false)
  }, [empresaId])

  useEffect(() => { loadMovimientos() }, [loadMovimientos])

  const handleUndo = async (item) => {
    const prodName = item.productos?.nombre || 'este producto'
    if (!confirm(`¿Revertir el movimiento de "${prodName}"? El stock se restaurará automáticamente.`)) return
    setUndoingId(item.id)
    const ok = await deleteMovimiento(item.id)
    if (ok) {
      setData(prev => prev.filter(x => x.id !== item.id))
      showToast(`Movimiento de "${prodName}" revertido. Stock restaurado.`, 'success')
    } else {
      showToast('No se pudo revertir el movimiento. Intenta de nuevo.', 'error')
    }
    setUndoingId(null)
  }

  // Client-side filtering
  const filteredData = data.filter(item => {
    const prodNombre = item.productos?.nombre?.toLowerCase() || ''
    const tiendaNombre = getTiendaNombre(item)
    const matchesSearch = prodNombre.includes(search.toLowerCase())
    const matchesTipo = filterTipo === 'all' || item.tipo === filterTipo
    const matchesTienda = tienda === 'all' || tiendaNombre.includes(tienda)
    return matchesSearch && matchesTipo && matchesTienda
  })

  const handleExportExcel = () => {
    const rows = filteredData.map(item => ({
      ID: item.id,
      Tipo: item.tipo.toUpperCase(),
      Producto: item.productos?.nombre || '—',
      Categoria: item.productos?.categorias?.nombre || '—',
      Cantidad: item.cantidad,
      PrecioUnit: Number(item.precio_unitario).toFixed(2),
      Total: Number(item.total).toFixed(2),
      Tienda: getTiendaNombre(item),
      Usuario: item.usuarios?.nombre || '—',
      Fecha: formatFecha(item.created_at),
      Transcripcion: item.transcripcion || ''
    }))
    exportToExcel(rows, 'Movimientos', 'movimientos_gms.xlsx')
  }

  const handleExportPDF = () => {
    const headers = ['Tipo', 'Producto', 'Cant', 'P.Unit', 'Total', 'Tienda', 'Fecha']
    const rows = filteredData.map(item => [
      item.tipo.toUpperCase(),
      item.productos?.nombre || '—',
      item.cantidad,
      `S/ ${Number(item.precio_unitario).toFixed(2)}`,
      `S/ ${Number(item.total).toFixed(2)}`,
      getTiendaNombre(item),
      formatFecha(item.created_at)
    ])
    exportToPDF('REPORTE DETALLADO DE INGRESOS Y EGRESOS', headers, rows, 'reporte_movimientos.pdf', 'Ferretería GMS')
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Registro de Movimientos</h1>
          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.9rem' }}>
            Lista completa de ingresos, egresos y traslados ejecutados por el equipo.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={handleExportExcel} className="btn btn-secondary" disabled={loading}>
            <Download size={16} />
            Excel
          </button>
          <button onClick={handleExportPDF} className="btn btn-primary" disabled={loading}>
            <FileText size={16} />
            Descargar PDF
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="glass-card" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', padding: '20px' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))' }} />
          <input
            type="text"
            placeholder="Buscar por producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
            style={{ paddingLeft: '44px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)} className="input-field" style={{ width: '160px' }}>
            <option value="all">Todos los Tipos</option>
            <option value="venta">Venta (Egreso)</option>
            <option value="ingreso">Ingreso (Stock)</option>
            <option value="gasto">Gasto (Egreso)</option>
            <option value="traslado">Traslado</option>
          </select>
          <select value={tienda} onChange={(e) => setTienda(e.target.value)} className="input-field" style={{ width: '160px' }}>
            <option value="all">Todas las Tiendas</option>
            {tiendas.map(t => (
              <option key={t.id} value={t.nombre}>{t.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div className="glass-card">
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Producto / Item</th>
                <th>Cantidad</th>
                <th>P. Unitario</th>
                <th>Total</th>
                <th>Sucursal</th>
                <th>Fecha de Registro</th>
                <th>Control</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    Cargando movimientos...
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    No se encontraron transacciones con los filtros actuales.
                  </td>
                </tr>
              ) : filteredData.map((item) => (
                <tr key={item.id}>
                  <td><span className={`badge badge-${item.tipo}`}>{item.tipo}</span></td>
                  <td style={{ fontWeight: 600 }}>{item.productos?.nombre || '—'}</td>
                  <td>{item.cantidad} und</td>
                  <td>S/ {Number(item.precio_unitario).toFixed(2)}</td>
                  <td style={{ fontWeight: 700 }}>S/ {Number(item.total).toFixed(2)}</td>
                  <td>{getTiendaNombre(item)}</td>
                  <td style={{ color: 'hsl(var(--text-secondary))' }}>{formatFecha(item.created_at)}</td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '6px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                      disabled={undoingId === item.id}
                      onClick={() => handleUndo(item)}
                    >
                      <Undo2 size={12} />
                      {undoingId === item.id ? '...' : 'Undo'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`} role="status" aria-live="polite">
          {toast.type === 'success'
            ? <CheckCircle size={16} aria-hidden="true" />
            : <AlertCircle size={16} aria-hidden="true" />
          }
          {toast.message}
        </div>
      )}
    </div>
  )
}
