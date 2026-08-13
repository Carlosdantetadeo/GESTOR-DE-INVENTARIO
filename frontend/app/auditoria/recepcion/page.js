'use client'

// Recepción por foto de factura (US4). Requiere conexión (OCR). Flujo:
// foto → Groq Vision extrae ítems → match local (fuzzy) por ítem con indicador
// de confianza → confirmar: ingreso al ledger para los que matchean, pieza
// pendiente para los que no (FR-006/FR-007).
import { useEffect, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { crearIngreso, crearPiezaPendiente } from '../../../lib/auditoria/queries'

const UMBRAL_CONFIANZA = 0.5

export default function RecepcionPage() {
  const { session, online } = useAuditoria()
  const [items, setItems] = useState([])
  const [procesando, setProcesando] = useState(false)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (session?.empresaId && online) syncCatalogo().catch(() => {})
  }, [session, online])

  async function procesarFactura(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!online) { setAviso('La recepción por factura requiere conexión.'); return }
    setProcesando(true)
    setAviso('')
    try {
      const fd = new FormData()
      fd.append('imagen', file)
      const res = await fetch('/api/auditoria/factura', { method: 'POST', body: fd })
      if (!res.ok) {
        setAviso(res.status === 501 ? 'La lectura de facturas no está configurada (falta GROQ_API_KEY).' : 'No se pudo leer la factura.')
        setProcesando(false)
        return
      }
      const { items: extraidos } = await res.json()
      const conMatch = await Promise.all(
        extraidos.map(async (it) => {
          const matches = await buscarLocal(it.descripcion, { limite: 3 })
          const mejor = matches[0]
          return {
            descripcion: it.descripcion,
            cantidad: it.cantidad ?? '',
            precio: it.precio_unitario ?? '',
            matches,
            // Auto-selecciona el mejor match si supera el umbral; si no, "nueva".
            seleccion: mejor && mejor.score >= UMBRAL_CONFIANZA
              ? String(mejor.pieza.producto_id ?? mejor.pieza.id)
              : 'nueva',
          }
        }),
      )
      setItems(conMatch)
      if (conMatch.length === 0) setAviso('No se detectaron ítems en la factura.')
    } catch {
      setAviso('Error procesando la factura.')
    } finally {
      setProcesando(false)
    }
  }

  function actualizar(i, campo, valor) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)))
  }

  function scoreDe(item) {
    if (item.seleccion === 'nueva') return null
    const m = item.matches.find((x) => String(x.pieza.producto_id ?? x.pieza.id) === item.seleccion)
    return m ? m.score : null
  }

  async function confirmar() {
    if (!items.length) return
    setProcesando(true)
    const recepcionRef = crypto.randomUUID()
    let ingresos = 0
    let pendientes = 0
    try {
      for (const it of items) {
        const cantidad = Number(it.cantidad) || 0
        const precio = it.precio === '' ? null : Number(it.precio)
        if (it.seleccion === 'nueva') {
          await crearPiezaPendiente({
            empresaId: session.empresaId,
            tiendaId: session.tiendaId,
            descripcion: it.descripcion,
            cantidad: cantidad || null,
            precio,
            recepcionRef,
          })
          pendientes += 1
        } else {
          await crearIngreso({
            productoId: Number(it.seleccion),
            tiendaId: session.tiendaId,
            cantidad,
            costo: precio ?? 0,
            clientOpId: crypto.randomUUID(),
          })
          ingresos += 1
        }
      }
      setItems([])
      setAviso(`Recepción confirmada: ${ingresos} ingreso(s), ${pendientes} pendiente(s) de aprobación.`)
    } catch {
      setAviso('No se pudo confirmar la recepción.')
    } finally {
      setProcesando(false)
    }
  }

  if (!session) return <Cont><p>Cargando…</p></Cont>
  if (!session.empresaId || !session.tiendaId) {
    return <Cont><p>Tu cuenta necesita empresa y sede asignadas.</p></Cont>
  }

  return (
    <Cont>
      <h2 style={{ marginTop: 0 }}>Recepción por factura</h2>

      <label style={{ display: 'inline-block', padding: '12px 18px', background: '#0d9488', color: '#fff', borderRadius: 10, cursor: 'pointer', fontWeight: 600 }}>
        📷 Fotografiar factura
        <input type="file" accept="image/*" capture="environment" onChange={procesarFactura} style={{ display: 'none' }} disabled={procesando} />
      </label>

      {procesando && <p style={{ color: '#0d9488' }}>Procesando…</p>}

      {items.length > 0 && (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((it, i) => {
              const score = scoreDe(it)
              const bajaConfianza = it.seleccion !== 'nueva' && score !== null && score < UMBRAL_CONFIANZA
              return (
                <li key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <strong>{it.descripcion}</strong>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" min="0" value={it.cantidad} onChange={(e) => actualizar(i, 'cantidad', e.target.value)} placeholder="Cantidad" style={inp} />
                    <input type="number" min="0" step="0.01" value={it.precio} onChange={(e) => actualizar(i, 'precio', e.target.value)} placeholder="Precio" style={inp} />
                  </div>
                  <select value={it.seleccion} onChange={(e) => actualizar(i, 'seleccion', e.target.value)} style={inp}>
                    {it.matches.map(({ pieza, score: s }) => (
                      <option key={pieza.producto_id ?? pieza.id} value={String(pieza.producto_id ?? pieza.id)}>
                        {pieza.nombre} ({Math.round(s * 100)}%)
                      </option>
                    ))}
                    <option value="nueva">➕ Pieza nueva (pendiente de aprobación)</option>
                  </select>
                  {bajaConfianza && <span style={{ color: '#b45309', fontSize: '0.8rem' }}>⚠ Coincidencia de baja confianza — revisá</span>}
                </li>
              )
            })}
          </ul>
          <button onClick={confirmar} disabled={procesando} style={{ padding: '12px 18px', border: 'none', borderRadius: 10, background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            ✅ Confirmar recepción
          </button>
        </>
      )}

      {aviso && <p style={{ marginTop: 12, color: '#0d9488', fontSize: '0.85rem' }}>{aviso}</p>}
    </Cont>
  )
}

function Cont({ children }) {
  return <main style={{ padding: 16, maxWidth: 640, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>{children}</main>
}

const inp = { flex: 1, width: '100%', padding: '9px 11px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: '0.95rem' }
