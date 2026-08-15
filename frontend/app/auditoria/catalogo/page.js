'use client'

// Administración (US6): carga de catálogo (Excel/CSV), gestión de usuarios web
// y configuración del tenant. Solo admin.
import { useCallback, useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuditoria } from '../AuditoriaShell'
import { isAdmin } from '../../../lib/auditoria/auth'
import { importarCatalogo, getEmpresaConfig, updateEmpresaConfig } from '../../../lib/auditoria/queries'

const COLUMNAS = ['nombre', 'unidad_medida', 'referencia', 'stock_minimo', 'punto_reorden', 'stock_maximo']

export default function CatalogoPage() {
  const { session } = useAuditoria()
  const [config, setConfig] = useState(null)
  const [meses, setMeses] = useState(6)
  const [usuarios, setUsuarios] = useState([])
  const [resultado, setResultado] = useState('')
  const [nuevo, setNuevo] = useState({ email: '', password: '', rol: 'vendedor', tienda_id: '' })
  const [aviso, setAviso] = useState('')

  const cargarUsuarios = useCallback(async () => {
    const res = await fetch('/api/auditoria/usuarios')
    if (res.ok) setUsuarios((await res.json()).usuarios || [])
  }, [])

  useEffect(() => {
    if (!session || !isAdmin(session.rol)) return
    getEmpresaConfig().then((c) => { setConfig(c); setMeses(c?.meses_stock_muerto ?? 6) }).catch(() => {})
    cargarUsuarios()
  }, [session, cargarUsuarios])

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
      const { insertados, actualizados } = await importarCatalogo({ empresaId: session.empresaId, filas })
      setResultado(
        `Importado: ${insertados} nuevas, ${actualizados} actualizadas` +
        (errores.length ? ` · ${errores.length} fila(s) con error omitidas` : ''),
      )
    } catch {
      setResultado('No se pudo procesar el archivo.')
    } finally {
      e.target.value = ''
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
    const res = await fetch('/api/auditoria/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: nuevo.email,
        password: nuevo.password,
        rol: nuevo.rol,
        tienda_id: nuevo.tienda_id === '' ? null : Number(nuevo.tienda_id),
      }),
    })
    if (res.ok) {
      setNuevo({ email: '', password: '', rol: 'vendedor', tienda_id: '' })
      setAviso('Usuario creado.')
      cargarUsuarios()
    } else {
      const err = await res.json().catch(() => ({}))
      setAviso(`No se pudo crear el usuario (${err.error || res.status}).`)
    }
  }

  if (!session) return <Cont><p>Cargando…</p></Cont>
  if (!isAdmin(session.rol)) return <Cont><p>Solo un administrador puede gestionar catálogo y usuarios.</p></Cont>

  return (
    <Cont>
      <h2 style={{ marginTop: 0 }}>Administración</h2>

      <Seccion titulo="Cargar catálogo (Excel/CSV)">
        <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
          Columnas: {COLUMNAS.join(', ')}. <code>nombre</code> es obligatorio; los umbrales deben ser numéricos.
        </p>
        <label style={botonFile}>
          📄 Elegir archivo
          <input type="file" accept=".xlsx,.xls,.csv" onChange={importar} style={{ display: 'none' }} />
        </label>
        {resultado && <p style={{ fontSize: '0.85rem', color: '#0d9488' }}>{resultado}</p>}
      </Seccion>

      <Seccion titulo="Configuración">
        <form onSubmit={guardarConfig} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={label}>
            Rubro
            <input value={config?.rubro ?? ''} disabled style={{ ...inp, background: '#f1f5f9' }} />
          </label>
          <label style={label}>
            Meses para "stock muerto"
            <input type="number" min="1" value={meses} onChange={(e) => setMeses(e.target.value)} style={inp} />
          </label>
          <button type="submit" style={btnPrimary}>Guardar</button>
        </form>
      </Seccion>

      <Seccion titulo={`Usuarios (${usuarios.length})`}>
        <form onSubmit={crearUsuario} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="email" required placeholder="Email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} style={inp} />
            <input type="password" required placeholder="Contraseña" value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} style={inp} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })} style={inp}>
              <option value="vendedor">Vendedor</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
            <input type="number" placeholder="Sede (id, opcional)" value={nuevo.tienda_id} onChange={(e) => setNuevo({ ...nuevo, tienda_id: e.target.value })} style={inp} />
            <button type="submit" style={btnPrimary}>Crear usuario</button>
          </div>
        </form>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {usuarios.map((u) => (
            <li key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <span>{u.email}</span>
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{u.rol}{u.tienda_id ? ` · sede ${u.tienda_id}` : ''}</span>
            </li>
          ))}
        </ul>
      </Seccion>

      {aviso && <p style={{ marginTop: 12, color: '#0d9488', fontSize: '0.85rem' }}>{aviso}</p>}
    </Cont>
  )
}

// Valida y normaliza las filas del archivo. Devuelve { filas, errores }.
function validar(rows) {
  const filas = []
  const errores = []
  rows.forEach((r, i) => {
    const nombre = String(r.nombre ?? '').trim()
    if (!nombre) { errores.push(`fila ${i + 2}: sin nombre`); return }
    const num = (v, def) => {
      if (v === '' || v == null) return def
      const n = Number(v)
      return Number.isFinite(n) ? n : NaN
    }
    const stock_minimo = num(r.stock_minimo, 5)
    const punto_reorden = num(r.punto_reorden, 0)
    const stock_maximo = r.stock_maximo === '' || r.stock_maximo == null ? null : num(r.stock_maximo, null)
    if ([stock_minimo, punto_reorden].some((n) => Number.isNaN(n)) || Number.isNaN(stock_maximo)) {
      errores.push(`fila ${i + 2}: umbral no numérico`); return
    }
    filas.push({
      nombre,
      unidad_medida: String(r.unidad_medida ?? '').trim() || 'unidad',
      referencia: String(r.referencia ?? '').trim() || null,
      stock_minimo,
      punto_reorden,
      stock_maximo,
    })
  })
  return { filas, errores }
}

function Cont({ children }) {
  return <main style={{ padding: 16, maxWidth: 680, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>{children}</main>
}
function Seccion({ titulo, children }) {
  return (
    <section style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: 8 }}>{titulo}</h3>
      {children}
    </section>
  )
}

const inp = { padding: '9px 11px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: '0.95rem' }
const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#334155' }
const btnPrimary = { padding: '9px 16px', border: 'none', borderRadius: 8, background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 600 }
const botonFile = { display: 'inline-block', padding: '10px 16px', background: '#0d9488', color: '#fff', borderRadius: 10, cursor: 'pointer', fontWeight: 600 }
