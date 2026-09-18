'use client'

// Registro de ventas (FR-021), mobile-first. Se arma una ORDEN con varios ítems
// (por voz, foto o búsqueda), cada uno editable (producto, cantidad, precio), y se
// registran todos juntos. Cada ítem es un movimiento en el ledger; deshacer = DELETE.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { comprimirImagen } from '../../../lib/auditoria/imagen'
import { registrarSalida, deshacerSalida, buscarSemantico, buscarOCrearProducto, getPrecioSugerido, getProductosRecientes, buscarPorTexto, getInstruccionesNlu, getPistaVozEmpresa } from '../../../lib/auditoria/queries'
import { Page, Title, Button, Input, Card, Note, T } from '../../../lib/auditoria/ui'

const VENTANA_MS = 5 * 60 * 1000

export default function SalidasPage() {
  const { session, online } = useAuditoria()
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [orden, setOrden] = useState([])          // ítems a registrar
  const [grabando, setGrabando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [escuchado, setEscuchado] = useState('')
  const [recientes, setRecientes] = useState([])
  const [pidiendoRegistrar, setPidiendoRegistrar] = useState(false)
  const [registrando, setRegistrando] = useState(false)
  const [ultimoResumen, setUltimoResumen] = useState(null)   // { movs, count, total }
  const [pidiendoDeshacer, setPidiendoDeshacer] = useState(false)
  const [instrucciones, setInstrucciones] = useState('')   // reglas del rubro (por empresa)
  const [pistaVoz, setPistaVoz] = useState('')             // muestra de códigos para Whisper
  const recorderRef = useRef(null)
  const canceladoRef = useRef(false)

  useEffect(() => {
    if (session?.empresaId && online) syncCatalogo().catch(() => {})
  }, [session, online])

  useEffect(() => {
    if (!session?.empresaId) return
    getInstruccionesNlu().then(setInstrucciones).catch(() => {})
    getPistaVozEmpresa().then(setPistaVoz).catch(() => {})
  }, [session])

  const cargarRecientes = useCallback(async () => {
    if (!session?.user?.id) return
    try { setRecientes(await getProductosRecientes(session.user.id)) } catch { /* opcional */ }
  }, [session])

  useEffect(() => { cargarRecientes() }, [cargarRecientes])

  // ── Búsqueda ────────────────────────────────────────────────────────────────

  async function buscar(q) {
    setTexto(q); setEscuchado('')
    if (!q.trim()) { setResultados([]); return }
    setResultados(await buscarCombinado(q))
  }

  // Combina: 1) texto/CÓDIGO (substring), 2) trigrama local, 3) semántica. Deduplica.
  async function buscarCombinado(q) {
    const [porTexto, locales, sem] = await Promise.all([
      online ? buscarPorTexto(q).catch(() => []) : Promise.resolve([]),
      buscarLocal(q).catch(() => []),
      online ? buscarSemantico(q).then((r) => r || []).catch(() => []) : Promise.resolve([]),
    ])
    const vistos = new Set()
    const out = []
    for (const r of [...porTexto, ...locales, ...sem]) {
      const id = r.pieza?.producto_id ?? r.pieza?.id
      if (id == null || vistos.has(id)) continue
      vistos.add(id)
      out.push(r)
    }
    return out.slice(0, 8)
  }

  // ── Agregar ítems a la orden ─────────────────────────────────────────────────

  // Agrega un producto ya identificado (elegido de la lista o de recientes).
  async function agregarPieza(p) {
    let prec = null
    try { const s = await getPrecioSugerido(p.producto_id ?? p.id); if (s != null) prec = s } catch { /* opcional */ }
    setOrden((o) => [...o, nuevaFila({
      descripcion: p.nombre, nombre: p.nombre,
      productoId: p.producto_id ?? p.id, referencia: p.referencia ?? null,
      cantidad: 1, precio: prec, candidatos: [], mostrarCand: false,
    })])
    setTexto(''); setResultados([]); setEscuchado('')
  }

  // Agrega desde una descripción (voz/foto/manual): busca candidatos y toma el mejor.
  async function agregarItem({ descripcion, cantidad = null, precio = null }) {
    const desc = String(descripcion || '').trim()
    if (!desc) return
    const candidatos = await buscarCombinado(desc)
    const best = candidatos[0]?.pieza || null
    let prec = precio
    if (prec == null && best) {
      try { const s = await getPrecioSugerido(best.producto_id ?? best.id); if (s != null) prec = s } catch { /* opcional */ }
    }
    setOrden((o) => [...o, nuevaFila({
      descripcion: desc,
      nombre: best?.nombre ?? desc,
      productoId: best ? (best.producto_id ?? best.id) : null,
      referencia: best?.referencia ?? null,
      cantidad: cantidad ?? 1,
      precio: prec,
      candidatos,
      // Si hay varios códigos parecidos, abrir la lista para que confirmes el exacto
      // (la voz no distingue "25421" de "X25421", ni "M3" de "M13").
      mostrarCand: !best || candidatos.length > 1,
    })])
  }

  function nuevaFila({ descripcion, nombre, productoId, referencia, cantidad, precio, candidatos, mostrarCand }) {
    return {
      id: crypto.randomUUID(),
      descripcion, nombre, productoId, referencia,
      cantidad: String(cantidad ?? 1),
      precio: precio != null ? String(precio) : '',
      candidatos: candidatos ?? [],
      mostrarCand: !!mostrarCand,
    }
  }

  // ── Edición de filas ──────────────────────────────────────────────────────────

  function updateFila(id, patch) { setOrden((o) => o.map((f) => (f.id === id ? { ...f, ...patch } : f))) }
  function quitarFila(id) { setOrden((o) => o.filter((f) => f.id !== id)) }
  function ajustarCantFila(id, delta) {
    setOrden((o) => o.map((f) => (f.id === id ? { ...f, cantidad: String(Math.max(1, (Number(f.cantidad) || 0) + delta)) } : f)))
  }
  async function elegirCandidato(id, p) {
    let prec = null
    try { const s = await getPrecioSugerido(p.producto_id ?? p.id); if (s != null) prec = s } catch { /* opcional */ }
    setOrden((o) => o.map((f) => (f.id === id ? {
      ...f, productoId: p.producto_id ?? p.id, nombre: p.nombre, referencia: p.referencia ?? null,
      mostrarCand: false, precio: (f.precio === '' && prec != null) ? String(prec) : f.precio,
    } : f)))
  }

  // ── Voz ───────────────────────────────────────────────────────────────────────

  function extraerRegex(t0) {
    const NUMS = { dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,
      diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,veinte:20,
      treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,cien:100 }
    let t = t0.toLowerCase().replace(/cada\s+(?:uno|una|\d+)/g, ' ')
    for (const [p, n] of Object.entries(NUMS)) t = t.replace(new RegExp(`\\b${p}\\b`, 'g'), String(n))
    // Quitar tokens de código/talla (mezclan letras y dígitos) para no confundirlos.
    const soloVenta = t.split(/\s+/).filter((tok) => !(/[a-záéíóúñ]/.test(tok) && /\d/.test(tok))).join(' ')
    const mSoles = soloVenta.match(/(\d+(?:[.,]\d+)?)\s*(?:soles|s\/)/)
    const mConector = soloVenta.match(/(?:\ba\b|\bpor\b|\bx\b)\s+(\d+(?:[.,]\d+)?)/)
    const nums = [...soloVenta.matchAll(/\d+(?:[.,]\d+)?/g)].map((x) => parseFloat(x[0].replace(',', '.')))
    const num = (s) => parseFloat(s.replace(',', '.'))
    const cantidad = nums.length ? nums[0] : null
    let precio = null
    if (mSoles) precio = num(mSoles[1])
    else if (mConector) precio = num(mConector[1])
    else if (nums.length >= 2) precio = nums[1]
    return { cantidad, precio }
  }

  async function interpretarVenta(t) {
    setEscuchado(t); setAviso('')
    let items = []
    try {
      const res = await fetch('/api/auditoria/parsear-venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: t, instrucciones }),
      })
      if (res.ok) { const d = await res.json(); items = Array.isArray(d.items) ? d.items : [] }
    } catch { /* fallback */ }
    if (!items.length) {
      const r = extraerRegex(t)
      items = [{ descripcion: t, cantidad: r.cantidad, precio: r.precio }]
    }
    for (const it of items) {
      await agregarItem({ descripcion: it.descripcion, cantidad: it.cantidad, precio: it.precio })
    }
    setTexto(''); setResultados([])
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
        if (pistaVoz) fd.append('prompt', pistaVoz)   // sesga Whisper a los códigos de esta empresa
        try {
          const res = await fetch('/api/auditoria/transcribir', { method: 'POST', body: fd })
          if (res.ok) {
            const { texto: t } = await res.json()
            if (t?.trim()) await interpretarVenta(t)
            else setAviso('No te entendí. Prueba de nuevo o busca por nombre.')
          } else if (res.status === 501) {
            setAviso('La voz no está configurada (falta API_GROQ en Vercel).')
          } else {
            setAviso('No se pudo transcribir el audio. Prueba de nuevo.')
          }
        } catch { setAviso('No se pudo transcribir.') }
      }
      recorderRef.current = rec
      rec.start()
      setGrabando(true)
    } catch { setAviso('No se pudo acceder al micrófono.') }
  }

  function detenerVoz() {
    canceladoRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    recorderRef.current = null
    setGrabando(false)
  }

  // ── Foto (varios ítems) ────────────────────────────────────────────────────────

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
      if (instrucciones) fd.append('instrucciones', instrucciones)
      const res = await fetch('/api/auditoria/factura', { method: 'POST', body: fd })
      if (!res.ok) {
        if (res.status === 501) { setAviso('La lectura de fotos no está configurada.'); return }
        const err = await res.json().catch(() => ({}))
        setAviso(`No se pudo leer la foto. (${err.groq_status ?? res.status}${err.detail ? ': ' + err.detail.slice(0, 200) : ''})`)
        return
      }
      const { items } = await res.json()
      if (!items?.length) { setAviso('No se detectaron ítems en la foto.'); return }
      for (const it of items) {
        await agregarItem({ descripcion: it.descripcion, cantidad: it.cantidad, precio: it.precio_unitario })
      }
      setAviso(`Se agregaron ${items.length} ítem(s) de la foto. Revisa y registra.`)
    } catch { setAviso('Error procesando la foto.') }
    finally { setProcesando(false) }
  }

  // ── Registrar toda la orden ─────────────────────────────────────────────────

  async function registrarTodo() {
    if (!online) { setAviso('Registrar ventas requiere conexión.'); return }
    const filas = orden.filter((f) => Number(f.cantidad) > 0)
    if (!filas.length) return
    setRegistrando(true)
    let count = 0, total = 0
    const movs = []
    const errores = []
    for (const f of filas) {
      try {
        let pid = f.productoId
        if (!pid) { const prod = await buscarOCrearProducto(f.descripcion, session.empresaId); pid = prod.id }
        const precioNum = f.precio === '' ? 0 : Number(f.precio)
        const mov = await registrarSalida({
          productoId: pid, tiendaId: session.tiendaId, cantidad: Number(f.cantidad),
          precio: precioNum, authUid: session.user.id, clientOpId: crypto.randomUUID(),
        })
        movs.push({ id: mov.id, created_at: mov.created_at })
        count += 1
        total += Number(f.cantidad) * precioNum
      } catch { errores.push(f.nombre) }
    }
    setRegistrando(false); setPidiendoRegistrar(false)
    setOrden([]); setEscuchado(''); setTexto(''); setResultados([])
    setUltimoResumen(movs.length ? { movs, count, total } : null)
    setPidiendoDeshacer(false)
    setAviso(errores.length ? `Registradas ${count}. No se pudieron: ${errores.join(', ')}` : '')
    cargarRecientes()
  }

  async function deshacerLote() {
    setPidiendoDeshacer(false)
    if (!ultimoResumen?.movs?.length) return
    if (Date.now() - new Date(ultimoResumen.movs[0].created_at).getTime() > VENTANA_MS) {
      setAviso('La ventana para deshacer (5 min) venció.'); setUltimoResumen(null); return
    }
    try {
      for (const m of ultimoResumen.movs) await deshacerSalida(m.id)
      setAviso('Ventas deshechas.'); setUltimoResumen(null); cargarRecientes()
    } catch { setAviso('No se pudieron deshacer todas las ventas.') }
  }

  if (!session) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!session.empresaId || !session.tiendaId) return <Page><p style={{ color: T.muted }}>Tu cuenta necesita empresa y sede asignadas.</p></Page>

  const totalOrden = orden.reduce((s, f) => s + (Number(f.cantidad) || 0) * (Number(f.precio) || 0), 0)

  return (
    <Page>
      <Title>Registrar venta</Title>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Input value={texto} onChange={(e) => buscar(e.target.value)} placeholder="Buscar producto por nombre o código…" />
        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            onPointerDown={grabarVoz}
            onPointerUp={detenerVoz}
            onPointerLeave={detenerVoz}
            onContextMenu={(e) => e.preventDefault()}
            style={{ flex: 1, touchAction: 'none', userSelect: 'none', ...(grabando ? { background: '#ef4444' } : null) }}
          >
            {grabando ? '🔴 Grabando…' : '🎤 Voz'}
          </Button>
          <label style={fotoBtn}>
            {procesando ? '…' : '📷 Foto'}
            <input type="file" accept="image/*" capture="environment" onChange={procesarFoto} style={{ display: 'none' }} disabled={procesando} />
          </label>
        </div>
      </div>

      {escuchado && (
        <div style={{ marginTop: 12, fontSize: '0.92rem', color: T.ink, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 12px' }}>
          🎧 Escuché: <strong>"{escuchado}"</strong>
        </div>
      )}

      {/* Resultados de búsqueda → tocar agrega a la orden */}
      {resultados.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {resultados.map(({ pieza: p }) => (
            <li key={p.producto_id ?? p.id}>
              <button onClick={() => agregarPieza(p)} style={resultItem}>
                ➕ <strong style={{ color: T.ink }}>{p.nombre}</strong>{p.referencia ? <span style={{ color: T.muted }}> · {p.referencia}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {texto.trim() && (
        <Button variant="secondary" full onClick={() => agregarItem({ descripcion: texto.trim() })} style={{ marginTop: 8 }}>
          ➕ Agregar "{texto.trim()}" a la orden
        </Button>
      )}

      {/* Accesos rápidos */}
      {!texto.trim() && orden.length === 0 && resultados.length === 0 && recientes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: '0.8rem', color: T.muted, marginBottom: 6, fontWeight: 600 }}>Recientes — toca para agregar</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {recientes.map((p) => (
              <button key={p.id} onClick={() => agregarPieza(p)} style={chip}>{p.nombre}</button>
            ))}
          </div>
        </div>
      )}

      {/* La orden */}
      {orden.length > 0 && (
        <Card style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ color: T.ink }}>Orden — {orden.length} ítem(s)</strong>
            <button onClick={() => { setOrden([]); setPidiendoRegistrar(false) }} style={{ background: 'none', border: 'none', color: T.muted, fontSize: '0.82rem', cursor: 'pointer' }}>vaciar</button>
          </div>

          {orden.map((f) => (
            <div key={f.id} style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: T.ink }}>{f.nombre}{f.referencia ? <span style={{ color: T.muted, fontWeight: 400 }}> · {f.referencia}</span> : null}</div>
                  {!f.productoId && <div style={{ fontSize: '0.78rem', color: '#b45309' }}>Sin producto en catálogo — se creará "{f.descripcion}"</div>}
                  {f.candidatos.length > 0 && (
                    <button onClick={() => updateFila(f.id, { mostrarCand: !f.mostrarCand })} style={{ background: 'none', border: 'none', color: T.primary, fontSize: '0.8rem', padding: 0, cursor: 'pointer' }}>
                      {f.mostrarCand ? 'ocultar opciones' : 'cambiar producto'}
                    </button>
                  )}
                </div>
                <button onClick={() => quitarFila(f.id)} aria-label="Quitar ítem" style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
              </div>

              {f.mostrarCand && f.candidatos.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {f.candidatos.map(({ pieza: p }) => (
                    <button key={p.producto_id ?? p.id} onClick={() => elegirCandidato(f.id, p)} style={resultItem}>
                      <strong style={{ color: T.ink }}>{p.nombre}</strong>{p.referencia ? <span style={{ color: T.muted }}> · {p.referencia}</span> : null}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button variant="secondary" onClick={() => ajustarCantFila(f.id, -1)} style={{ minWidth: 38, fontSize: '1.2rem', fontWeight: 700 }} aria-label="Restar uno">−</Button>
                <Input type="number" inputMode="numeric" min="1" value={f.cantidad} onChange={(e) => updateFila(f.id, { cantidad: e.target.value })} style={{ width: 56, textAlign: 'center', fontWeight: 700 }} aria-label="Cantidad" />
                <Button variant="secondary" onClick={() => ajustarCantFila(f.id, 1)} style={{ minWidth: 38, fontSize: '1.2rem', fontWeight: 700 }} aria-label="Sumar uno">+</Button>
                <span style={{ color: T.muted }}>× S/</span>
                <Input type="number" inputMode="decimal" min="0" step="0.1" value={f.precio} onChange={(e) => updateFila(f.id, { precio: e.target.value })} placeholder="0.00" style={{ flex: 1, minWidth: 70 }} aria-label="Precio" />
                <span style={{ fontWeight: 700, color: T.ink, minWidth: 74, textAlign: 'right' }}>S/ {((Number(f.cantidad) || 0) * (Number(f.precio) || 0)).toFixed(2)}</span>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 12, marginTop: 6, borderTop: `2px solid ${T.line}` }}>
            <span style={{ color: T.muted }}>Total</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: T.ink }}>S/ {totalOrden.toFixed(2)}</span>
          </div>

          {!pidiendoRegistrar ? (
            <Button variant="dark" full disabled={registrando} onClick={() => setPidiendoRegistrar(true)} style={{ marginTop: 6 }}>
              💰 Registrar {orden.length} venta(s)
            </Button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12, marginTop: 6 }}>
              <span style={{ fontSize: '0.9rem', color: T.ink }}>¿Registrar {orden.length} venta(s) por S/ {totalOrden.toFixed(2)}?</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="dark" onClick={registrarTodo} disabled={registrando} style={{ flex: 1 }}>{registrando ? 'Registrando…' : 'Sí, registrar'}</Button>
                <Button variant="ghost" onClick={() => setPidiendoRegistrar(false)} disabled={registrando} style={{ flex: 1 }}>Cancelar</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Resumen del último registro + deshacer con confirmación */}
      {ultimoResumen && (
        <Card style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, borderLeft: '4px solid #16a34a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.05rem' }}>✅</span>
            <strong style={{ color: T.ink }}>{ultimoResumen.count} venta(s) registrada(s)</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ color: T.muted, fontSize: '0.9rem' }}>Total</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 800, color: T.ink }}>S/ {Number(ultimoResumen.total || 0).toFixed(2)}</span>
          </div>
          {!pidiendoDeshacer ? (
            <Button variant="secondary" onClick={() => setPidiendoDeshacer(true)} style={{ minHeight: 'auto', padding: '9px 14px' }}>↩️ Deshacer</Button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 12 }}>
              <span style={{ fontSize: '0.88rem', color: '#b91c1c' }}>¿Seguro que quieres deshacer estas {ultimoResumen.count} venta(s)? Se eliminan del registro y el stock se repone.</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="danger" onClick={deshacerLote} style={{ flex: 1 }}>Sí, deshacer</Button>
                <Button variant="ghost" onClick={() => setPidiendoDeshacer(false)} style={{ flex: 1 }}>Cancelar</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Note>{aviso}</Note>

      {/* Guía como pie de página, discreta. */}
      <p style={{ marginTop: 24, paddingTop: 12, borderTop: `1px solid ${T.line}`, fontSize: '0.75rem', color: T.faint, lineHeight: 1.6 }}>
        Cómo vender: busca por nombre o código, o mantén presionado 🎤 y di una o varias ventas
        (ej: "5 EM0021 talla 40 a 20 y 3 EM0034 a 15"), o toca 📷 para leer una boleta con varios ítems.
        Cada ítem cae en la lista para revisar cantidad y precio. Al final toca "Registrar ventas".
      </p>
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
const chip = {
  padding: '8px 14px', borderRadius: 999, border: `1px solid ${T.line}`,
  background: '#fff', cursor: 'pointer', fontSize: '0.9rem', color: T.ink,
  maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
