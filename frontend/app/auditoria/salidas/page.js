'use client'

// Registro de salidas/ventas (FR-021), pensado mobile-first para el vendedor.
// Tres formas de encontrar la pieza: búsqueda por texto, VOZ (Groq Whisper) y
// FOTO de boleta/factura (Groq Vision → prellena el ítem). El vendedor ingresa
// cantidad y precio. Escribe en el mismo ledger que el bot; deshacer = DELETE.
import { useEffect, useRef, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { comprimirImagen } from '../../../lib/auditoria/imagen'
import { getStock, registrarSalida, deshacerSalida } from '../../../lib/auditoria/queries'

const VENTANA_MS = 5 * 60 * 1000

export default function SalidasPage() {
  const { session, online } = useAuditoria()
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [pieza, setPieza] = useState(null)
  const [stock, setStock] = useState(null)
  const [cantidad, setCantidad] = useState('')
  const [precio, setPrecio] = useState('')
  const [ultima, setUltima] = useState(null)
  const [grabando, setGrabando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [aviso, setAviso] = useState('')
  const recorderRef = useRef(null)

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

  // Voz: interpreta la frase (producto + cantidad + precio), ubica la mejor
  // coincidencia del catálogo y prellena la tarjeta para registrar o corregir.
  async function interpretarVenta(t) {
    setAviso('Interpretando…')
    let descripcion = t
    let cant = null
    let prec = null
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
        prec = d.precio
      }
      // 501 u otro error → seguimos con el texto crudo (fallback manual).
    } catch { /* fallback: usamos el texto crudo */ }

    const resultados = await buscarLocal(descripcion)
    setTexto(descripcion)
    if (resultados.length > 0) {
      setResultados([])
      await elegir(resultados[0].pieza)
      if (cant != null) setCantidad(String(cant))
      if (prec != null) setPrecio(String(prec))
      setAviso('')
    } else {
      setPieza(null); setStock(null); setResultados([])
      setAviso(`Reconocí "${descripcion}" pero no encontré ese producto. Corregí el texto o buscá por nombre.`)
    }
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
            if (t?.trim()) await interpretarVenta(t)
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

  async function procesarFoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!online) { setAviso('La foto necesita conexión.'); return }
    setProcesando(true); setAviso('')
    try {
      const blob = await comprimirImagen(file)
      const fd = new FormData()
      fd.append('imagen', blob, 'boleta.jpg')
      const res = await fetch('/api/auditoria/factura', { method: 'POST', body: fd })
      if (!res.ok) {
        setAviso(res.status === 501 ? 'La lectura de fotos no está configurada.' : 'No se pudo leer la foto.')
        return
      }
      const { items } = await res.json()
      if (!items?.length) { setAviso('No se detectaron ítems en la foto.'); return }
      const it = items[0]
      await buscar(it.descripcion)
      if (it.cantidad) setCantidad(String(it.cantidad))
      if (it.precio_unitario) setPrecio(String(it.precio_unitario))
      if (items.length > 1) setAviso(`Cargué el primer ítem. Hay ${items.length - 1} más: registralos de a uno.`)
    } catch { setAviso('Error procesando la foto.') }
    finally { setProcesando(false) }
  }

  async function registrar() {
    const cant = Number(cantidad)
    if (!pieza || !cant) return
    if (!online) { setAviso('Registrar ventas requiere conexión.'); return }
    if (stock != null && cant > stock) { setAviso(`Stock insuficiente (disponible: ${stock}).`); return }
    try {
      const mov = await registrarSalida({
        productoId: pieza.producto_id ?? pieza.id,
        tiendaId: session.tiendaId,
        cantidad: cant,
        precio: precio === '' ? 0 : Number(precio),
        authUid: session.user.id,
        clientOpId: crypto.randomUUID(),
      })
      setUltima({ ...mov, nombre: pieza.nombre, cantidad: cant })
      setAviso('Venta registrada.')
      setTexto(''); setPieza(null); setStock(null); setCantidad(''); setPrecio('')
    } catch { setAviso('No se pudo registrar la venta.') }
  }

  async function deshacer() {
    if (!ultima) return
    if (Date.now() - new Date(ultima.created_at).getTime() > VENTANA_MS) {
      setAviso('La ventana para deshacer (5 min) venció.'); setUltima(null); return
    }
    try { await deshacerSalida(ultima.id); setAviso('Venta revertida.'); setUltima(null) }
    catch { setAviso('No se pudo revertir.') }
  }

  if (!session) return <Cont><p>Cargando…</p></Cont>
  if (!session.empresaId || !session.tiendaId) return <Cont><p>Tu cuenta necesita empresa y sede asignadas.</p></Cont>

  return (
    <Cont>
      <h2 style={{ marginTop: 0 }}>Registrar venta</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          value={texto}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Buscar producto por nombre…"
          style={inp}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={grabando ? detenerVoz : grabarVoz}
            style={{ ...btnGrande, flex: 1, background: grabando ? '#ef4444' : '#0d9488', color: '#fff' }}
          >
            {grabando ? '⏹ Detener' : '🎤 Voz'}
          </button>
          <label style={{ ...btnGrande, flex: 1, background: '#0d9488', color: '#fff', textAlign: 'center' }}>
            {procesando ? '…' : '📷 Foto'}
            <input type="file" accept="image/*" capture="environment" onChange={procesarFoto} style={{ display: 'none' }} disabled={procesando} />
          </label>
        </div>
      </div>

      {!pieza && resultados.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
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
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <strong style={{ fontSize: '1.05rem' }}>{pieza.nombre}</strong>
            <button onClick={() => setPieza(null)} style={linkBtn}>cambiar</button>
            {stock != null && <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Stock disponible: {stock}</div>}
          </div>
          <label style={lbl}>Cantidad
            <input type="number" inputMode="numeric" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} style={inp} autoFocus />
          </label>
          <label style={lbl}>Precio unitario
            <input type="number" inputMode="decimal" min="0" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} style={inp} />
          </label>
          {Number(cantidad) > 0 && Number(precio) > 0 && (
            <div style={{ fontSize: '1rem', fontWeight: 700, textAlign: 'right' }}>
              Total: {(Number(cantidad) * Number(precio)).toFixed(2)}
            </div>
          )}
          <button onClick={registrar} disabled={!cantidad} style={{ ...btnGrande, background: '#0f172a', color: '#fff', opacity: cantidad ? 1 : 0.5 }}>
            💰 Registrar venta
          </button>
        </div>
      )}

      {ultima && (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #e2e8f0', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.9rem' }}>Última: {ultima.nombre} × {ultima.cantidad}</span>
          <button onClick={deshacer} style={{ ...btnGrande, background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1', padding: '8px 14px' }}>↩️ Deshacer</button>
        </div>
      )}

      {aviso && <p style={{ marginTop: 14, color: '#0d9488', fontSize: '0.9rem' }}>{aviso}</p>}
    </Cont>
  )
}

function Cont({ children }) {
  return <main style={{ padding: 16, maxWidth: 480, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>{children}</main>
}

// fontSize 16 evita el zoom automático en iOS; botones altos para el dedo.
const inp = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: '16px' }
const btnGrande = { minHeight: 48, padding: '12px 16px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 }
const item = { width: '100%', textAlign: 'left', padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', cursor: 'pointer', marginBottom: 8, fontSize: '1rem' }
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', color: '#334155' }
const linkBtn = { marginLeft: 10, background: 'none', border: 'none', color: '#0d9488', cursor: 'pointer', fontSize: '0.85rem' }
