'use client'

// Ingreso manual de inventario sin factura (paridad con el bot). Solo
// supervisor/admin (el auditor/vendedor no toca inventario). Escribe en el
// ledger movimientos (tipo ingreso); el trigger sube el stock. Deshacer = DELETE.
import { useEffect, useRef, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { canSupervise } from '../../../lib/auditoria/auth'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { getStock, registrarIngresoManual, deshacerSalida, getTiendas, getSecciones } from '../../../lib/auditoria/queries'

const VENTANA_MS = 5 * 60 * 1000

export default function IngresoPage() {
  const { session, online } = useAuditoria()
  const [tiendas, setTiendas] = useState([])
  const [tiendaId, setTiendaId] = useState('')
  const [secciones, setSecciones] = useState([])
  const [seccionId, setSeccionId] = useState('')
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [pieza, setPieza] = useState(null)
  const [stock, setStock] = useState(null)
  const [cantidad, setCantidad] = useState('')
  const [costo, setCosto] = useState('')
  const [ultimo, setUltimo] = useState(null)
  const [grabando, setGrabando] = useState(false)
  const [aviso, setAviso] = useState('')
  const recorderRef = useRef(null)

  useEffect(() => {
    if (session?.empresaId && online) syncCatalogo().catch(() => {})
    if (session?.empresaId) getTiendas().then(setTiendas).catch(() => {})
  }, [session, online])

  // Al elegir sede: cargar sus secciones y resetear la selección de sección/pieza.
  async function elegirSede(id) {
    setTiendaId(id); setSeccionId(''); setSecciones([])
    setPieza(null); setStock(null)
    if (id) {
      try { setSecciones(await getSecciones(Number(id))) } catch { setSecciones([]) }
    }
  }

  async function buscar(q) {
    setTexto(q); setPieza(null); setStock(null)
    setResultados(q.trim() ? await buscarLocal(q) : [])
  }

  async function elegir(p) {
    setPieza(p); setResultados([])
    if (!tiendaId) { setStock(null); return }
    try { setStock(await getStock(p.producto_id ?? p.id, Number(tiendaId))) } catch { setStock(null) }
  }

  async function grabarVoz() {
    if (!online) { setAviso('La voz necesita conexión.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks = []
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: rec.mimeType })
        const fd = new FormData()
        fd.append('audio', blob)
        try {
          const res = await fetch('/api/auditoria/transcribir', { method: 'POST', body: fd })
          if (res.ok) {
            const { texto: t } = await res.json()
            if (t?.trim()) await interpretarIngreso(t)
            else setAviso('No te entendí. Probá de nuevo o buscá por nombre.')
          } else if (res.status === 501) {
            setAviso('La voz no está configurada (falta GROQ_API_KEY en Vercel).')
          } else {
            setAviso('No se pudo transcribir el audio. Probá de nuevo.')
          }
        } catch { setAviso('No se pudo transcribir.') }
      }
      recorderRef.current = rec
      rec.start()
      setGrabando(true)
    } catch { setAviso('No se pudo acceder al micrófono.') }
  }

  function detenerVoz() { recorderRef.current?.stop(); setGrabando(false) }

  // Voz: interpreta la frase (producto + cantidad + costo), ubica la mejor
  // coincidencia del catálogo y prellena para registrar o corregir.
  async function interpretarIngreso(t) {
    setAviso('Interpretando…')
    let descripcion = t
    let cant = null
    let cost = null
    try {
      const res = await fetch('/api/auditoria/parsear-venta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: t }),
      })
      if (res.ok) {
        const d = await res.json()
        if (d.descripcion) descripcion = d.descripcion
        cant = d.cantidad
        cost = d.precio
      }
      // 501 u otro error → seguimos con el texto crudo (fallback manual).
    } catch { /* fallback: usamos el texto crudo */ }

    const resultados = await buscarLocal(descripcion)
    setTexto(descripcion)
    if (resultados.length > 0) {
      setResultados([])
      await elegir(resultados[0].pieza)
      if (cant != null) setCantidad(String(cant))
      if (cost != null) setCosto(String(cost))
      setAviso('')
    } else {
      setPieza(null); setStock(null); setResultados([])
      setAviso(`Reconocí "${descripcion}" pero no encontré ese producto. Corregí el texto o buscá por nombre.`)
    }
  }

  async function registrar() {
    const cant = Number(cantidad)
    if (!pieza || !cant) return
    if (!tiendaId) { setAviso('Elegí una sede.'); return }
    if (!online) { setAviso('Registrar ingresos requiere conexión.'); return }
    try {
      const mov = await registrarIngresoManual({
        productoId: pieza.producto_id ?? pieza.id,
        tiendaId: Number(tiendaId),
        seccionId: seccionId ? Number(seccionId) : null,
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
  if (!session.empresaId) return <Cont><p>Tu cuenta necesita una empresa asignada.</p></Cont>
  if (!canSupervise(session.rol)) return <Cont><p>Solo supervisor o admin pueden ingresar inventario.</p></Cont>

  return (
    <Cont>
      <h2 style={{ marginTop: 0 }}>Ingreso de inventario</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={lbl}>Sede
          <select value={tiendaId} onChange={(e) => elegirSede(e.target.value)} style={inp}>
            <option value="">Elegí una sede…</option>
            {tiendas.filter((t) => t.activa !== false).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        {tiendaId && (
          <label style={lbl}>Sección (opcional)
            <select value={seccionId} onChange={(e) => setSeccionId(e.target.value)} style={inp}>
              <option value="">{secciones.length ? 'Sin sección' : 'Esta sede no tiene secciones (cargalas en Admin)'}</option>
              {secciones.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        )}
      </div>

      {tiendaId && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={texto} onChange={(e) => buscar(e.target.value)} placeholder="Buscar pieza por nombre o referencia…" style={inp} />
          <button
            onClick={grabando ? detenerVoz : grabarVoz}
            style={{ ...btn, background: grabando ? '#ef4444' : '#0d9488', whiteSpace: 'nowrap' }}
          >
            {grabando ? '⏹ Detener' : '🎤 Voz'}
          </button>
        </div>
      )}

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
            <label style={lbl}>Cantidad
              <input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 10" style={inp} autoFocus />
            </label>
            <label style={lbl}>Costo unitario
              <input type="number" min="0" step="0.1" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="Ej: 25.50" style={inp} />
            </label>
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
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#334155' }
const item = { width: '100%', textAlign: 'left', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', marginBottom: 6 }
const btn = { padding: '11px 16px', border: 'none', borderRadius: 10, background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 600 }
const linkBtn = { marginLeft: 8, background: 'none', border: 'none', color: '#0d9488', cursor: 'pointer', fontSize: '0.8rem' }
