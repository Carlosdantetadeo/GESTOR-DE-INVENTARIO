'use client'

// Captura de conteo (US1): búsqueda local de la pieza (offline) → cantidad +
// estado físico → semáforo instantáneo (US2) → confirmar → encolar conteo.
// La voz (Groq Whisper) prellena la búsqueda cuando hay red; sin red se registra
// por búsqueda manual (offline-first, FR-001).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { getDB } from '../../../lib/auditoria/offline/db'
import { enqueue } from '../../../lib/auditoria/offline/queue'
import { registerFlushers, flushStore, flushAll } from '../../../lib/auditoria/offline/syncEngine'
import { syncCatalogo, buscarLocal, getCatalogoMeta, getConfigLocal } from '../../../lib/auditoria/offline/catalogo'
import { flushFotos } from '../../../lib/auditoria/offline/fotos'
import { encolarAudio, listAudios, removeAudio, flushAudios } from '../../../lib/auditoria/offline/audios'
import { getOrCreateSesionActiva, subirConteo } from '../../../lib/auditoria/queries'
import { evaluarSemaforo } from '../../../lib/auditoria/semaforo'
import { comprimirImagen } from '../../../lib/auditoria/imagen'

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

  if (!session) return <Contenedor><p>Cargando…</p></Contenedor>
  if (!session.empresaId) return <Contenedor><p>Tu cuenta no tiene empresa asignada.</p></Contenedor>
  if (!sesionId) {
    return (
      <Contenedor>
        <p>
          {online
            ? 'Preparando sesión de auditoría…'
            : 'No hay una sesión activa guardada. Conectate una vez para abrirla.'}
        </p>
      </Contenedor>
    )
  }

  return (
    <Contenedor>
      <h2 style={{ marginTop: 0 }}>Contar pieza</h2>
      {catalogoInfo && (
        <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: -8 }}>
          Catálogo: {catalogoInfo.total} piezas
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={texto}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Buscar pieza por nombre o referencia…"
          style={inputStyle}
        />
        <button
          onClick={grabando ? detenerVoz : grabarVoz}
          style={{ ...btnStyle, background: grabando ? '#ef4444' : '#0d9488', color: '#fff' }}
        >
          {grabando ? 'Detener' : '🎤 Voz'}
        </button>
      </div>

      {audios.length > 0 && (
        <section style={{ marginTop: 12, padding: 10, border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.9rem' }}>Notas de voz pendientes ({audios.length})</strong>
            {online && audios.some((a) => !a.transcripcion) && <button onClick={procesarAudios} style={miniBtn}>Procesar</button>}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {audios.map((a) => (
              <li key={a.client_op_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                {a.transcripcion ? (
                  <>
                    <span>“{a.transcripcion}”</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => usarAudio(a)} style={miniBtn}>Usar</button>
                      <button onClick={() => descartarAudio(a)} style={miniBtnGhost}>×</button>
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ color: '#64748b' }}>🎤 Grabada, pendiente de transcribir</span>
                    <button onClick={() => descartarAudio(a)} style={miniBtnGhost}>×</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!pieza && resultados.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {resultados.map(({ pieza: p }) => (
            <li key={p.producto_id ?? p.id}>
              <button onClick={() => { setPieza(p); setResultados([]) }} style={itemStyle}>
                <strong>{p.nombre}</strong>
                {p.referencia ? <span style={{ color: '#64748b' }}> · {p.referencia}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pieza && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <strong>{pieza.nombre}</strong>
            {pieza.referencia ? <span style={{ color: '#64748b' }}> · {pieza.referencia}</span> : null}
            <button onClick={() => setPieza(null)} style={linkBtn}>cambiar</button>
          </div>

          <label style={labelStyle}>
            Cantidad ({pieza.unidad_medida || 'unidad'})
            <input
              type="number" min="0" value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              style={inputStyle} autoFocus
            />
          </label>

          <label style={labelStyle}>
            Estado físico
            <select value={estado} onChange={(e) => setEstado(e.target.value)} style={inputStyle}>
              {ESTADOS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </label>

          {semaforo && (
            <div style={{ background: COLOR_BG[semaforo.color], color: '#fff', padding: 14, borderRadius: 10 }}>
              <div style={{ fontWeight: 700, textTransform: 'uppercase' }}>{semaforo.color}</div>
              <div>{semaforo.razon}</div>
              {semaforo.accion && <div style={{ fontSize: '0.85rem', marginTop: 4 }}>→ {semaforo.accion}</div>}
              {semaforo.estrategia && <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>{semaforo.estrategia}</div>}
            </div>
          )}

          <div>
            <label style={{ ...btnStyle, background: '#e2e8f0', color: '#0f172a', display: 'inline-block', fontSize: '0.9rem' }}>
              📷 Adjuntar foto
              <input type="file" accept="image/*" capture="environment" onChange={agregarFoto} style={{ display: 'none' }} />
            </label>
            {fotos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {fotos.map((f, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={f.url} alt="evidencia" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                    <button
                      onClick={() => quitarFoto(i)}
                      style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 999, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', lineHeight: 1 }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={confirmar}
            disabled={cantidad === ''}
            style={{ ...btnStyle, background: '#0f172a', color: '#fff', opacity: cantidad === '' ? 0.5 : 1 }}
          >
            ✅ Confirmar conteo
          </button>
        </div>
      )}

      {aviso && <p style={{ marginTop: 12, color: '#0d9488', fontSize: '0.85rem' }}>{aviso}</p>}
    </Contenedor>
  )
}

function Contenedor({ children }) {
  return <main style={{ padding: 16, maxWidth: 560, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>{children}</main>
}

const inputStyle = { flex: 1, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: '1rem', width: '100%' }
const btnStyle = { padding: '10px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '1rem' }
const itemStyle = { width: '100%', textAlign: 'left', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', marginBottom: 6 }
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', color: '#334155' }
const linkBtn = { marginLeft: 8, background: 'none', border: 'none', color: '#0d9488', cursor: 'pointer', fontSize: '0.8rem' }
const miniBtn = { padding: '4px 10px', border: 'none', borderRadius: 6, background: '#0d9488', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }
const miniBtnGhost = { padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: '0.75rem' }
