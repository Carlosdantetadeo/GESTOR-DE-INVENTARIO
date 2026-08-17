'use client'

// Captura de conteo (US1): búsqueda local de la pieza (offline) → cantidad +
// estado físico → semáforo instantáneo (US2) → confirmar → encolar conteo.
// La voz (Groq Whisper) prellena la búsqueda cuando hay red; sin red se registra
// por búsqueda manual (offline-first, FR-001).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { canSupervise } from '../../../lib/auditoria/auth'
import { getDB } from '../../../lib/auditoria/offline/db'
import { enqueue } from '../../../lib/auditoria/offline/queue'
import { registerFlushers, flushStore, flushAll } from '../../../lib/auditoria/offline/syncEngine'
import { syncCatalogo, buscarLocal, getCatalogoMeta, getConfigLocal } from '../../../lib/auditoria/offline/catalogo'
import { flushFotos } from '../../../lib/auditoria/offline/fotos'
import { encolarAudio, listAudios, removeAudio, flushAudios } from '../../../lib/auditoria/offline/audios'
import { getOrCreateSesionActiva, subirConteo } from '../../../lib/auditoria/queries'
import { evaluarSemaforo } from '../../../lib/auditoria/semaforo'
import { comprimirImagen } from '../../../lib/auditoria/imagen'
import { Page, Title, Button, Field, Input, Select, Card, Note, T } from '../../../lib/auditoria/ui'

const ESTADOS = [
  { v: 'integra', l: 'Íntegra' },
  { v: 'deterioro_menor', l: 'Deterioro menor' },
  { v: 'danada_oxidada', l: 'Dañada / oxidada' },
]

const COLOR_BG = { verde: '#16a34a', amarillo: '#f59e0b', rojo: '#ef4444' }

// Flusher de conteos: sube los items 'conteo' de la cola (idempotente).
const conteosFlusher = () =>
  flushStore('cola_conteos', async (item) => {
    if (item.tipo === 'conteo') await subirConteo(item)
  })

async function ensureSesion({ online, empresaId, tiendaId, uid }) {
  const db = await getDB()
  if (online) {
    const id = await getOrCreateSesionActiva({ empresaId, tiendaId, uid })
    await db.put('meta', { key: 'sesion_activa', sesion_id: id, tienda_id: tiendaId })
    return id
  }
  const m = await db.get('meta', 'sesion_activa')
  return m?.sesion_id ?? null
}

