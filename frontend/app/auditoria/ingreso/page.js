'use client'

// Ingreso manual de inventario sin factura (paridad con el bot). Solo
// supervisor/admin (el auditor/vendedor no toca inventario). Escribe en el
// ledger movimientos (tipo ingreso); el trigger sube el stock. Deshacer = DELETE.
import { useEffect, useRef, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { canSupervise } from '../../../lib/auditoria/auth'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { getStock, registrarIngresoManual, deshacerSalida, getTiendas, getSecciones, buscarSemantico } from '../../../lib/auditoria/queries'
import { Page, Title, Button, Field, Input, Select, Card, Note, T } from '../../../lib/auditoria/ui'

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

    // Online: búsqueda semántica (embeddings). Si no hay red o falla, trigram local.
    let resultados = online ? await buscarSemantico(descripcion) : null
    if (!resultados || !resultados.length) resultados = await buscarLocal(descripcion)
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

  if (!session) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!session.empresaId) return <Page><p style={{ color: T.muted }}>Tu cuenta necesita una empresa asignada.</p></Page>
  if (!canSupervise(session.rol)) return <Page><p style={{ color: T.muted }}>Solo supervisor o admin pueden ingresar inventario.</p></Page>

  return (
    <Page>
      <Title>Ingreso de inventario</Title>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Sede">
          <Select value={tiendaId} onChange={(e) => elegirSede(e.target.value)}>
            <option value="">Elegí una sede…</option>
            {tiendas.filter((t) => t.activa !== false).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Select>
        </Field>
        {tiendaId && (
          <Field label="Sección (opcional)">
            <Select value={seccionId} onChange={(e) => setSeccionId(e.target.value)}>
              <option value="">{secciones.length ? 'Sin sección' : 'Esta sede no tiene secciones (cargalas en Admin)'}</option>
              {secciones.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Select>
          </Field>
        )}
      </div>

      {tiendaId && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Input value={texto} onChange={(e) => buscar(e.target.value)} placeholder="Buscar pieza por nombre o referencia…" />
          <Button
            onClick={grabando ? detenerVoz : grabarVoz}
            style={{ whiteSpace: 'nowrap', ...(grabando ? { background: '#ef4444' } : null) }}
          >
            {grabando ? '⏹ Detener' : '🎤 Voz'}
          </Button>
        </div>
      )}

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
            {stock != null && <div style={{ fontSize: '0.85rem', color: T.muted, marginTop: 2 }}>Stock actual: {stock}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label="Cantidad">
                <Input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 10" autoFocus />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Costo unitario">
                <Input type="number" min="0" step="0.1" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="Ej: 25.50" />
              </Field>
            </div>
          </div>
          <Button variant="dark" full disabled={!cantidad} onClick={registrar}>📦 Registrar ingreso</Button>
        </Card>
      )}

      {ultimo && (
        <Card style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.9rem' }}>Último: <strong>{ultimo.nombre}</strong> × {ultimo.cantidad}</span>
          <Button variant="secondary" onClick={deshacer} style={{ minHeight: 'auto', padding: '8px 14px' }}>↩️ Deshacer</Button>
        </Card>
      )}

      <Note>{aviso}</Note>
    </Page>
  )
}

const resultItem = {
  width: '100%', textAlign: 'left', padding: '12px 14px',
  border: `1px solid ${T.line}`, borderRadius: 12, background: '#fff', cursor: 'pointer', fontSize: '1rem',
}
