'use client'

// Registro de salidas/ventas (FR-021), pensado mobile-first para el vendedor.
// Tres formas de encontrar la pieza: búsqueda por texto, VOZ (Groq Whisper) y
// FOTO de boleta/factura (Groq Vision → prellena el ítem). El vendedor ingresa
// cantidad y precio. Escribe en el mismo ledger que el bot; deshacer = DELETE.
import { useEffect, useRef, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { comprimirImagen } from '../../../lib/auditoria/imagen'
import { getStock, registrarSalida, deshacerSalida, buscarSemantico } from '../../../lib/auditoria/queries'
import { Page, Title, Button, Field, Input, Card, Note, T } from '../../../lib/auditoria/ui'

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

    // Online: búsqueda semántica (embeddings). Si no hay red o falla, trigram local.
    let resultados = online ? await buscarSemantico(descripcion) : null
    if (!resultados || !resultados.length) resultados = await buscarLocal(descripcion)
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

  if (!session) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!session.empresaId || !session.tiendaId) return <Page><p style={{ color: T.muted }}>Tu cuenta necesita empresa y sede asignadas.</p></Page>

  const total = Number(cantidad) > 0 && Number(precio) > 0 ? Number(cantidad) * Number(precio) : null

  return (
    <Page>
      <Title>Registrar venta</Title>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Input value={texto} onChange={(e) => buscar(e.target.value)} placeholder="Buscar producto por nombre…" />
        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            onClick={grabando ? detenerVoz : grabarVoz}
            style={{ flex: 1, ...(grabando ? { background: '#ef4444' } : null) }}
          >
            {grabando ? '⏹ Detener' : '🎤 Voz'}
          </Button>
          <label style={fotoBtn}>
            {procesando ? '…' : '📷 Foto'}
            <input type="file" accept="image/*" capture="environment" onChange={procesarFoto} style={{ display: 'none' }} disabled={procesando} />
          </label>
        </div>
      </div>

      {!pieza && resultados.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {resultados.map(({ pieza: p }) => (
            <li key={p.producto_id ?? p.id}>
              <button onClick={() => elegir(p)} style={resultItem}>
                <strong style={{ color: T.ink }}>{p.nombre}</strong>{p.referencia ? <span style={{ color: T.muted }}> · {p.referencia}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pieza && (
        <Card style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <strong style={{ fontSize: '1.05rem', color: T.ink }}>{pieza.nombre}</strong>
            <Button variant="ghost" onClick={() => setPieza(null)} style={{ marginLeft: 10 }}>cambiar</Button>
            {stock != null && <div style={{ fontSize: '0.85rem', color: T.muted, marginTop: 2 }}>Stock disponible: {stock}</div>}
          </div>
          <Field label="Cantidad">
            <Input type="number" inputMode="numeric" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus />
          </Field>
          <Field label="Precio unitario">
            <Input type="number" inputMode="decimal" min="0" step="0.1" value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </Field>
          {total != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, borderTop: `1px solid ${T.line}` }}>
              <span style={{ color: T.muted, fontSize: '0.9rem' }}>Total</span>
              <span style={{ fontSize: '1.3rem', fontWeight: 800, color: T.ink }}>{total.toFixed(2)}</span>
            </div>
          )}
          <Button variant="dark" full disabled={!cantidad} onClick={registrar}>💰 Registrar venta</Button>
        </Card>
      )}

      {ultima && (
        <Card style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.9rem' }}>Última: <strong>{ultima.nombre}</strong> × {ultima.cantidad}</span>
          <Button variant="secondary" onClick={deshacer} style={{ minHeight: 'auto', padding: '8px 14px' }}>↩️ Deshacer</Button>
        </Card>
      )}

      <Note>{aviso}</Note>
    </Page>
  )
}

const fotoBtn = {
  flex: 1, minHeight: 46, padding: '11px 18px', borderRadius: T.radius,
  background: T.primary, color: '#fff', fontWeight: 600, fontSize: '1rem',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
}
const resultItem = {
  width: '100%', textAlign: 'left', padding: '12px 14px',
  border: `1px solid ${T.line}`, borderRadius: 12, background: '#fff', cursor: 'pointer', fontSize: '1rem',
}