export default function CapturaPage() {
  const { session, online, refreshPending } = useAuditoria()
  const [sesionId, setSesionId] = useState(null)
  const [catalogoInfo, setCatalogoInfo] = useState(null)
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [pieza, setPieza] = useState(null)
  const [cantidad, setCantidad] = useState('')
  const [estado, setEstado] = useState('integra')
  const [grabando, setGrabando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [mesesStockMuerto, setMesesStockMuerto] = useState(6)
  const [fotos, setFotos] = useState([]) // { blob, url } pendientes de adjuntar
  const [audios, setAudios] = useState([]) // notas de voz offline
  const recorderRef = useRef(null)

  // Registrar los flushers (conteos primero, luego fotos que dependen de ellos).
  useEffect(() => { registerFlushers([conteosFlusher, flushFotos, flushAudios]) }, [])

  const refreshAudios = useCallback(async () => { setAudios(await listAudios()) }, [])

  // Al reconectar (y al montar), transcribir las notas pendientes y refrescar.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (online) await flushAudios()
      if (vivo) setAudios(await listAudios())
    })()
    return () => { vivo = false }
  }, [online])

  // Preparar catálogo y sesión cuando la sesión de auth esté lista.
  useEffect(() => {
    if (!session?.empresaId || !session?.tiendaId) return
    let vivo = true
    ;(async () => {
      try {
        if (online) await syncCatalogo()
        const info = await getCatalogoMeta()
        const id = await ensureSesion({
          online, empresaId: session.empresaId, tiendaId: session.tiendaId, uid: session.user.id,
        })
        const cfg = await getConfigLocal()
        if (!vivo) return
        setCatalogoInfo(info)
        setSesionId(id)
        if (cfg?.meses_stock_muerto) setMesesStockMuerto(cfg.meses_stock_muerto)
      } catch {
        setAviso('No se pudo preparar el catálogo o la sesión.')
      }
    })()
    return () => { vivo = false }
  }, [session, online])

  const buscar = useCallback(async (q) => {
    setTexto(q)
    setPieza(null)
    if (!q.trim()) { setResultados([]); return }
    setResultados(await buscarLocal(q))
  }, [])

  const semaforo = pieza && cantidad !== ''
    ? evaluarSemaforo(pieza, { cantidad: Number(cantidad), estado_fisico: estado }, { meses_stock_muerto: mesesStockMuerto })
    : null

  async function grabarVoz() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks = []
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: rec.mimeType }) // preservar mimeType (FR-018)

        // Sin conexión: encolar el audio para transcribir al reconectar (FR-016).
        if (!navigator.onLine) {
          await encolarAudio({ blob, mimeType: rec.mimeType })
          await refreshAudios()
          await refreshPending()
          setAviso('Nota de voz guardada. Se transcribirá al reconectar.')
          return
        }

        // Con conexión: transcribir ahora y prellenar la búsqueda.
        const fd = new FormData()
        fd.append('audio', blob)
        try {
          const res = await fetch('/api/auditoria/transcribir', { method: 'POST', body: fd })
          if (res.ok) {
            const { texto: t } = await res.json()
            buscar(t)
          } else {
            setAviso('La transcripción no está disponible. Registrá por búsqueda.')
          }
        } catch {
          setAviso('No se pudo transcribir. Registrá por búsqueda.')
        }
      }
      recorderRef.current = rec
      rec.start()
      setGrabando(true)
    } catch {
      setAviso('No se pudo acceder al micrófono.')
    }
  }

  function detenerVoz() {
    recorderRef.current?.stop()
    setGrabando(false)
  }

  async function usarAudio(a) {
    buscar(a.transcripcion || '')
    await removeAudio(a.client_op_id)
    await refreshAudios()
    await refreshPending()
  }

  async function descartarAudio(a) {
    await removeAudio(a.client_op_id)
    await refreshAudios()
    await refreshPending()
  }

  async function procesarAudios() {
    await flushAudios()
    await refreshAudios()
  }

  async function agregarFoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const blob = await comprimirImagen(file)
      setFotos((prev) => [...prev, { blob, url: URL.createObjectURL(blob) }])
    } catch {
      setAviso('No se pudo procesar la foto.')
    }
  }

  function quitarFoto(i) {
    setFotos((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function confirmar() {
    if (!pieza || cantidad === '' || !sesionId || !semaforo) return
    const item = {
      tipo: 'conteo',
      empresa_id: session.empresaId,
      tienda_id: session.tiendaId,
      sesion_id: sesionId,
      producto_id: pieza.producto_id ?? pieza.id,
      cantidad: Number(cantidad),
      estado_fisico: estado,
      semaforo_color: semaforo.color,
      semaforo_razon: semaforo.razon,
      canal: 'manual',
      auditor_uid: session.user.id,
      created_at: new Date().toISOString(),
    }
    const guardado = await enqueue('cola_conteos', item)
    // Encolar las fotos de evidencia atadas a este conteo (por su client_op_id).
    for (const f of fotos) {
      await enqueue('cola_fotos', {
        conteo_client_op_id: guardado.client_op_id,
        empresa_id: session.empresaId,
        sesion_id: sesionId,
        blob: f.blob,
      })
    }
    await refreshPending()
    if (online) flushAll()
    // Reset para la próxima pieza.
    setTexto(''); setResultados([]); setPieza(null); setCantidad(''); setEstado('integra'); setFotos([])
    setAviso('Conteo registrado.')
  }

  if (!session) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!session.empresaId) return <Page><p style={{ color: T.muted }}>Tu cuenta no tiene empresa asignada.</p></Page>
  if (!canSupervise(session.rol)) return <Page><p style={{ color: T.muted }}>Solo supervisor o admin pueden contar inventario.</p></Page>
  if (!sesionId) {
    return (
      <Page>
        <p style={{ color: T.muted }}>
          {online ? 'Preparando sesión de auditoría…' : 'No hay una sesión activa guardada. Conectate una vez para abrirla.'}
        </p>
      </Page>
    )
  }

  return (
    <Page>
      <Title sub={catalogoInfo ? `Catálogo: ${catalogoInfo.total} piezas` : null}>Contar pieza</Title>

      <div style={{ display: 'flex', gap: 8 }}>
        <Input value={texto} onChange={(e) => buscar(e.target.value)} placeholder="Buscar pieza por nombre o referencia…" />
        <Button onClick={grabando ? detenerVoz : grabarVoz} style={{ whiteSpace: 'nowrap', ...(grabando ? { background: '#ef4444' } : null) }}>
          {grabando ? '⏹ Detener' : '🎤 Voz'}
        </Button>
      </div>

      {audios.length > 0 && (
        <Card style={{ marginTop: 12, background: T.bg }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.9rem' }}>Notas de voz pendientes ({audios.length})</strong>
            {online && audios.some((a) => !a.transcripcion) && <Button variant="primary" onClick={procesarAudios} style={mini}>Procesar</Button>}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {audios.map((a) => (
              <li key={a.client_op_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                {a.transcripcion ? (
                  <>
                    <span>“{a.transcripcion}”</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <Button variant="primary" onClick={() => usarAudio(a)} style={mini}>Usar</Button>
                      <Button variant="secondary" onClick={() => descartarAudio(a)} style={mini}>×</Button>
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ color: T.muted }}>🎤 Grabada, pendiente de transcribir</span>
                    <Button variant="secondary" onClick={() => descartarAudio(a)} style={mini}>×</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!pieza && resultados.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {resultados.map(({ pieza: p }) => (
            <li key={p.producto_id ?? p.id}>
              <button onClick={() => { setPieza(p); setResultados([]) }} style={resultItem}>
                <strong style={{ color: T.ink }}>{p.nombre}</strong>
                {p.referencia ? <span style={{ color: T.muted }}> · {p.referencia}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pieza && (
        <Card style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <strong style={{ color: T.ink }}>{pieza.nombre}</strong>
            {pieza.referencia ? <span style={{ color: T.muted }}> · {pieza.referencia}</span> : null}
            <Button variant="ghost" onClick={() => setPieza(null)} style={{ marginLeft: 10 }}>cambiar</Button>
          </div>

          <Field label={`Cantidad (${pieza.unidad_medida || 'unidad'})`}>
            <Input type="number" min="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus />
          </Field>

          <Field label="Estado físico">
            <Select value={estado} onChange={(e) => setEstado(e.target.value)}>
              {ESTADOS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </Select>
          </Field>

          {semaforo && (
            <div style={{ background: COLOR_BG[semaforo.color], color: '#fff', padding: 14, borderRadius: 12 }}>
              <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{semaforo.color}</div>
              <div>{semaforo.razon}</div>
              {semaforo.accion && <div style={{ fontSize: '0.85rem', marginTop: 4 }}>→ {semaforo.accion}</div>}
              {semaforo.estrategia && <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>{semaforo.estrategia}</div>}
            </div>
          )}

          <div>
            <label style={adjuntarBtn}>
              📷 Adjuntar foto
              <input type="file" accept="image/*" capture="environment" onChange={agregarFoto} style={{ display: 'none' }} />
            </label>
            {fotos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {fotos.map((f, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={f.url} alt="evidencia" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                    <button onClick={() => quitarFoto(i)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 999, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button variant="dark" full disabled={cantidad === ''} onClick={confirmar}>✅ Confirmar conteo</Button>
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
const mini = { minHeight: 'auto', padding: '5px 10px', fontSize: '0.78rem' }
const adjuntarBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px',
  background: '#e2e8f0', color: T.ink, borderRadius: 10, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
}
