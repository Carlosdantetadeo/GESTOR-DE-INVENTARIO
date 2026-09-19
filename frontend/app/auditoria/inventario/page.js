'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download, Search, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react'
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
        sugerido: Number(prod.precio_venta_sugerido) || 0,
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

const ESTADO = {
  agotado: { label: 'Agotado',    bg: 'hsl(0 75% 55% / 0.1)',    color: 'hsl(0 75% 45%)',   border: 'hsl(0 75% 48% / 0.25)' },
  bajo:    { label: 'Stock bajo', bg: 'hsl(38 92% 50% / 0.1)',   color: 'hsl(38 85% 38%)',  border: 'hsl(38 92% 50% / 0.3)' },
  ok:      { label: 'Normal',     bg: 'hsl(142 72% 40% / 0.08)', color: 'hsl(142 60% 30%)', border: 'hsl(142 72% 40% / 0.25)' },
}

function Badge({ estado }) {
  const c = ESTADO[estado]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 10px', borderRadius: '99px',
      fontSize: '0.72rem', fontWeight: 700,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
      {c.label}
    </span>
  )
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
    else if (sortCol === 'estado') {
      const ord = { agotado: 0, bajo: 1, ok: 2 }
      va = ord[getEstado(getTotalStock(a), a.stockMinimo)]
      vb = ord[getEstado(getTotalStock(b), b.stockMinimo)]
    }
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
  const agotadosCount = filtered.filter(p => getTotalStock(p) <= 0).length
  const bajoCount = filtered.filter(p => { const t = getTotalStock(p); return t > 0 && t < p.stockMinimo }).length

  const fmt = (n) => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const handleExport = () => {
    const rows = filtered.map(prod => {
      const base = { Producto: prod.nombre, Referencia: prod.referencia || '—', Categoria: prod.categoria, Unidad: prod.unidad }
      tiendas.forEach(t => { base[`Stock ${t.nombre}`] = getTiendaStock(prod, t.id) })
      const total = getTotalStock(prod)
      base['Stock Total'] = total
      base['Estado'] = ESTADO[getEstado(total, prod.stockMinimo)].label
      base['Stock Minimo'] = prod.stockMinimo
      base['Costo Unitario'] = prod.costo
      base['Precio Sugerido'] = prod.sugerido
      base['Valorizacion'] = total * prod.costo
      return base
    })
    exportToExcel(rows, 'Inventario', 'inventario.xlsx')
  }

  const SortIcon = ({ col }) => sortCol !== col
    ? <span style={{ opacity: 0.25, fontSize: '0.7rem' }}>↕</span>
    : sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px' }}>

      {/* ── Título y exportar ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Inventario</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            {loading ? 'Cargando…' : `${productos.length} producto${productos.length !== 1 ? 's' : ''} en catálogo`}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
          <button onClick={handleExport} disabled={loading || filtered.length === 0} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: '#fff', border: '1px solid #e2e8f0', color: '#374151',
            borderRadius: 8, padding: '7px 14px', cursor: filtered.length === 0 ? 'default' : 'pointer',
            fontSize: '0.8rem', fontWeight: 600, opacity: filtered.length === 0 ? 0.5 : 1,
          }}>
            <Download size={14} /> Exportar filtro actual
          </button>
          {!loading && (
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
              {filtered.length} producto{filtered.length !== 1 ? 's' : ''} en la descarga
            </span>
          )}
        </div>
      </div>

      {/* ── Alerta de stock (solo si hay problemas) ── */}
      {!loading && (agotadosCount > 0 || bajoCount > 0) && (
        <div
          onClick={() => setSoloProblemas(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 16px', borderRadius: '10px',
            background: soloProblemas ? 'hsl(38 92% 50% / 0.12)' : 'hsl(38 92% 50% / 0.07)',
            border: `1px solid hsl(38 92% 50% / ${soloProblemas ? '0.45' : '0.25'})`,
            cursor: 'pointer', userSelect: 'none',
          }}
        >
          <AlertTriangle size={15} style={{ color: 'hsl(38 85% 38%)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.83rem', color: 'hsl(38 85% 38%)', fontWeight: 600, flex: 1 }}>
            {[agotadosCount > 0 && `${agotadosCount} agotado${agotadosCount !== 1 ? 's' : ''}`, bajoCount > 0 && `${bajoCount} bajo mínimo`].filter(Boolean).join(' · ')}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'hsl(38 85% 38%)', opacity: 0.8 }}>
            {soloProblemas ? 'Ver todos' : 'Ver solo estos'}
          </span>
        </div>
      )}

      {/* ── Filtros ── */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
        <div style={{ flex: 1, minWidth: '180px', position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Buscar por nombre o código…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '32px', padding: '8px 10px 8px 32px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.85rem', minWidth: '150px' }}>
          <option value="all">Todas las categorías</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={tiendaFiltro} onChange={e => setTiendaFiltro(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.85rem', minWidth: '130px' }}>
          <option value="all">Todas las sedes</option>
          {tiendas.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
        </select>
        {soloProblemas && (
          <button
            onClick={() => { setSoloProblemas(false); if (typeof window !== 'undefined') { const u = new URL(window.location.href); u.searchParams.delete('stock'); window.history.replaceState({}, '', u) } }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px',
              borderRadius: '99px', cursor: 'pointer',
              background: 'hsl(38 92% 50% / 0.1)', color: 'hsl(38 85% 38%)',
              border: '1px solid hsl(38 92% 50% / 0.35)', fontSize: '0.78rem', fontWeight: 600,
            }}
          >
            Solo alertas ×
          </button>
        )}
      </div>

      {/* ── Tabla ── */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflowX: 'auto' }}>
        <table style={{ minWidth: '820px', width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <Th onClick={() => toggleSort('nombre')} style={{ minWidth: 200 }}>Producto <SortIcon col="nombre" /></Th>
                <Th>Categoría</Th>
                {pivotTiendas.map(t => <Th key={t.id}>{t.nombre}</Th>)}
                <Th onClick={() => toggleSort('total')}>Total <SortIcon col="total" /></Th>
                <Th onClick={() => toggleSort('estado')}>Estado <SortIcon col="estado" /></Th>
                <Th>Mín.</Th>
                <Th onClick={() => toggleSort('costo')}>Costo <SortIcon col="costo" /></Th>
                <Th>Precio</Th>
                <Th onClick={() => toggleSort('valor')}>Valor <SortIcon col="valor" /></Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7 + pivotTiendas.length} style={{ textAlign: 'center', color: '#94a3b8', padding: '48px' }}>Cargando…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={7 + pivotTiendas.length} style={{ textAlign: 'center', color: '#94a3b8', padding: '48px' }}>Sin productos con los filtros aplicados.</td></tr>
              ) : sorted.map(prod => {
                const total = getTotalStock(prod)
                const estado = getEstado(total, prod.stockMinimo)
                return (
                  <tr key={prod.id} style={{ borderBottom: '1px solid #f1f5f9' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{prod.nombre}</div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
                        {prod.referencia && (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                            {prod.referencia}
                          </span>
                        )}
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{prod.unidad}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ fontSize: '0.74rem', background: '#f1f5f9', padding: '3px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                        {prod.categoria}
                      </span>
                    </td>
                    {pivotTiendas.map(t => {
                      const qty = getTiendaStock(prod, t.id)
                      const low = qty < prod.stockMinimo
                      return (
                        <td key={t.id} style={{ padding: '11px 16px', textAlign: 'right', fontWeight: low ? 700 : 400, color: low ? 'hsl(0 75% 48%)' : 'inherit' }}>
                          {qty}
                        </td>
                      )
                    })}
                    <td style={{ padding: '11px 16px', fontWeight: 700, textAlign: 'right' }}>{total}</td>
                    <td style={{ padding: '11px 16px' }}><Badge estado={estado} /></td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', color: '#64748b' }}>{prod.stockMinimo}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', color: '#64748b' }}>S/ {prod.costo.toFixed(2)}</td>
                    <td style={{ padding: '11px 16px', textAlign: 'right', color: '#64748b' }}>S/ {prod.sugerido.toFixed(2)}</td>
                    <td style={{ padding: '11px 16px', fontWeight: 700, textAlign: 'right' }}>S/ {fmt(total * prod.costo)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

        {!loading && sorted.length > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: '0.78rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', minWidth: '820px' }}>
            <span>{sorted.length} de {productos.length} producto{productos.length !== 1 ? 's' : ''}</span>
            <span>Valor total: <strong style={{ color: '#0f172a' }}>S/ {fmt(valorTotal)}</strong></span>
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
      fontSize: '0.72rem', color: '#64748b',
      textTransform: 'uppercase', letterSpacing: '0.04em',
      whiteSpace: 'nowrap', userSelect: 'none',
      cursor: onClick ? 'pointer' : 'default', ...style,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>{children}</span>
    </th>
  )
}
