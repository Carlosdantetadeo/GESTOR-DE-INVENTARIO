'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, ClipboardCheck, CheckCircle2, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { getStock, getTiendas, getEmpresaId, createAjustes } from '../../../lib/queries'

// Ajuste de inventario por conteo físico. Canal exclusivo: dashboard
// (el bot de Telegram nunca genera ajustes). El admin elige una tienda,
// ingresa la cantidad contada por producto y el sistema calcula la
// diferencia con signo; cada producto con diferencia genera un movimiento
// tipo 'ajuste' reversible desde /movimientos con el botón Undo.
export default function AjusteInventario() {
  const [empresaId, setEmpresaId] = useState(null)
  const [tiendas, setTiendas] = useState([])
  const [tiendaId, setTiendaId] = useState('')
  const [stockRows, setStockRows] = useState([])
  const [loadingStock, setLoadingStock] = useState(false)
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState({})   // { productoId: 'cantidad contada' }
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)

  useEffect(() => {
    getEmpresaId().then(setEmpresaId)
  }, [])

  useEffect(() => {
    if (!empresaId) return
    getTiendas(empresaId).then(setTiendas)
  }, [empresaId])

  const loadStock = useCallback(async () => {
    if (!empresaId || !tiendaId) { setStockRows([]); return }
    setLoadingStock(true)
    const data = await getStock(empresaId, tiendaId)
    setStockRows(data)
    setLoadingStock(false)
  }, [empresaId, tiendaId])

  useEffect(() => {
    setCounts({})
    loadStock()
  }, [loadStock])

  const productos = stockRows
    .filter(r => r.productos)
    .map(r => ({
      id: r.productos.id,
      nombre: r.productos.nombre,
      categoria: r.productos.categorias?.nombre || '—',
      actual: r.cantidad,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  const filtered = productos.filter(p =>
    p.nombre.toLowerCase().includes(search.toLowerCase())
  )

  const getDiferencia = (prod) => {
    const raw = counts[prod.id]
    if (raw === undefined || raw === '') return null   // no contado
    const contada = parseInt(raw, 10)
    if (Number.isNaN(contada) || contada < 0) return null
    return contada - prod.actual
  }

  // Solo los productos contados con diferencia distinta de cero generan ajuste
  const ajustes = productos
    .map(p => ({ ...p, diferencia: getDiferencia(p) }))
    .filter(p => p.diferencia !== null && p.diferencia !== 0)

  const puedeGuardar = tiendaId && motivo.trim() !== '' && ajustes.length > 0 && !saving

  const handleGuardar = async () => {
    if (!puedeGuardar) return
    setSaving(true)
    setError('')

    const rows = ajustes.map(p => ({
      tipo: 'ajuste',
      producto_id: p.id,
      tienda_origen: Number(tiendaId),
      cantidad: p.diferencia,
      precio_unitario: 0,
      costo_unitario: 0,
      motivo: motivo.trim(),
    }))

    const res = await createAjustes(rows)
    setSaving(false)

    if (!res.ok) {
      setError(`No se pudo guardar el ajuste: ${res.message}`)
      return
    }

    setResultado({
      count: rows.length,
      tienda: tiendas.find(t => String(t.id) === String(tiendaId))?.nombre || '—',
      motivo: motivo.trim(),
    })
    setCounts({})
    setMotivo('')
    loadStock()   // el trigger ya actualizó stock — refrescar "Stock sistema"
  }

  const diffColor = (d) =>
    d > 0 ? 'hsl(var(--color-ingreso))' : 'hsl(var(--color-gasto))'

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* Header */}
      <div>
        <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Ajuste de Inventario</h1>
        <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.9rem' }}>
          Conteo físico por tienda. Ingresá la cantidad contada y el sistema calcula
          la diferencia. Cada ajuste se puede deshacer desde Movimientos.
        </p>
      </div>

      {/* Confirmación con resumen */}
      {resultado && (
        <div className="glass-card" style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          border: '1px solid hsl(var(--color-ingreso) / 0.35)',
          background: 'hsl(var(--color-ingreso) / 0.08)'
        }}>
          <CheckCircle2 size={28} style={{ color: 'hsl(var(--color-ingreso))', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 700, marginBottom: '2px' }}>
              {resultado.count} producto{resultado.count !== 1 ? 's' : ''} ajustado{resultado.count !== 1 ? 's' : ''} en {resultado.tienda}
            </p>
            <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))' }}>
              Motivo: {resultado.motivo}
            </p>
          </div>
          <Link href="/movimientos" className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
            Ver en Movimientos <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {error && (
        <div className="glass-card" style={{
          border: '1px solid hsl(var(--color-gasto) / 0.35)',
          background: 'hsl(var(--color-gasto) / 0.08)',
          color: 'hsl(var(--color-gasto))', fontSize: '0.9rem'
        }}>
          {error}
        </div>
      )}

      {/* Sesión de conteo: tienda + motivo */}
      <div className="glass-card" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', padding: '20px' }}>
        <select
          value={tiendaId}
          onChange={(e) => { setTiendaId(e.target.value); setResultado(null) }}
          className="input-field"
          style={{ width: '220px' }}
          aria-label="Tienda a ajustar"
        >
          <option value="">Elegir tienda…</option>
          {tiendas.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
        </select>
        <input
          type="text"
          placeholder="Motivo del ajuste (obligatorio) — ej: conteo mensual, mercadería dañada"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="input-field"
          style={{ flex: 1, minWidth: '280px' }}
        />
        <div style={{ position: 'relative', width: '240px' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))' }} />
          <input
            type="text"
            placeholder="Filtrar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
            style={{ paddingLeft: '44px' }}
          />
        </div>
      </div>

      {/* Tabla de conteo */}
      <div className="glass-card">
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Stock sistema</th>
                <th>Cantidad contada</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {!tiendaId ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    Elegí una tienda para empezar el conteo.
                  </td>
                </tr>
              ) : loadingStock ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    Cargando stock...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', padding: '40px' }}>
                    No hay productos con stock registrado en esta tienda.
                  </td>
                </tr>
              ) : filtered.map(prod => {
                const dif = getDiferencia(prod)
                return (
                  <tr key={prod.id}>
                    <td style={{ fontWeight: 600 }}>{prod.nombre}</td>
                    <td>
                      <span style={{ fontSize: '0.75rem', background: 'hsl(var(--bg-card-hover))', padding: '4px 8px', borderRadius: 'var(--radius-sm)' }}>
                        {prod.categoria}
                      </span>
                    </td>
                    <td>{prod.actual} und</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        placeholder="—"
                        value={counts[prod.id] ?? ''}
                        onChange={(e) => setCounts(prev => ({ ...prev, [prod.id]: e.target.value }))}
                        className="input-field"
                        style={{ width: '90px', padding: '6px 10px', fontSize: '0.9rem' }}
                        aria-label={`Cantidad contada de ${prod.nombre}`}
                      />
                    </td>
                    <td style={{ fontWeight: 700, color: dif === null || dif === 0 ? 'hsl(var(--text-muted))' : diffColor(dif) }}>
                      {dif === null ? '—' : dif === 0 ? 'Sin diferencia' : (dif > 0 ? `+${dif}` : dif)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Barra de guardado */}
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', padding: '20px' }}>
        <span style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
          {ajustes.length === 0
            ? 'Sin diferencias para ajustar.'
            : `${ajustes.length} producto${ajustes.length !== 1 ? 's' : ''} con diferencia (${ajustes.map(a => `${a.nombre}: ${a.diferencia > 0 ? '+' : ''}${a.diferencia}`).slice(0, 3).join(', ')}${ajustes.length > 3 ? '…' : ''})`}
          {ajustes.length > 0 && motivo.trim() === '' && ' Falta el motivo.'}
        </span>
        <button onClick={handleGuardar} className="btn btn-primary" disabled={!puedeGuardar}>
          <ClipboardCheck size={16} />
          {saving ? 'Guardando...' : 'Guardar ajuste'}
        </button>
      </div>
    </div>
  )
}
