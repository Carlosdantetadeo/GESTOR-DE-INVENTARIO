'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { canSupervise } from '../../../lib/auditoria/auth'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { buscarSemantico, crearConsignacion, getConsignacionesPendientes, confirmarConsignacion, devolverConsignacion } from '../../../lib/auditoria/queries'
import { Page, Title, Button, Field, Input, Card, Note, T } from '../../../lib/auditoria/ui'

export default function ConsignacionesPage() {
  const { session, online } = useAuditoria()
  const supervisa = canSupervise(session?.rol)

  // Búsqueda de producto
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [pieza, setPieza] = useState(null)

  // Formulario de consignación
  const [cliente, setCliente] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [precio, setPrecio] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState('')

  // Voz
  const [grabando, setGrabando] = useState(false)
  const recorderRef = useRef(null)
  const canceladoRef = useRef(false)

  // Lista de pendientes
  const [pendientes, setPendientes] = useState([])
  const [cargando, setCargando] = useState(false)
  const [confirming, setConfirming] = useState(null)  // id en proceso

  useEffect(() => {
    if (session?.empresaId && online) syncCatalogo().catch(() => {})
  }, [session, online])

  const cargarPendientes = useCallback(async () => {
    if (!session?.tiendaId) return
    setCargando(true)
    try {
      const uid = supervisa ? null : session.user.id
      const data = await getConsignacionesPendientes(session.tiendaId, uid)
      setPendientes(data)
    } catch { /* silencioso */ }
    finally { setCargando(false) }
  }, [session, supervisa])

  useEffect(() => { cargarPendientes() }, [cargarPendientes])

  async function buscar(q) {
    setTexto(q); setPieza(null)
    if (!q.trim()) { setResultados([]); return }
    const locales = await buscarLocal(q)
    setResultados(locales)
    if (online && locales.length < 4) {
      const sem = await buscarSemantico(q).catch(() => null)
      if (sem?.length) setResultados(sem)
    }
  }

  async function elegir(p) {
    setPieza(p)
    setTexto(p.nombre)
    setResultados([])
  }

  function extraerRegex(texto) {
    const NUMS = { dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,
      diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,veinte:20,
      treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,cien:100 }
    let t = texto.toLowerCase()
    t = t.replace(/cada\s+(?:uno|una|\d+)/g, '')
    for (const [p, n] of Object.entries(NUMS)) t = t.replace(new RegExp(`\\b${p}\\b`, 'g'), String(n))
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*[a-záéíóúñ\s]*?\s+(?:a|por|x)\s+(\d+(?:[.,]\d+)?)/)
    if (m) return { cantidad: parseFloat(m[1].replace(',','.')), precio: parseFloat(m[2].replace(',','.')) }
    const nums = [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map(x => parseFloat(x[0].replace(',','.')))
    if (nums.length >= 2) return { cantidad: nums[0], precio: nums[1] }
    if (nums.length === 1) return { cantidad: nums[0], precio: null }
    return { cantidad: null, precio: null }
  }

  async function grabarVoz() {
    if (!online) { setAviso('La voz necesita conexión.'); return }
    canceladoRef.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (canceladoRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
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
            if (t?.trim()) {
              setAviso(`Escuché: "${t}"`)
              const parseRes = await fetch('/api/auditoria/parsear-venta', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texto: t }),
              })
              let desc = t, cant = null, prec = null
              if (parseRes.ok) {
                const d = await parseRes.json()
                if (d.descripcion) desc = d.descripcion
                cant = d.cantidad; prec = d.precio
              }
              if (cant == null && prec == null) {
                const r = extraerRegex(t); cant = r.cantidad; prec = r.precio
              }
              let res2 = online ? await buscarSemantico(desc) : null
              if (!res2?.length) res2 = await buscarLocal(desc)
              if (res2?.length) {
                await elegir(res2[0].pieza)
                if (cant != null) setCantidad(String(cant))
                if (prec != null) setPrecio(String(prec))
                setAviso('')
              } else {
                setTexto(desc)
                setAviso(`Reconocí "${desc}" pero no está en el catálogo. Busca por nombre.`)
              }
            } else { setAviso('No te entendí. Prueba de nuevo.') }
          } else if (res.status === 501) {
            setAviso('La voz no está configurada (falta API_GROQ en Vercel).')
          } else { setAviso('No se pudo transcribir el audio.') }
        } catch { setAviso('Error al transcribir.') }
      }
      recorderRef.current = rec; rec.start(); setGrabando(true)
    } catch { setAviso('No se pudo acceder al micrófono.') }
  }

  function detenerVoz() {
    canceladoRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    recorderRef.current = null
    setGrabando(false)
  }

  async function registrar() {
    if (!pieza || !cliente.trim() || !cantidad) return
    setGuardando(true); setAviso('')
    try {
      await crearConsignacion({
        empresaId: session.empresaId,
        tiendaId: session.tiendaId,
        productoId: pieza.producto_id ?? pieza.id,
        cantidad: Number(cantidad),
        precioUnitario: precio === '' ? 0 : Number(precio),
        cliente: cliente.trim(),
        authUid: session.user.id,
      })
      setAviso(`Consignación registrada: ${pieza.nombre} × ${cantidad} → ${cliente.trim()}`)
      setPieza(null); setTexto(''); setCliente(''); setCantidad(''); setPrecio('')
      cargarPendientes()
    } catch { setAviso('No se pudo registrar la consignación.') }
    finally { setGuardando(false) }
  }

  async function confirmar(c) {
    setConfirming(c.id); setAviso('')
    try {
      await confirmarConsignacion({
        consignacionId: c.id,
        productoId: c.productos?.id ?? c.producto_id,
        tiendaId: session.tiendaId,
        cantidad: c.cantidad,
        precioUnitario: c.precio_unitario,
        authUid: session.user.id,
      })
      setPendientes(prev => prev.filter(x => x.id !== c.id))
      setAviso(`Venta confirmada: ${c.productos?.nombre} × ${c.cantidad}`)
    } catch { setAviso('No se pudo confirmar la venta.') }
    finally { setConfirming(null) }
  }

  async function devolver(c) {
    setConfirming(c.id); setAviso('')
    try {
      await devolverConsignacion({ consignacionId: c.id, authUid: session.user.id })
      setPendientes(prev => prev.filter(x => x.id !== c.id))
      setAviso(`Devolución registrada: ${c.productos?.nombre}`)
    } catch { setAviso('No se pudo registrar la devolución.') }
    finally { setConfirming(null) }
  }

  if (!session) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!session.empresaId || !session.tiendaId) return (
    <Page><p style={{ color: T.muted }}>Tu cuenta necesita empresa y sede asignadas.</p></Page>
  )

  const total = Number(cantidad) > 0 && Number(precio) > 0 ? Number(cantidad) * Number(precio) : null
  const puedeRegistrar = pieza && cliente.trim() && Number(cantidad) > 0 && !guardando

  return (
    <Page>
      <Title>Consignaciones</Title>

      {/* ── Registrar nueva ────────────────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Registrar salida a cuenta
        </div>

        <Input value={texto} onChange={(e) => buscar(e.target.value)} placeholder="Buscar producto por nombre…" />
        <Button
          onPointerDown={grabarVoz}
          onPointerUp={detenerVoz}
          onPointerLeave={detenerVoz}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: 'none', userSelect: 'none', ...(grabando ? { background: '#ef4444' } : null) }}
        >
          {grabando ? '🔴 Voz' : '🎤 Voz'}
        </Button>

        {resultados.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {resultados.map(({ pieza: p }) => (
              <li key={p.producto_id ?? p.id}>
                <button onClick={() => elegir(p)} style={resultItem}>
                  <strong style={{ color: T.ink }}>{p.nombre}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}

        {pieza && (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <strong style={{ fontSize: '1.05rem', color: T.ink }}>{pieza.nombre}</strong>
              <Button variant="ghost" onClick={() => { setPieza(null); setResultados([]); setTexto('') }} style={{ marginLeft: 10 }}>
                cambiar producto
              </Button>
            </div>
            <Field label="Cliente / Razón social *">
              <Input
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Nombre del cliente"
                autoFocus
              />
            </Field>
            <Field label="Cantidad *">
              <Input type="number" inputMode="numeric" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            </Field>
            <Field label="Precio unitario">
              <Input type="number" inputMode="decimal" min="0" step="0.1" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            </Field>
            {total != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, borderTop: `1px solid ${T.line}` }}>
                <span style={{ color: T.muted, fontSize: '0.9rem' }}>Total estimado</span>
                <span style={{ fontSize: '1.3rem', fontWeight: 800, color: T.ink }}>{total.toFixed(2)}</span>
              </div>
            )}
            <Button variant="dark" full disabled={!puedeRegistrar} onClick={registrar}>
              🤝 {guardando ? 'Registrando…' : 'Registrar consignación'}
            </Button>
          </Card>
        )}
      </section>

      <Note>{aviso}</Note>

      {/* ── Pendientes ────────────────────────────────────────── */}
      <section style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pendientes de cierre{supervisa ? ' (toda la sede)' : ''}
          </div>
          <Button variant="secondary" onClick={cargarPendientes} style={{ minHeight: 'auto', padding: '6px 12px', fontSize: '0.82rem' }}>
            ↻ Actualizar
          </Button>
        </div>

        {cargando ? (
          <p style={{ color: T.muted, fontSize: '0.9rem' }}>Cargando…</p>
        ) : pendientes.length === 0 ? (
          <Card>
            <p style={{ color: T.muted, fontSize: '0.9rem', margin: 0, textAlign: 'center' }}>
              No hay consignaciones pendientes.
            </p>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendientes.map((c) => {
              const total = c.cantidad * c.precio_unitario
              const hora = new Date(c.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
              const enProceso = confirming === c.id
              return (
                <Card key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: T.ink }}>{c.productos?.nombre ?? '—'}</div>
                      <div style={{ fontSize: '0.85rem', color: T.muted }}>
                        👤 {c.cliente} · {c.cantidad} und · {hora}
                      </div>
                      {c.precio_unitario > 0 && (
                        <div style={{ fontSize: '0.85rem', color: T.ink, marginTop: 2 }}>
                          S/ {c.precio_unitario.toFixed(2)} c/u = <strong>S/ {total.toFixed(2)}</strong>
                        </div>
                      )}
                    </div>
                    <span style={estadoBadge}>pendiente</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      variant="dark"
                      full
                      disabled={enProceso}
                      onClick={() => confirmar(c)}
                      style={{ flex: 1 }}
                    >
                      ✓ {enProceso ? '…' : 'Confirmar venta'}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={enProceso}
                      onClick={() => devolver(c)}
                      style={{ flex: 1, color: '#ef4444', borderColor: '#fca5a5' }}
                    >
                      ✗ {enProceso ? '…' : 'Devuelto'}
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </Page>
  )
}

const resultItem = {
  width: '100%', textAlign: 'left', padding: '12px 14px',
  border: `1px solid ${T.line}`, borderRadius: 12, background: '#fff', cursor: 'pointer', fontSize: '1rem',
}

const estadoBadge = {
  fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 99,
  background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap', flexShrink: 0,
}
