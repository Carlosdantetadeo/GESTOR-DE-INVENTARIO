'use client'

// Administración (US6): carga de catálogo (Excel/CSV), embeddings, sedes,
// secciones, usuarios y configuración del tenant. Solo admin.
import { useCallback, useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuditoria } from '../AuditoriaShell'
import { isAdmin } from '../../../lib/auditoria/auth'
import {
  importarCatalogo, getEmpresaConfig, updateEmpresaConfig, getTelegramTokens,
  getTiendas, crearTienda, renombrarTienda, setTiendaActiva,
  getSecciones, crearSeccion, renombrarSeccion, borrarSeccion,
  productosSinEmbedding, contarSinEmbedding, getEstadoEmbeddings, guardarEmbedding, cargarStockInicial,
} from '../../../lib/auditoria/queries'
import { Page, Title, Button, Field, Input, Select, Card, Note, T, inputStyle } from '../../../lib/auditoria/ui'

const COLUMNAS = ['nombre', 'unidad_medida', 'referencia']
const COLUMNAS_STOCK = ['referencia', 'nombre', 'cantidad', 'costo']

export default function CatalogoPage() {
  const { session } = useAuditoria()
  const [config, setConfig] = useState(null)
  const [meses, setMeses] = useState(6)
  const [usuarios, setUsuarios] = useState([])
  const [resultado, setResultado] = useState('')
  const [nuevo, setNuevo] = useState({ email: '', nombre: '', rol: 'vendedor', tienda_id: '' })
  const [credNueva, setCredNueva] = useState(null)   // { email, password } recién creada
  const [tiendas, setTiendas] = useState([])
  const [tiendaNueva, setTiendaNueva] = useState('')
  const [secTienda, setSecTienda] = useState('')
  const [secciones, setSecciones] = useState([])
  const [secNombre, setSecNombre] = useState('')
  const [tokens, setTokens] = useState({ operario: '', admin: '' })
  const [aviso, setAviso] = useState('')
  // Carga de stock inicial (dos pasos: elegir archivo → confirmar).
  const [stockSede, setStockSede] = useState('')
  const [stockPend, setStockPend] = useState(null)   // { filas, errores } a la espera de confirmar
  const [stockResultado, setStockResultado] = useState('')
  const [stockCargando, setStockCargando] = useState(false)
  const [embEstado, setEmbEstado] = useState(null)   // { total, con, sin }

  const cargarUsuarios = useCallback(async () => {
    const res = await fetch('/api/auditoria/usuarios')
    if (res.ok) setUsuarios((await res.json()).usuarios || [])
  }, [])

  const refrescarEmb = useCallback(() => {
    getEstadoEmbeddings().then(setEmbEstado).catch(() => {})
  }, [])

  useEffect(() => {
    if (!session || !isAdmin(session.rol)) return
    getEmpresaConfig().then((c) => { setConfig(c); setMeses(c?.meses_stock_muerto ?? 6) }).catch(() => {})
    getTiendas().then(setTiendas).catch(() => {})
    getTelegramTokens(session.empresaId).then(setTokens).catch(() => {})
    cargarUsuarios()
    refrescarEmb()
  }, [session, cargarUsuarios, refrescarEmb])

  async function copiar(texto) {
    if (!texto) return
    try { await navigator.clipboard.writeText(texto); setAviso('Token copiado.') }
    catch { setAviso('No se pudo copiar (copialo a mano).') }
  }

  async function elegirSecTienda(id) {
    setSecTienda(id); setSecciones([])
    if (id) { try { setSecciones(await getSecciones(Number(id))) } catch { setSecciones([]) } }
  }

  async function agregarSeccion(e) {
    e.preventDefault()
    if (!secTienda || !secNombre.trim()) return
    try {
      await crearSeccion({ empresaId: session.empresaId, tiendaId: Number(secTienda), nombre: secNombre.trim() })
      setSecNombre('')
      setSecciones(await getSecciones(Number(secTienda)))
      setAviso('Sección creada.')
    } catch {
      setAviso('No se pudo crear la sección (¿nombre repetido en esa sede?).')
    }
  }

  async function guardarSeccion(id, nombre) {
    try {
      await renombrarSeccion({ id, nombre: nombre.trim() })
      setSecciones(await getSecciones(Number(secTienda)))
      setAviso('Sección actualizada.')
    } catch { setAviso('No se pudo actualizar la sección (¿nombre repetido?).') }
  }

  async function eliminarSeccion(id) {
    try {
      await borrarSeccion(id)
      setSecciones(await getSecciones(Number(secTienda)))
      setAviso('Sección borrada.')
    } catch { setAviso('No se pudo borrar la sección.') }
  }

  // ── Sedes ──
  async function agregarTienda(e) {
    e.preventDefault()
    if (!tiendaNueva.trim()) return
    try {
      await crearTienda({ empresaId: session.empresaId, nombre: tiendaNueva.trim() })
      setTiendaNueva('')
      setTiendas(await getTiendas())
      setAviso('Sede creada.')
    } catch { setAviso('No se pudo crear la sede.') }
  }

  async function guardarTienda(id, nombre) {
    try {
      await renombrarTienda({ id, nombre: nombre.trim() })
      setTiendas(await getTiendas())
      setAviso('Sede actualizada.')
    } catch { setAviso('No se pudo actualizar la sede.') }
  }

  async function toggleTienda(id, activa) {
    try {
      await setTiendaActiva({ id, activa })
      setTiendas(await getTiendas())
      setAviso(activa ? 'Sede activada.' : 'Sede desactivada.')
    } catch { setAviso('No se pudo cambiar el estado de la sede.') }
  }

  // Baja un Excel modelo con las columnas correctas y una fila de ejemplo.
  function descargarPlantilla() {
    const ejemplo = {
      nombre: 'Tornillo hexagonal 1/2"',
      unidad_medida: 'unidad',
      referencia: 'TH-12',
    }
    const ws = XLSX.utils.json_to_sheet([ejemplo], { header: COLUMNAS })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'catalogo')
    XLSX.writeFile(wb, 'plantilla-catalogo.xlsx')
  }

  // Genera los embeddings de los productos que no lo tienen (base para la
  // búsqueda semántica). Procesa en lotes; muestra progreso.
  async function generarEmbeddings() {
    setResultado('Buscando productos sin embedding…')
    try {
      const totalPend = await contarSinEmbedding()
      if (!totalPend) { setResultado('Todos los productos ya tienen embedding. ✅'); return }

      let hechos = 0
      const lote = 16
      // Procesa en tandas hasta terminar. Guarda a medida que avanza, así es
      // resumible: si se corta o HuggingFace limita, volvés a apretar y sigue.
      for (;;) {
        const pend = await productosSinEmbedding()   // hasta 1000 sin embedding
        if (!pend.length) break
        const antes = hechos
        for (let i = 0; i < pend.length; i += lote) {
          const grupo = pend.slice(i, i + lote)
          const textos = grupo.map((p) => [p.nombre, p.referencia].filter(Boolean).join(' '))
          const res = await fetch('/api/auditoria/embeddings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ textos }),
          })
          if (!res.ok) {
            setResultado(`Pausado en ${hechos}/${totalPend} (HTTP ${res.status}). Volvé a apretar "Generar embeddings" para continuar.`)
            return
          }
          const { vectores } = await res.json()
          for (let j = 0; j < grupo.length; j++) {
            if (vectores[j]?.length) {
              try { await guardarEmbedding(grupo[j].id, vectores[j]); hechos++ } catch { /* reintenta en la próxima vuelta */ }
            }
          }
          setResultado(`Generando embeddings… ${hechos}/${totalPend}`)
        }
        // Si una tanda completa no avanzó, cortar para no quedar en bucle.
        if (hechos === antes) {
          setResultado(`Pausado en ${hechos}/${totalPend}: no se pudo avanzar. Revisá HuggingFace y reintentá.`)
          return
        }
      }
      setResultado(`Listo: ${hechos} producto(s) con embedding en esta corrida. 🧠`)
    } catch {
      setResultado('No se pudieron generar los embeddings.')
    } finally {
      refrescarEmb()
    }
  }

  async function importar(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setResultado('Procesando archivo…')
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const { filas, errores } = validar(rows)
      if (!filas.length) {
        setResultado(`Ninguna fila válida. Errores: ${errores.join('; ') || 'archivo vacío'}`)
        return
      }
      const { insertados, actualizados, omitidos = [] } = await importarCatalogo({
        empresaId: session.empresaId,
        filas,
        onProgreso: ({ fase, hechos, total }) =>
          setResultado(`${fase === 'insertando' ? 'Cargando' : 'Actualizando'} ${hechos}/${total}…`),
      })
      const totalOmit = errores.length + omitidos.length
      setResultado(
        `Importado: ${insertados} nuevas, ${actualizados} actualizadas` +
        (totalOmit ? ` · ${totalOmit} omitida(s)` : '') +
        (omitidos.length ? `. Sin cargar: ${omitidos.slice(0, 5).join('; ')}${omitidos.length > 5 ? '…' : ''}` : ''),
      )
      refrescarEmb()
    } catch (err) {
      console.error('[importar catalogo]', err)
      setResultado(`No se pudo procesar el archivo: ${err?.message || err}`)
    } finally {
      e.target.value = ''
    }
  }

  // Baja la plantilla de stock inicial: referencia + cantidad (nombre y costo opcionales).
  function descargarPlantillaStock() {
    const ejemplo = { referencia: 'TH-12', nombre: 'Tornillo hexagonal 1/2"', cantidad: 50, costo: 0.8 }
    const ws = XLSX.utils.json_to_sheet([ejemplo], { header: COLUMNAS_STOCK })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'stock')
    XLSX.writeFile(wb, 'plantilla-stock-inicial.xlsx')
  }

  // Paso 1: leer y validar el archivo, dejarlo pendiente de confirmación.
  async function elegirArchivoStock(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!stockSede) { setStockResultado('Elegí primero la sede destino.'); return }
    setStockResultado('Leyendo archivo…')
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const { filas, errores } = validarStock(rows)
      if (!filas.length) {
        setStockPend(null)
        setStockResultado(`Ninguna fila válida. ${errores.slice(0, 3).join('; ') || 'archivo vacío'}`)
        return
      }
      setStockPend({ filas, errores })
      setStockResultado('')
    } catch {
      setStockPend(null)
      setStockResultado('No se pudo leer el archivo.')
    }
  }

  // Paso 2: confirmar → crea los ingresos en el ledger de la sede elegida.
  async function confirmarStock() {
    if (!stockPend || !stockSede) return
    setStockCargando(true)
    try {
      const { cargados, sinMatch } = await cargarStockInicial({
        tiendaId: Number(stockSede),
        filas: stockPend.filas,
        authUid: session.user.id,
      })
      const sedeNombre = tiendas.find((t) => Number(t.id) === Number(stockSede))?.nombre ?? 'la sede'
      let msg = `Cargado: ${cargados} ingreso(s) en ${sedeNombre}.`
      if (sinMatch.length) msg += ` · ${sinMatch.length} sin producto (revisá referencia/nombre): ${sinMatch.slice(0, 5).join(', ')}${sinMatch.length > 5 ? '…' : ''}`
      setStockResultado(msg)
      setStockPend(null)
    } catch {
      setStockResultado('No se pudo cargar el stock.')
    } finally {
      setStockCargando(false)
    }
  }

  async function guardarConfig(e) {
    e.preventDefault()
    try {
      await updateEmpresaConfig({ empresaId: session.empresaId, mesesStockMuerto: Number(meses) })
      setAviso('Configuración guardada.')
    } catch {
      setAviso('No se pudo guardar la configuración.')
    }
  }

  async function crearUsuario(e) {
    e.preventDefault()
    setAviso('')
    setCredNueva(null)
    const res = await fetch('/api/auditoria/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: nuevo.email,
        nombre: nuevo.nombre,
        rol: nuevo.rol,
        tienda_id: nuevo.tienda_id === '' ? null : Number(nuevo.tienda_id),
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setCredNueva({ email: nuevo.email, password: data.password })
      setNuevo({ email: '', nombre: '', rol: 'vendedor', tienda_id: '' })
      cargarUsuarios()
    } else {
      const err = await res.json().catch(() => ({}))
      setAviso(`No se pudo crear el usuario (${err.error || res.status}).`)
    }
  }

  // Guarda el nombre visible de un usuario existente (para identificarlo en reportes).
  async function guardarNombre(id, nombre) {
    const res = await fetch('/api/auditoria/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, nombre }),
    })
    if (res.ok) { setAviso('Nombre guardado.'); cargarUsuarios() }
    else setAviso('No se pudo guardar el nombre.')
  }

  // Activa/desactiva un usuario (ban reversible: desactivado no puede ingresar).
  async function toggleActivoUsuario(id, activo) {
    const res = await fetch('/api/auditoria/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, activo }),
    })
    if (res.ok) { setAviso(activo ? 'Usuario activado.' : 'Usuario desactivado.'); cargarUsuarios() }
    else { const err = await res.json().catch(() => ({})); setAviso(`No se pudo cambiar el estado (${err.error || res.status}).`) }
  }

  // Elimina de forma permanente un usuario.
  async function eliminarUsuario(id) {
    const res = await fetch(`/api/auditoria/usuarios?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) { setAviso('Usuario eliminado.'); cargarUsuarios() }
    else { const err = await res.json().catch(() => ({})); setAviso(`No se pudo eliminar (${err.error || res.status}).`) }
  }

  if (!session) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!isAdmin(session.rol)) return <Page><p style={{ color: T.muted }}>Solo un administrador puede gestionar catálogo y usuarios.</p></Page>

  return (
    <Page>
      <Title>Administración</Title>

      <Panel titulo="Cargar catálogo (Excel/CSV)">
        <p style={muted}>
          Columnas: {COLUMNAS.join(', ')}. <code>nombre</code> es obligatorio; <code>unidad_medida</code> y <code>referencia</code> son opcionales.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={descargarPlantilla}>⬇️ Plantilla</Button>
          <label style={fileBtn}>
            📄 Elegir archivo
            <input type="file" accept=".xlsx,.xls,.csv" onChange={importar} style={{ display: 'none' }} />
          </label>
          <Button variant="secondary" onClick={generarEmbeddings}>🧠 Generar embeddings</Button>
        </div>
        <p style={{ ...muted, fontSize: '0.75rem', color: T.faint, margin: '6px 0 0' }}>
          "Generar embeddings" alimenta la búsqueda inteligente por voz/foto. Corrélo después de importar productos nuevos.
        </p>
        {embEstado && (
          <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '8px 0 0', color: embEstado.total > 0 && embEstado.sin === 0 ? '#16a34a' : T.muted }}>
            🧠 Embeddings: {embEstado.con}/{embEstado.total}
            {embEstado.total === 0 ? ' (todavía no hay productos)' : embEstado.sin === 0 ? ' ✅ completo' : ` · faltan ${embEstado.sin}`}
          </p>
        )}
        {resultado && <p style={{ fontSize: '0.85rem', color: T.primary, margin: '8px 0 0' }}>{resultado}</p>}
      </Panel>

      <Panel titulo="Cargar stock inicial">
        <p style={muted}>
          Columnas: {COLUMNAS_STOCK.join(', ')}. Se cruza con el catálogo por <code>referencia</code> (o por <code>nombre</code>).
          El stock se carga como ingresos en la sede elegida.
        </p>
        <Select value={stockSede} onChange={(e) => { setStockSede(e.target.value); setStockPend(null); setStockResultado('') }} style={{ marginBottom: 10 }}>
          <option value="">Elegí la sede destino…</option>
          {tiendas.filter((t) => t.activa !== false).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </Select>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={descargarPlantillaStock}>⬇️ Plantilla stock</Button>
          <label style={{ ...fileBtn, opacity: stockSede ? 1 : 0.5, pointerEvents: stockSede ? 'auto' : 'none' }}>
            📄 Elegir archivo
            <input type="file" accept=".xlsx,.xls,.csv" onChange={elegirArchivoStock} style={{ display: 'none' }} disabled={!stockSede} />
          </label>
        </div>
        {stockPend && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, margin: '10px 0 0' }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: T.ink }}>
              Se cargarán {stockPend.filas.length} ítem(s) en {tiendas.find((t) => Number(t.id) === Number(stockSede))?.nombre ?? 'la sede'}.
            </div>
            {stockPend.errores.length > 0 && (
              <p style={{ ...muted, margin: '0 0 8px' }}>{stockPend.errores.length} fila(s) con error se omitirán.</p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={confirmarStock} disabled={stockCargando}>
                {stockCargando ? 'Cargando…' : 'Confirmar carga'}
              </Button>
              <Button variant="secondary" onClick={() => { setStockPend(null); setStockResultado('') }} disabled={stockCargando}>Cancelar</Button>
            </div>
          </div>
        )}
        <p style={{ ...muted, fontSize: '0.75rem', color: T.faint, margin: '6px 0 0' }}>
          Es una carga inicial: si volvés a subir el mismo archivo, suma de nuevo. Usalo una sola vez por sede.
        </p>
        {stockResultado && <p style={{ fontSize: '0.85rem', color: T.primary, margin: '8px 0 0' }}>{stockResultado}</p>}
      </Panel>

      <Panel titulo="Sedes">
        <p style={muted}>Agregá o renombrá tus sucursales. "Desactivar" la oculta de la carga sin borrar el historial.</p>
        <form onSubmit={agregarTienda} style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Input placeholder="Nombre de la sede (ej: Sucursal Centro)" value={tiendaNueva} onChange={(e) => setTiendaNueva(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <Button variant="primary" type="submit">Agregar sede</Button>
        </form>
        <ul style={lista}>
          {tiendas.map((t) => <TiendaRow key={t.id} t={t} onGuardar={guardarTienda} onToggle={toggleTienda} />)}
        </ul>
      </Panel>

      <Panel titulo="Ubicaciones / Secciones">
        <p style={muted}>Elegí una sede y agregá sus secciones (pasillo, estante, zona…). Se usan al ingresar inventario.</p>
        <Select value={secTienda} onChange={(e) => elegirSecTienda(e.target.value)} style={{ marginBottom: 10 }}>
          <option value="">Elegí una sede…</option>
          {tiendas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </Select>
        {secTienda && (
          <>
            <form onSubmit={agregarSeccion} style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <Input placeholder="Nombre de la sección (ej: Pasillo 1)" value={secNombre} onChange={(e) => setSecNombre(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              <Button variant="primary" type="submit">Agregar</Button>
            </form>
            <ul style={lista}>
              {secciones.length
                ? secciones.map((s) => <SeccionEditRow key={s.id} s={s} onGuardar={guardarSeccion} onBorrar={eliminarSeccion} />)
                : <li style={{ color: T.muted, fontSize: '0.85rem' }}>Sin secciones todavía.</li>}
            </ul>
          </>
        )}
      </Panel>

      <Panel titulo={`Usuarios (${usuarios.length})`}>
        <form onSubmit={crearUsuario} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input placeholder="Nombre del vendedor" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
            <Input type="email" required placeholder="Email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })} style={{ flex: 1, minWidth: 120 }}>
              <option value="vendedor">Vendedor</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </Select>
            <Select value={nuevo.tienda_id} onChange={(e) => setNuevo({ ...nuevo, tienda_id: e.target.value })} style={{ flex: 1, minWidth: 120 }}>
              <option value="">Sede (asignar)…</option>
              {tiendas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Select>
            <Button variant="primary" type="submit">Crear usuario</Button>
          </div>
        </form>
        {credNueva && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: T.ink }}>Usuario creado ✅</div>
            <p style={{ ...muted, margin: '0 0 8px' }}>
              Guardá esta contraseña ahora — no se vuelve a mostrar. Pasásela al empleado para que ingrese con su email.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem' }}>{credNueva.email}</span>
              <code style={{ fontFamily: 'monospace', fontSize: 14, background: '#fff', border: `1px solid ${T.line}`, borderRadius: 6, padding: '4px 8px', letterSpacing: '0.05em' }}>{credNueva.password}</code>
              <Button variant="secondary" onClick={() => copiar(credNueva.password)}>Copiar clave</Button>
            </div>
          </div>
        )}
        <p style={{ ...muted, margin: '0 0 6px' }}>Poné un nombre a cada vendedor para identificarlo en los reportes.</p>
        <ul style={lista}>
          {usuarios.map((u) => (
            <UsuarioRow
              key={u.id}
              u={u}
              sedeNombre={tiendas.find((t) => Number(t.id) === Number(u.tienda_id))?.nombre || null}
              onGuardar={guardarNombre}
              onToggleActivo={toggleActivoUsuario}
              onEliminar={eliminarUsuario}
            />
          ))}
        </ul>
      </Panel>

      <Panel titulo="Configuración">
        <form onSubmit={guardarConfig} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <Field label="Rubro"><Input value={config?.rubro ?? ''} disabled style={{ background: '#f1f5f9' }} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <Field label={'Meses para "stock muerto"'}><Input type="number" min="1" value={meses} onChange={(e) => setMeses(e.target.value)} /></Field>
          </div>
          <Button variant="primary" type="submit">Guardar</Button>
        </form>
      </Panel>

      <Panel titulo="Bot de Telegram (reportes)">
        <p style={muted}>
          El bot ahora <strong>solo entrega el reporte del día</strong>. Vinculá tu Telegram una vez
          con el token de admin (comando <code>/start</code>) y después escribí <code>/reporte</code>.
        </p>
        <Field label="Token de administrador (para /start)">
          <div style={{ display: 'flex', gap: 8 }}>
            <Input value={tokens.admin} readOnly onFocus={(e) => e.target.select()} style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }} />
            <Button variant="secondary" onClick={() => copiar(tokens.admin)}>Copiar</Button>
          </div>
        </Field>
        <p style={{ ...muted, fontSize: '0.75rem', color: T.faint, margin: '8px 0 0' }}>
          🔒 No lo compartas: quien tenga este token puede vincularse como admin y ver los reportes.
        </p>
      </Panel>

      <Note>{aviso}</Note>
    </Page>
  )
}

// Valida y normaliza las filas del archivo. Devuelve { filas, errores }.
function validar(rows) {
  const filas = []
  const errores = []
  rows.forEach((r, i) => {
    const nombre = String(r.nombre ?? '').trim()
    if (!nombre) { errores.push(`fila ${i + 2}: sin nombre`); return }
    filas.push({
      nombre,
      unidad_medida: String(r.unidad_medida ?? '').trim() || 'unidad',
      referencia: String(r.referencia ?? '').trim() || null,
    })
  })
  return { filas, errores }
}

// Valida las filas de stock inicial. Requiere referencia o nombre + cantidad > 0.
function validarStock(rows) {
  const filas = []
  const errores = []
  rows.forEach((r, i) => {
    const referencia = String(r.referencia ?? '').trim()
    const nombre = String(r.nombre ?? '').trim()
    if (!referencia && !nombre) { errores.push(`fila ${i + 2}: sin referencia ni nombre`); return }
    const cantidad = Number(r.cantidad)
    if (!Number.isFinite(cantidad) || cantidad <= 0) { errores.push(`fila ${i + 2}: cantidad inválida`); return }
    const costo = r.costo === '' || r.costo == null ? 0 : Number(r.costo)
    if (!Number.isFinite(costo) || costo < 0) { errores.push(`fila ${i + 2}: costo inválido`); return }
    filas.push({ referencia: referencia || null, nombre: nombre || null, cantidad, costo })
  })
  return { filas, errores }
}

// Fila de usuario con nombre editable + activar/desactivar + eliminar.
function UsuarioRow({ u, sedeNombre, onGuardar, onToggleActivo, onEliminar }) {
  const [nombre, setNombre] = useState(u.nombre || '')
  const [confirmar, setConfirmar] = useState(false)
  const cambiado = (nombre.trim() || null) !== (u.nombre || null)
  const activo = u.activo !== false
  return (
    <li style={{ ...fila, opacity: activo ? 1 : 0.6 }}>
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del vendedor" style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
      <span style={{ color: T.muted, fontSize: '0.8rem' }}>{u.email} · {u.rol} · {sedeNombre || 'sin sede'}</span>
      {!activo && <span style={{ fontSize: '0.72rem', color: '#b45309', background: '#fef3c7', padding: '2px 8px', borderRadius: 999 }}>desactivado</span>}
      {cambiado && <Button variant="primary" onClick={() => onGuardar(u.id, nombre)}>Guardar</Button>}
      <Button variant="secondary" onClick={() => onToggleActivo(u.id, !activo)}>{activo ? 'Desactivar' : 'Activar'}</Button>
      {confirmar ? (
        <>
          <Button variant="danger" onClick={() => { setConfirmar(false); onEliminar(u.id) }}>Confirmar</Button>
          <Button variant="secondary" onClick={() => setConfirmar(false)}>Cancelar</Button>
        </>
      ) : (
        <Button variant="danger" onClick={() => setConfirmar(true)}>Eliminar</Button>
      )}
    </li>
  )
}

// Fila de sede con nombre editable + activar/desactivar (soft-delete).
function TiendaRow({ t, onGuardar, onToggle }) {
  const [nombre, setNombre] = useState(t.nombre || '')
  const activa = t.activa !== false
  const cambiado = nombre.trim() && nombre.trim() !== t.nombre
  return (
    <li style={{ ...fila, opacity: activa ? 1 : 0.6 }}>
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
      {!activa && <span style={{ fontSize: '0.72rem', color: '#b45309', background: '#fef3c7', padding: '2px 8px', borderRadius: 999 }}>desactivada</span>}
      {cambiado && <Button variant="primary" onClick={() => onGuardar(t.id, nombre)}>Guardar</Button>}
      <Button variant={activa ? 'secondary' : 'primary'} onClick={() => onToggle(t.id, !activa)}>{activa ? 'Desactivar' : 'Activar'}</Button>
    </li>
  )
}

// Fila de sección con nombre editable + borrar.
function SeccionEditRow({ s, onGuardar, onBorrar }) {
  const [nombre, setNombre] = useState(s.nombre || '')
  const cambiado = nombre.trim() && nombre.trim() !== s.nombre
  return (
    <li style={fila}>
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
      {cambiado && <Button variant="primary" onClick={() => onGuardar(s.id, nombre)}>Guardar</Button>}
      <Button variant="danger" onClick={() => onBorrar(s.id)}>Borrar</Button>
    </li>
  )
}

function Panel({ titulo, children }) {
  return (
    <Card style={{ marginTop: 14 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: '1.02rem', color: T.ink }}>{titulo}</h3>
      {children}
    </Card>
  )
}

const muted = { fontSize: '0.8rem', color: T.muted, margin: '0 0 10px' }
const lista = { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }
const fila = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 10 }
const fileBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 46, padding: '11px 18px', borderRadius: T.radius,
  background: T.primary, color: '#fff', fontWeight: 600, fontSize: '1rem', cursor: 'pointer',
}
