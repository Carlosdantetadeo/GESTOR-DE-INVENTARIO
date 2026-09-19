'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download, Search, ChevronUp, ChevronDown } from 'lucide-react'
import { getStock, getTiendas, getEmpresaId } from '../../../lib/queries'
import { exportToExcel } from '../../../lib/export'

function pivotStock(stockRows) {
  const productMap = {}
  const tiendaMap = {}

  stockRows.forEach(row => {
    const prod = row.productos
    const tienda = row.tiendas
    if (!prod || !tienda) return

    tiendaMap[tienda.id] = tienda.nombre

    if (!productMap[prod.id]) {
      productMap[prod.id] = {
        id: prod.id,
        nombre: prod.nombre,
        referencia: prod.referencia || null,
        unidad: prod.unidad || 'und',
        categoria: prod.categorias?.nombre || '—',
        costo: Number(prod.ultimo_costo) || 0,
        stockMinimo: prod.stock_minimo ?? 5,
        stocks: {}
      }
    }
    productMap[prod.id].stocks[tienda.id] = row.cantidad
  })

  const productos = Object.values(productMap)
  const tiendas = Object.entries(tiendaMap)
    .map(([id, nombre]) => ({ id: Number(id), nombre }))
    .sort((a, b) => a.id - b.id)

  return { productos, tiendas }
}

function getEstado(total, minimo) {
  if (total <= 0) return 'agotado'
  if (total < minimo) return 'bajo'
  return 'ok'
}

const ALERTA = {
  agotado: { bg: '#fef2f2', hover: '#fee2e2', border: '#dc2626', totalColor: '#dc2626' },
  bajo:    { bg: '#fffbeb', hover: '#fef3c7', border: '#f59e0b', totalColor: '#d97706' },
  ok:      { bg: '#fff',    hover: '#f8fafc', border: 'transparent', totalColor: '#0f172a' },
}

