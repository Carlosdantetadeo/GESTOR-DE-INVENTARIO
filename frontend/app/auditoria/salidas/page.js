'use client'

// Registro de salidas/ventas (FR-021), pensado mobile-first para el vendedor.
// Tres formas de encontrar la pieza: búsqueda por texto, VOZ (Groq Whisper) y
// FOTO de boleta/factura (Groq Vision → prellena el ítem). El vendedor ingresa
// cantidad y precio. Escribe en el mismo ledger que el bot; deshacer = DELETE.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { syncCatalogo, buscarLocal } from '../../../lib/auditoria/offline/catalogo'
import { comprimirImagen } from '../../../lib/auditoria/imagen'
import { getStock, registrarSalida, deshacerSalida, buscarSemantico, buscarOCrearProducto, getPrecioSugerido, getProductosRecientes } from '../../../lib/auditoria/queries'
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
  const [sinResultado, setSinResultado] = useState(false)
  const [recientes, setRecientes] = useState([])
  const [escuchado, setEscuchado] = useState('')   // lo que transcribió la voz
  const recorderRef = useRef(null)
  const canceladoRef = useRef(false)

  useEffect(() => {
    if (session?.empresaId && online) syncCatalogo().catch(() => {})
  }, [session, online])

  const cargarRecientes = useCallback(async () => {
    if (!session?.user?.id) return
    try { setRecientes(await getProductosRecientes(session.user.id)) } catch { /* accesos rápidos son opcionales */ }
  }, [session])

  useEffect(() => { cargarRecientes() }, [cargarRecientes])

  async function buscar(q) {
    setTexto(q); setPieza(null); setStock(null); setSinResultado(false); setEscuchado('')
    if (!q.trim()) { setResultados([]); return }
    setResultados(await buscarCombinado(q))
  }

  // Combina coincidencias por trigrama (mejor para CÓDIGOS/referencias) con las
  // semánticas por embeddings (mejor cuando lo dicen distinto). Deduplica.
  async function buscarCombinado(q) {
    const locales = await buscarLocal(q).catch(() => [])
    const sem = online ? ((await buscarSemantico(q).catch(() => null)) || []) : []
    const vistos = new Set()
    const out = []
    for (const r of [...locales, ...sem]) {
      const id = r.pieza?.producto_id ?? r.pieza?.id
      if (id == null || vistos.has(id)) continue
      vistos.add(id)
      out.push(r)
    }
    return out.slice(0, 8)
  }

  async function elegir(p) {
    setPieza(p); setSinResultado(false); setEscuchado('')
    setTexto(p.nombre)   // llena el input con el nombre → el usuario puede editarlo
    setResultados([])
    const pid = p.producto_id ?? p.id
    try { setStock(await getStock(pid, session.tiendaId)) } catch { setStock(null) }
    // Precio automático: si no hay precio (no dictado), sugerir el último de venta / referencial.
    try {
      const sug = await getPrecioSugerido(pid)
      if (sug != null) setPrecio((prev) => (prev === '' ? String(sug) : prev))
    } catch { /* precio sugerido es opcional */ }
  }

  // Registrar con Enter desde los campos (menos toques).
  function onEnterRegistrar(e) {
    if (e.key === 'Enter') { e.preventDefault(); registrar() }
  }

  // Ajusta la cantidad con los botones rápidos (mínimo 1).
  function ajustarCantidad(delta) {
    setCantidad((c) => String(Math.max(1, (Number(c) || 0) + delta)))
  }

  // Extrae cantidad y precio de frases de venta. Convierte palabras numéricas a dígitos
  // antes de buscar (Whisper a veces transcribe "cinco" en vez de "5").
  function extraerRegex(texto) {
    const NUMS = { dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,
      diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,veinte:20,
      treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,cien:100 }
    let t = texto.toLowerCase()
    // Eliminar "cada uno/una/1/..." para que no contamine los números
    t = t.replace(/cada\s+(?:uno|una|\d+)/g, '')
    for (const [p, n] of Object.entries(NUMS)) t = t.replace(new RegExp(`\\b${p}\\b`, 'g'), String(n))
    // Patrón: "X [palabras] a/por/x Y"
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*[a-záéíóúñ\s]*?\s+(?:a|por|x)\s+(\d+(?:[.,]\d+)?)/)
    if (m) return { cantidad: parseFloat(m[1].replace(',','.')), precio: parseFloat(m[2].replace(',','.')) }
    // Fallback: tomar los dos primeros números del texto
    const nums = [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map(x => parseFloat(x[0].replace(',','.')))
    if (nums.length >= 2) return { cantidad: nums[0], precio: nums[1] }
    if (nums.length === 1) return { cantidad: nums[0], precio: null }
    return { cantidad: null, precio: null }
  }

  async function interpretarVenta(t) {
    setEscuchado(t)
    setAviso('')
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
    } catch { /* fallback */ }

    // Si el NLU no extrajo números, intentar con regex sobre el texto original.
    if (cant == null && prec == null) {
      const r = extraerRegex(t)
      cant = r.cantidad
      prec = r.precio
    }

    // Buscar candidatos por código (trigrama) + significado (embeddings).
    let encontrados = await buscarCombinado(descripcion)
    if (!encontrados.length && descripcion !== t) encontrados = await buscarCombinado(t)
    setTexto(descripcion)
    setPieza(null); setStock(null)
    // Precargar lo dictado; queda listo cuando elijas o crees el producto.
    if (cant != null) setCantidad(String(cant))
    if (prec != null) setPrecio(String(prec))
    if (encontrados.length > 0) {
      setResultados(encontrados)   // mostrar candidatos para confirmar el correcto
      setSinResultado(false)
    } else {
      setResultados([]); setSinResultado(true)
    }
  }

  // Vende un ítem que no estaba seleccionado: usa el producto si ya existe (por
  // nombre) o lo crea, y abre la tarjeta para registrar. Evita duplicar.
  async function crearYVender() {
    const nombre = texto.trim()
    if (!nombre) return
    if (!online) { setAviso('Crear productos requiere conexión.'); return }
    setAviso('Preparando producto…')
    try {
      const prod = await buscarOCrearProducto(nombre, session.empresaId)
      setResultados([]); setSinResultado(false)
      await elegir(prod)
      setAviso('')
    } catch { setAviso('No se pudo crear el producto.') }
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
      setGrabando(true); setSinResultado(false)
    } catch { setAviso('No se pudo acceder al micrófono.') }
  }

  function detenerVoz() {
    canceladoRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    recorderRef.current = null
    setGrabando(false)
  }

  // Vuelve al estado inicial para dictar/buscar de nuevo.
  function limpiar() {
    setTexto(''); setResultados([]); setPieza(null); setStock(null)
    setCantidad(''); setPrecio(''); setAviso(''); setSinResultado(false); setEscuchado('')
  }

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
        if (res.status === 501) { setAviso('La lectura de fotos no está configurada.'); return }
        const err = await res.json().catch(() => ({}))
        setAviso(`No se pudo leer la foto. (${err.groq_status ?? res.status}${err.detail ? ': ' + err.detail.slice(0, 300) : ''})`)
        return
      }
      const { items } = await res.json()
      if (!items?.length) { setAviso('No se detectaron ítems en la foto.'); return }
      const it = items[0]
      await buscar(it.descripcion)
      if (it.cantidad) setCantidad(String(it.cantidad))
      if (it.precio_unitario) setPrecio(String(it.precio_unitario))
      if (items.length > 1) setAviso(`Cargué el primer ítem. Hay ${items.length - 1} más: regístralos uno por uno.`)
    } catch { setAviso('Error procesando la foto.') }
    finally { setProcesando(false) }
  }

  async function registrar() {
    const cant = Number(cantidad)
    if (!pieza || !cant) return
    if (!online) { setAviso('Registrar ventas requiere conexión.'); return }
    if (stock != null && cant > stock) setAviso(`⚠️ Stock actual: ${stock}. La venta quedará en negativo.`)
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
      setTexto(''); setPieza(null); setStock(null); setCantidad(''); setPrecio(''); setSinResultado(false); setEscuchado('')
      cargarRecientes()
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

      {!texto.trim() && !pieza && resultados.length === 0 && recientes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: '0.8rem', color: T.muted, marginBottom: 6, fontWeight: 600 }}>Recientes — toca para vender de nuevo</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {recientes.map((p) => (
              <button key={p.id} onClick={() => elegir(p)} style={chip}>{p.nombre}</button>
            ))}
          </div>
        </div>
      )}

      {escuchado && !pieza && (
        <div style={{ marginTop: 12, fontSize: '0.92rem', color: T.ink, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 12px' }}>
          🎧 Escuché: <strong>"{escuchado}"</strong>
          <div style={{ color: T.muted, fontSize: '0.82rem', marginTop: 2 }}>
            {resultados.length > 0 ? 'Elige el producto correcto de abajo.' : 'No lo encontré en el catálogo. Créalo abajo o corrige el texto.'}
          </div>
        </div>
      )}

      {resultados.length > 0 && (
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

      {texto.trim() && !pieza && !grabando && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {resultados.length === 0 && (
            <span style={{ fontSize: '0.9rem', color: T.muted }}>
              {sinResultado ? 'No está en el catálogo.' : 'Elige de la lista o crea el producto.'}
            </span>
          )}
          <Button variant="secondary" full onClick={crearYVender}>➕ Vender "{texto.trim()}" (crear si no está)</Button>
          <Button variant="ghost" onClick={limpiar}>🔄 Limpiar y empezar de nuevo</Button>
        </div>
      )}

      {pieza && (
        <Card style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <strong style={{ fontSize: '1.05rem', color: T.ink }}>{pieza.nombre}</strong>
            <Button variant="ghost" onClick={() => { setPieza(null); setStock(null); setResultados([]); setTexto('') }} style={{ marginLeft: 10 }}>cambiar producto</Button>
            {stock != null && <div style={{ fontSize: '0.85rem', color: T.muted, marginTop: 2 }}>Stock disponible: {stock}</div>}
          </div>
          <Field label="Cantidad">
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <Button variant="secondary" onClick={() => ajustarCantidad(-1)} style={{ minWidth: 48, fontSize: '1.3rem', fontWeight: 700 }} aria-label="Restar uno">−</Button>
              <Input type="number" inputMode="numeric" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} onKeyDown={onEnterRegistrar} autoFocus style={{ flex: 1, textAlign: 'center', fontSize: '1.15rem', fontWeight: 700 }} />
              <Button variant="secondary" onClick={() => ajustarCantidad(1)} style={{ minWidth: 48, fontSize: '1.3rem', fontWeight: 700 }} aria-label="Sumar uno">+</Button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {[1, 2, 3, 5, 10, 12].map((n) => (
                <Button key={n} variant="ghost" onClick={() => setCantidad(String(n))}
                  style={{ minWidth: 44, padding: '8px 0', border: `1px solid ${T.line}`, fontWeight: 700, ...(Number(cantidad) === n ? { background: T.ink, color: '#fff' } : null) }}>
                  {n}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Precio unitario">
            <Input type="number" inputMode="decimal" min="0" step="0.1" value={precio} onChange={(e) => setPrecio(e.target.value)} onKeyDown={onEnterRegistrar} placeholder="0.00" />
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

      {/* Guía como pie de página, discreta (no se confunde con el flujo principal). */}
      <p style={{ marginTop: 24, paddingTop: 12, borderTop: `1px solid ${T.line}`, fontSize: '0.75rem', color: T.faint, lineHeight: 1.6 }}>
        Cómo vender: escribe el producto, o mantén presionado 🎤 y di la venta (ej: "5 polos a 20"), o toca 📷 para la boleta.
        Luego elige el producto, pon cantidad y precio, y toca Registrar venta.
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
