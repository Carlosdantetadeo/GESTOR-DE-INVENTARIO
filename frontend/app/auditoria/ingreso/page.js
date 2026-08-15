'use client'

// Ingreso manual de inventario sin factura (paridad con el bot). Solo
// supervisor/admin (el auditor/vendedor no toca inventario). Escribe en el
// ledger movimientos (tipo ingreso); el trigger sube el stock. Deshacer = DELETE.
import { useEffect, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { canSupervise } from '../../../lib/auditoria/auth'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { getStock, registrarIngresoManual, deshacerSalida } from '../../../lib/auditoria/queries'

const VENTANA_MS = 5 * 60 * 1000

export default function IngresoPage() {
  const { session, online } = useAuditoria()
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [pieza, setPieza] = useState(null)
  const [stock, setStock] = useState(null)
  const [cantidad, setCantidad] = useState('')
  const [costo, setCosto] = useState('')
  const [ultimo, setUltimo] = useState(null)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (session?.empresaId && online) syncCatalogo().catch(() => {})
  }, [session, online])

  async function buscar(q) {
    setTexto(q); setPieza(null); setStock(null)
    setResultados(q.trim() ? await buscarLocal(q) : [])
  }

  async function elegir(p) {
    setPieza(p); setResultados([])
    try { setStock(await getStock(p.producto_id ?? p.id, session.tiendaId)) } catch { setStock(null) }
  }

  async function registrar() {
    const cant = Number(cantidad)
    if (!pieza || !cant) return
    if (!online) { setAviso('Registrar ingresos requiere conexión.'); return }
    try {
      const mov = await registrarIngresoManual({
        productoId: pieza.producto_id ?? pieza.id,
        tiendaId: session.tiendaId,
        cantidad: cant,
        costo: costo === '' ? 0 : Number(costo),
        authUid: session.user.id,
        clientOpId: crypto.randomUUID(),
      })
      setUltimo({ ...mov, nombre: pieza.nombre, cantidad: cant })
      setAviso('Ingreso registrado.')
      setTexto(''); setPieza(null); setStock(null); setCantidad(''); setCosto('')
    } catch {
      setAviso('No se pudo registrar el ingreso.')
    }
  }

  async function deshacer() {
    if (!ultimo) return
    if (Date.now() - new Date(ultimo.created_at).getTime() > VENTANA_MS) {
      setAviso('La ventana para deshacer (5 min) venció.'); setUltimo(null); return
    }
    try { await deshacerSalida(ultimo.id); setAviso('Ingreso revertido.'); setUltimo(null) }
    catch { setAviso('No se pudo revertir.') }
  }

  if (!session) return <Cont><p>Cargando…</p></Cont>
  if (!session.empresaId || !session.tiendaId) return <Cont><p>Tu cuenta necesita empresa y sede asignadas.</p></Cont>
  if (!canSupervise(session.rol)) return <Cont><p>Solo supervisor o admin pueden ingresar inventario.</p></Cont>

  return (
    <Cont>
      <h2 style={{ marginTop: 0 }}>Ingreso de inventario</h2>

      <input value={texto} onChange={(e) => buscar(e.target.value)} placeholder="Buscar pieza por nombre o referencia…" style={inp} />

      {!pieza && resultados.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {resultados.map(({ pieza: p }) => (
            <li key={p.producto_id ?? p.id}>
              <button onClick={() => elegir(p)} style={item}>
                <strong>{p.nombre}</strong>{p.referencia ? <span style={{ color: '#64748b' }}> · {p.referencia}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pieza && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <strong>{pieza.nombre}</strong>
            <button onClick={() => setPieza(null)} style={linkBtn}>cambiar</button>
            {stock != null && <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Stock actual: {stock}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Cantidad" style={inp} autoFocus />
            <input type="number" min="0" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="Costo unit." style={inp} />
          </div>
          <button onClick={registrar} disabled={!cantidad} style={{ ...btn, opacity: cantidad ? 1 : 0.5 }}>📦 Registrar ingreso</button>
        </div>
      )}

      {ultimo && (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #e2e8f0', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.9rem' }}>Último: {ultimo.nombre} × {ultimo.cantidad}</span>
          <button onClick={deshacer} style={{ ...btn, background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1' }}>↩️ Deshacer</button>
        </div>
      )}

      {aviso && <p style={{ marginTop: 12, color: '#0d9488', fontSize: '0.85rem' }}>{aviso}</p>}
    </Cont>
  )
}

function Cont({ children }) {
  return <main style={{ padding: 16, maxWidth: 560, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>{children}</main>
}
const inp = { flex: 1, width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: '1rem' }
const item = { width: '100%', textAlign: 'left', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', marginBottom: 6 }
const btn = { padding: '11px 16px', border: 'none', borderRadius: 10, background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 600 }
const linkBtn = { marginLeft: 8, background: 'none', border: 'none', color: '#0d9488', cursor: 'pointer', fontSize: '0.8rem' }
