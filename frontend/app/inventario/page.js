'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, Search, AlertTriangle, Coins, Layers, Pencil, Plus, X } from 'lucide-react'
import { getStock, getTiendas, getEmpresaId, updateProducto, getCategorias, createProducto } from '../../lib/queries'
import { exportToExcel } from '../../lib/export'

const NUEVO_PRODUCTO_VACIO = { nombre: '', categoria: '', costo: '', precio: '', stockMinimo: '5' }

// Pivot flat stock rows into one row per product with per-tienda quantities
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

export default function Inventario() {
  const [empresaId, setEmpresaId] = useState(null)
  const [productos, setProductos] = useState([])
  const [tiendas, setTiendas] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('all')
  const [tiendaFiltro, setTiendaFiltro] = useState('all')

  // Inline edit de stock_minimo (base para editar más campos de producto)
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const skipSaveRef = useRef(false)   // Escape cancela sin que el blur guarde

  // Alta manual de producto (modal)
  const [categoriasDB, setCategoriasDB] = useState([])
  const [showNuevo, setShowNuevo] = useState(false)
  const [nuevo, setNuevo] = useState(NUEVO_PRODUCTO_VACIO)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [okMsg, setOkMsg] = useState('')

  useEffect(() => {
    getEmpresaId().then(setEmpresaId)
  }, [])

  useEffect(() => {
    if (empresaId) getCategorias(empresaId).then(setCategoriasDB)
  }, [empresaId])

  const loadStock = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    const tiendaId = tiendaFiltro === 'all' ? null : tiendaFiltro
    const stockData = await getStock(empresaId, tiendaId)
    const { productos: prods, tiendas: tiends } = pivotStock(stockData)
    setProductos(prods)
    // Always load all tiendas for the filter dropdown (independent of pivot)
    const allTiendas = await getTiendas(empresaId)
    setTiendas(allTiendas)
    setLoading(false)
  }, [empresaId, tiendaFiltro])

  useEffect(() => { loadStock() }, [loadStock])

  // Derive unique categories from loaded products
  const categorias = [...new Set(productos.map(p => p.categoria).filter(c => c !== '—'))]

  const filteredProductos = productos.filter(item => {
    const matchesSearch = item.nombre.toLowerCase().includes(search.toLowerCase())
    const matchesCat = categoria === 'all' || item.categoria === categoria
    return matchesSearch && matchesCat
  })

  const getTiendaStock = (prod, tiendaId) => prod.stocks[tiendaId] ?? 0

  const getTotalStock = (prod) => Object.values(prod.stocks).reduce((s, v) => s + v, 0)

  // Tiendas visible in the current pivot (may be subset when tiendaFiltro is set)
  const pivotTiendas = tiendaFiltro === 'all'
    ? tiendas
    : tiendas.filter(t => String(t.id) === tiendaFiltro)

  const valorTotalInventario = filteredProductos.reduce((acc, prod) => {
    return acc + getTotalStock(prod) * prod.costo
  }, 0)

  const alertasCount = filteredProductos.filter(prod =>
    Object.values(prod.stocks).some(s => s < prod.stockMinimo)
  ).length

  const startEdit = (prod) => {
    setEditingId(prod.id)
    setEditValue(String(prod.stockMinimo))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const saveEdit = async (prod) => {
    const val = parseInt(editValue, 10)
    cancelEdit()
    if (Number.isNaN(val) || val < 0 || val === prod.stockMinimo) return
    const ok = await updateProducto(prod.id, { stock_minimo: val })
    if (ok) {
      setProductos(prev => prev.map(p => p.id === prod.id ? { ...p, stockMinimo: val } : p))
    }
  }

  const openNuevo = () => {
    setNuevo(NUEVO_PRODUCTO_VACIO)
    setFormError('')
    setOkMsg('')
    setShowNuevo(true)
  }

  const submitNuevo = async (e) => {
    e.preventDefault()
    setFormError('')
    const nombre = nuevo.nombre.trim()
    if (!nombre) { setFormError('El nombre es obligatorio.'); return }

    const costo = nuevo.costo === '' ? 0 : Number(nuevo.costo)
    const precio = nuevo.precio === '' ? 0 : Number(nuevo.precio)
    const stockMinimo = nuevo.stockMinimo === '' ? 5 : parseInt(nuevo.stockMinimo, 10)
    if (costo < 0 || precio < 0 || Number.isNaN(costo) || Number.isNaN(precio)) {
      setFormError('Costo y precio deben ser números válidos.'); return
    }
    if (Number.isNaN(stockMinimo) || stockMinimo < 0) {
      setFormError('El stock mínimo debe ser un número válido.'); return
    }

    setSaving(true)
    const res = await createProducto(empresaId, {
      nombre, categoria: nuevo.categoria, costo, precio, stockMinimo,
    })
    setSaving(false)

    if (!res.ok) { setFormError(res.message); return }

    setShowNuevo(false)
    setOkMsg(`"${nombre}" agregado al catálogo. Aparecerá en la tabla cuando registre su primer movimiento.`)
    // Refrescar categorías (pudo crearse una nueva) y stock.
    getCategorias(empresaId).then(setCategoriasDB)
    loadStock()
  }

  const handleExportExcel = () => {
    const rows = filteredProductos.map(prod => {
      const base = {
        Producto: prod.nombre,
        Categoria: prod.categoria,
      }
      tiendas.forEach(t => {
        base[`Stock ${t.nombre}`] = getTiendaStock(prod, t.id)
      })
      base['Stock Total'] = getTotalStock(prod)
      base['Stock Minimo'] = prod.stockMinimo
      base['Costo Unitario'] = prod.costo
      base['Precio Sugerido'] = prod.sugerido
      base['Valorizacion Stock'] = getTotalStock(prod) * prod.costo
      return base
    })
    exportToExcel(rows, 'Inventario', 'inventario_gms.xlsx')
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Control de Inventario</h1>
          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.9rem' }}>
            Valorización de mercancía en almacenes y monitoreo de quiebres de stock.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={openNuevo} className="btn btn-primary">
            <Plus size={16} />
            Nuevo Producto
          </button>
          <button onClick={handleExportExcel} className="btn btn-secondary" disabled={loading}>
            <Download size={16} />
            Exportar (.xlsx)
          </button>
        </div>
      </div>

      {okMsg && (
        <div className="glass-card" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
          padding: '14px 20px', borderLeft: '4px solid hsl(var(--color-ingreso))',
        }}>
          <span style={{ fontSize: '0.9rem', color: 'hsl(var(--color-ingreso))' }}>✅ {okMsg}</span>
          <button onClick={() => setOkMsg('')} aria-label="Cerrar aviso"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ background: 'hsl(var(--color-ingreso) / 0.15)', color: 'hsl(var(--color-ingreso))', padding: '16px', borderRadius: 'var(--radius-md)' }}>
            <Coins size={28} />
          </div>
          <div>
            <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', fontWeight: 600 }}>VALOR TOTAL INVENTARIO</span>
            <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '4px' }}>
              {loading ? '—' : `S/ ${valorTotalInventario.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </h2>
          </div>
        </div>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ background: 'hsl(var(--accent) / 0.15)', color: 'hsl(var(--accent))', padding: '16px', borderRadius: 'var(--radius-md)' }}>
            <Layers size={28} />
          </div>
          <div>
            <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', fontWeight: 600 }}>PRODUCTOS REGISTRADOS</span>
            <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '4px' }}>
              {loading ? '—' : `${filteredProductos.length} Items`}
            </h2>
          </div>
        </div>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ background: 'hsl(var(--color-gasto) / 0.15)', color: 'hsl(var(--color-gasto))', padding: '16px', borderRadius: 'var(--radius-md)' }}>
            <AlertTriangle size={28} />
          </div>
          <div>
            <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', fontWeight: 600 }}>ALERTAS DE QUIEBRE</span>
            <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '4px' }}>
              {loading ? '—' : `${alertasCount} Alertas`}
            </h2>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="glass-card" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', padding: '20px' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))' }} />
          <input
            type="text"
            placeholder="Buscar por nombre de producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
            style={{ paddingLeft: '44px' }}
          />
        </div>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="input-field" style={{ width: '220px' }}>
          <option value="all">Todas las Categorías</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={tiendaFiltro} onChange={(e) => setTiendaFiltro(e.target.value)} className="input-field" style={{ width: '180px' }}>
          <option value="all">Todas las Tiendas</option>
          {tiendas.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
        </select>
      </div>

      {/* Tabla */}
      <div className="glass-card">
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Nombre del Producto</th>
                <th>Categoría</th>
                {pivotTiendas.map(t => <th key={t.id}>{t.nombre}</th>)}
                <th>Stock Total</th>
                <th>Stock Mín.</th>
                <th>Costo Unit.</th>
                <th>Sugerido</th>
                <th>Valor Stock</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7 + pivotTiendas.length} style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    Cargando inventario...
                  </td>
                </tr>
              ) : filteredProductos.length === 0 ? (
                <tr>
                  <td colSpan={7 + pivotTiendas.length} style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    No se encontraron productos con los filtros actuales.
                  </td>
                </tr>
              ) : filteredProductos.map((prod) => {
                const totalStock = getTotalStock(prod)
                const valorStock = totalStock * prod.costo

                return (
                  <tr key={prod.id}>
                    <td style={{ fontWeight: 600 }}>{prod.nombre}</td>
                    <td>
                      <span style={{ fontSize: '0.75rem', background: 'hsl(var(--bg-card-hover))', padding: '4px 8px', borderRadius: 'var(--radius-sm)' }}>
                        {prod.categoria}
                      </span>
                    </td>
                    {pivotTiendas.map(t => {
                      const qty = getTiendaStock(prod, t.id)
                      const low = qty < prod.stockMinimo
                      return (
                        <td key={t.id} style={{ color: low ? 'hsl(var(--color-gasto))' : 'inherit', fontWeight: low ? 700 : 'normal' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            {qty}
                            {low && <AlertTriangle size={12} aria-label="Stock bajo" />}
                          </span>
                        </td>
                      )
                    })}
                    <td style={{ fontWeight: 700, color: totalStock < 10 ? 'hsl(var(--color-traslado))' : 'inherit' }}>
                      {totalStock} und
                    </td>
                    <td>
                      {editingId === prod.id ? (
                        <input
                          type="number"
                          min="0"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => {
                            if (skipSaveRef.current) { skipSaveRef.current = false; return }
                            saveEdit(prod)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.target.blur()
                            if (e.key === 'Escape') { skipSaveRef.current = true; cancelEdit() }
                          }}
                          className="input-field"
                          style={{ width: '76px', padding: '4px 8px', fontSize: '0.85rem' }}
                          aria-label={`Stock mínimo de ${prod.nombre}`}
                        />
                      ) : (
                        <button
                          onClick={() => startEdit(prod)}
                          title="Editar stock mínimo"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'inherit', font: 'inherit', padding: '4px 0'
                          }}
                        >
                          {prod.stockMinimo}
                          <Pencil size={12} style={{ color: 'hsl(var(--text-muted))' }} />
                        </button>
                      )}
                    </td>
                    <td>S/ {prod.costo.toFixed(2)}</td>
                    <td>S/ {prod.sugerido.toFixed(2)}</td>
                    <td style={{ fontWeight: 700, color: 'hsl(var(--accent-light))' }}>
                      S/ {valorStock.toFixed(2)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: alta manual de producto */}
      {showNuevo && (
        <div
          onClick={() => !saving && setShowNuevo(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'hsl(0 0% 0% / 0.55)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitNuevo}
            className="glass-card"
            style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '18px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.3rem' }}>Nuevo Producto</h2>
              <button type="button" onClick={() => setShowNuevo(false)} aria-label="Cerrar"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))', display: 'flex' }}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'hsl(var(--text-secondary))', marginTop: '-8px' }}>
              Precargá tu catálogo para que el bot reconozca el producto desde el primer mensaje.
            </p>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', fontWeight: 600 }}>
              Nombre *
              <input
                autoFocus
                type="text"
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                placeholder="Ej: Cemento Sol 42.5kg"
                className="input-field"
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', fontWeight: 600 }}>
              Categoría
              <input
                type="text"
                list="categorias-list"
                value={nuevo.categoria}
                onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })}
                placeholder="General"
                className="input-field"
              />
              <datalist id="categorias-list">
                {categoriasDB.map(c => <option key={c.id} value={c.nombre} />)}
              </datalist>
            </label>

            <div style={{ display: 'flex', gap: '12px' }}>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', fontWeight: 600 }}>
                Costo (S/)
                <input
                  type="number" min="0" step="0.01"
                  value={nuevo.costo}
                  onChange={(e) => setNuevo({ ...nuevo, costo: e.target.value })}
                  placeholder="0.00"
                  className="input-field"
                />
              </label>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', fontWeight: 600 }}>
                Precio venta (S/)
                <input
                  type="number" min="0" step="0.01"
                  value={nuevo.precio}
                  onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })}
                  placeholder="0.00"
                  className="input-field"
                />
              </label>
              <label style={{ width: '90px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', fontWeight: 600 }}>
                Stock mín.
                <input
                  type="number" min="0"
                  value={nuevo.stockMinimo}
                  onChange={(e) => setNuevo({ ...nuevo, stockMinimo: e.target.value })}
                  className="input-field"
                />
              </label>
            </div>

            {formError && (
              <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {formError}</span>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
              <button type="button" onClick={() => setShowNuevo(false)} className="btn btn-secondary" disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar producto'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