export default function InventarioAuditoria() {
  const [empresaId, setEmpresaId] = useState(null)
  const [productos, setProductos] = useState([])
  const [tiendas, setTiendas] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('all')
  const [tiendaFiltro, setTiendaFiltro] = useState('all')
  const [soloProblemas, setSoloProblemas] = useState(false)
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => {
    getEmpresaId().then(setEmpresaId)
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      if (sp.get('stock') === 'critico') setSoloProblemas(true)
    }
  }, [])

  const loadStock = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    const tiendaId = tiendaFiltro === 'all' ? null : tiendaFiltro
    const stockData = await getStock(empresaId, tiendaId)
    const { productos: prods } = pivotStock(stockData)
    setProductos(prods)
    const allTiendas = await getTiendas(empresaId)
    setTiendas(allTiendas)
    setLoading(false)
  }, [empresaId, tiendaFiltro])

  useEffect(() => { loadStock() }, [loadStock])

  const categorias = [...new Set(productos.map(p => p.categoria).filter(c => c !== '—'))]

  const getTotalStock = (prod) => Object.values(prod.stocks).reduce((s, v) => s + v, 0)
  const getTiendaStock = (prod, tid) => prod.stocks[tid] ?? 0

  const filtered = productos.filter(item => {
    const q = search.toLowerCase()
    const matchSearch = item.nombre.toLowerCase().includes(q) || (item.referencia || '').toLowerCase().includes(q)
    const matchCat = categoria === 'all' || item.categoria === categoria
    const total = getTotalStock(item)
    const matchProb = !soloProblemas || getEstado(total, item.stockMinimo) !== 'ok'
    return matchSearch && matchCat && matchProb
  })

  const sorted = [...filtered].sort((a, b) => {
    if (!sortCol) return 0
    let va, vb
    if (sortCol === 'nombre') { va = a.nombre; vb = b.nombre }
    else if (sortCol === 'total') { va = getTotalStock(a); vb = getTotalStock(b) }
    else if (sortCol === 'costo') { va = a.costo; vb = b.costo }
    else if (sortCol === 'valor') { va = getTotalStock(a) * a.costo; vb = getTotalStock(b) * b.costo }
    if (va === undefined) return 0
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb
    return sortDir === 'asc' ? cmp : -cmp
  })

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const pivotTiendas = tiendaFiltro === 'all' ? tiendas : tiendas.filter(t => String(t.id) === tiendaFiltro)
  const valorTotal = filtered.reduce((acc, p) => acc + getTotalStock(p) * p.costo, 0)
  const fmt = (n) => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const agotados  = filtered.filter(p => getTotalStock(p) <= 0).length
  const bajoMin   = filtered.filter(p => { const t = getTotalStock(p); return t > 0 && t < p.stockMinimo }).length

  const handleExport = () => {
    const rows = filtered.map(prod => {
      const base = { Producto: prod.nombre, Referencia: prod.referencia || '—', Categoria: prod.categoria, Unidad: prod.unidad }
      tiendas.forEach(t => { base[`Stock ${t.nombre}`] = getTiendaStock(prod, t.id) })
      const total = getTotalStock(prod)
      base['Stock Total'] = total
      base['Stock Minimo'] = prod.stockMinimo
      base['Costo Unitario'] = prod.costo
      base['Valorizacion'] = total * prod.costo
      return base
    })
    exportToExcel(rows, 'Inventario', 'inventario.xlsx')
  }

  const SortIcon = ({ col }) => sortCol !== col
    ? <span style={{ opacity: 0.25, fontSize: '0.7rem' }}>↕</span>
    : sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px' }}>

      {/* ── Título ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>Inventario</h1>
          <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
            {loading ? 'Cargando…' : `${productos.length} productos en catálogo`}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
          <button onClick={handleExport} disabled={loading || filtered.length === 0} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: '#0f172a', color: '#fff', border: 'none',
            borderRadius: 8, padding: '7px 13px', cursor: filtered.length === 0 ? 'default' : 'pointer',
            fontSize: '0.78rem', fontWeight: 600, opacity: filtered.length === 0 ? 0.4 : 1,
          }}>
            <Download size={13} /> Exportar
          </button>
          {!loading && (
            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
              {filtered.length} producto{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── Alertas rápidas ── */}
      {!loading && (agotados > 0 || bajoMin > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {agotados > 0 && (
            <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              ⚠ {agotados} agotado{agotados !== 1 ? 's' : ''}
            </span>
          )}
          {bajoMin > 0 && (
            <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
              ↓ {bajoMin} bajo mínimo
            </span>
          )}
        </div>
      )}

      {/* ── Filtros ── */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '180px', position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Buscar producto o código…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 10px 8px 32px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.84rem', outline: 'none', boxSizing: 'border-box', background: '#fff' }}
          />
        </div>
        {categorias.length > 0 && (
          <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.84rem', background: '#fff' }}>
            <option value="all">Todas las categorías</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select value={tiendaFiltro} onChange={e => setTiendaFiltro(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.84rem', background: '#fff' }}>
          <option value="all">Todas las sedes</option>
          {tiendas.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
        </select>
        {soloProblemas && (
          <button
            onClick={() => { setSoloProblemas(false); if (typeof window !== 'undefined') { const u = new URL(window.location.href); u.searchParams.delete('stock'); window.history.replaceState({}, '', u) } }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 12px',
              borderRadius: 99, cursor: 'pointer',
              background: '#fffbeb', color: '#d97706',
              border: '1px solid #fde68a', fontSize: '0.78rem', fontWeight: 600,
            }}
          >
            Solo alertas ×
          </button>
        )}
      </div>

      {/* ── Tabla ── */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ minWidth: '680px', width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <Th onClick={() => toggleSort('nombre')} style={{ minWidth: 200 }}>Producto <SortIcon col="nombre" /></Th>
              {pivotTiendas.map(t => <Th key={t.id} style={{ textAlign: 'right' }}>{t.nombre}</Th>)}
              <Th onClick={() => toggleSort('total')} style={{ textAlign: 'right' }}>Total <SortIcon col="total" /></Th>
              <Th style={{ textAlign: 'right' }}>Mín.</Th>
              <Th onClick={() => toggleSort('costo')} style={{ textAlign: 'right' }}>Costo unit. <SortIcon col="costo" /></Th>
              <Th onClick={() => toggleSort('valor')} style={{ textAlign: 'right' }}>Valorización <SortIcon col="valor" /></Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5 + pivotTiendas.length} style={{ textAlign: 'center', color: '#94a3b8', padding: '48px' }}>Cargando…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={5 + pivotTiendas.length} style={{ textAlign: 'center', color: '#94a3b8', padding: '48px' }}>Sin productos con los filtros aplicados.</td></tr>
            ) : sorted.map(prod => {
              const total = getTotalStock(prod)
              const estado = getEstado(total, prod.stockMinimo)
              const al = ALERTA[estado]
              return (
                <tr key={prod.id} style={{ borderBottom: '1px solid #f1f5f9', background: al.bg, borderLeft: `3px solid ${al.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = al.hover}
                  onMouseLeave={e => e.currentTarget.style.background = al.bg}>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>{prod.nombre}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
                      {prod.referencia && (
                        <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                          {prod.referencia}
                        </span>
                      )}
                      <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{prod.unidad}</span>
                    </div>
                  </td>
                  {pivotTiendas.map(t => {
                    const qty = getTiendaStock(prod, t.id)
                    const low = qty < prod.stockMinimo
                    return (
                      <td key={t.id} style={{ padding: '10px 16px', textAlign: 'right', fontWeight: low ? 700 : 400, color: low ? '#dc2626' : '#374151' }}>
                        {qty}
                      </td>
                    )
                  })}
                  <td style={{ padding: '10px 16px', fontWeight: 800, textAlign: 'right', color: al.totalColor, fontSize: '0.9rem' }}>{total}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: estado !== 'ok' ? al.totalColor : '#94a3b8', fontWeight: estado !== 'ok' ? 600 : 400 }}>{prod.stockMinimo}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#64748b' }}>S/ {prod.costo.toFixed(2)}</td>
                  <td style={{ padding: '10px 16px', fontWeight: 700, textAlign: 'right', color: '#0f172a' }}>S/ {fmt(total * prod.costo)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {!loading && sorted.length > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: '0.78rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', minWidth: '680px' }}>
            <span>{sorted.length} de {productos.length} producto{productos.length !== 1 ? 's' : ''}</span>
            <span>Valorización total: <strong style={{ color: '#0f172a' }}>S/ {fmt(valorTotal)}</strong></span>
          </div>
        )}
      </div>
    </div>
  )
}

function Th({ children, onClick, style }) {
  return (
    <th onClick={onClick} style={{
      padding: '10px 16px', textAlign: 'left', fontWeight: 700,
      fontSize: '0.7rem', color: '#64748b',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      whiteSpace: 'nowrap', userSelect: 'none',
      cursor: onClick ? 'pointer' : 'default', ...style,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>{children}</span>
    </th>
  )
}
