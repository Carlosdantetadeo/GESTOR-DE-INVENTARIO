'use client'

import { useState } from 'react'
import { Plus, Trash2, ChevronUp, Zap, CheckCircle, XCircle, Loader, X, ArrowRightLeft, AlertTriangle, DollarSign } from 'lucide-react'

const PROVEEDORES = ['groq', 'anthropic', 'openrouter', 'openai-compat']

const TIPOS_HOSTING = [
  { value: 'cloud',       label: 'Nube',        desc: 'Proveedor SaaS (Groq, Anthropic, OpenRouter, Huawei MaaS, etc.)' },
  { value: 'local',       label: 'Local',        desc: 'Máquina del usuario (Ollama, LM Studio, llama.cpp). La API key suele ser opcional.' },
  { value: 'self_hosted', label: 'Self-hosted',  desc: 'Infraestructura propia del cliente (vLLM, TGI en servidor dedicado).' },
]

const ROLES = [
  { value: 'clasificacion', label: 'Clasificación',  desc: 'Detectar intención del usuario. Modelo barato (8B).' },
  { value: 'extraccion',    label: 'Extracción',     desc: 'Extraer entidades / JSON estructurado. Modelo barato (8B).' },
  { value: 'conversacion',  label: 'Conversación',   desc: 'Generar la respuesta final al usuario. Requiere mayor calidad.' },
  { value: 'razonamiento',  label: 'Razonamiento',   desc: 'Decisiones complejas (escalar a humano, validaciones). Modelo potente.' },
  { value: 'embeddings',    label: 'Embeddings',     desc: 'Vectorización de texto para búsqueda semántica.' },
]

const HOSTING_BADGES = {
  cloud:       { label: 'Nube',        bg: 'hsl(var(--text-muted) / 0.15)',  color: 'hsl(var(--text-muted))' },
  local:       { label: 'Local',       bg: 'hsl(210 80% 55% / 0.15)',        color: 'hsl(210 80% 45%)' },
  self_hosted: { label: 'Self-hosted', bg: 'hsl(270 60% 55% / 0.15)',        color: 'hsl(270 60% 45%)' },
}

const ESTADO_BADGES = {
  activo:    { label: 'Activo',    bg: 'hsl(142 70% 40% / 0.15)', color: 'hsl(142 70% 35%)' },
  inactivo:  { label: 'Inactivo',  bg: 'hsl(var(--text-muted) / 0.15)', color: 'hsl(var(--text-muted))' },
  deprecado: { label: 'Deprecado', bg: 'hsl(38 90% 50% / 0.15)', color: 'hsl(38 90% 40%)' },
}

const th = { padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--text-muted))', fontSize: '0.72rem', whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', fontSize: '0.82rem', whiteSpace: 'nowrap' }
const hint = { margin: '3px 0 0', fontSize: '0.72rem', color: 'hsl(var(--text-muted))', fontWeight: 400 }
const errInline = { margin: '3px 0 0', fontSize: '0.72rem', color: 'hsl(var(--color-gasto))', fontWeight: 400 }

const SPIN_STYLE = `@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`

// costo_in / costo_out en el form están en USD por 1M tokens (lo que publican los proveedores).
// Se convierten a USD por token antes de enviar al servidor.
const VACIO = { id: '', label: '', proveedor: 'openrouter', api_model_id: '', base_url: '', costo_in: '', costo_out: '', badge: '', api_key: '', tipo_hosting: 'cloud', rol: 'conversacion', fuente: '' }

const PRECIO_VACIO = { costo_in: '', costo_out: '', fuente: '' }

function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function validarApiModelId(val) {
  const v = String(val || '').trim()
  if (!v) return 'El API model id es obligatorio.'
  if (v.includes('@')) return 'No puede contener "@" — revisa que no sea un email.'
  if (/\s/.test(v)) return 'No puede contener espacios.'
  return ''
}

function formatCosto(v) {
  const n = Number(v)
  if (!n) return '—'
  return `$${(n * 1_000_000).toFixed(2)} / 1M`
}

const MS_90_DIAS = 90 * 24 * 60 * 60 * 1000

function precioVencido(iso) {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() > MS_90_DIAS
}

function formatFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ModelosManager({ inicial }) {
  const [modelos, setModelos]           = useState(inicial)
  const [form, setForm]                 = useState(VACIO)
  const [formAbierto, setFormAbierto]   = useState(false)
  const [saving, setSaving]             = useState(false)
  const [testing, setTesting]           = useState(false)
  const [testingRowId, setTestingRowId] = useState(null)
  const [testResult, setTestResult]     = useState(null)
  const [errorForm, setErrorForm]       = useState('')
  const [errApiId, setErrApiId]         = useState('')
  const [busyId, setBusyId]             = useState(null)

  // Phase 3
  const [tab, setTab]                   = useState('modelos')
  const [editPrecio, setEditPrecio]     = useState(null) // { modelo, form: { costo_in, costo_out, fuente } }
  const [savingPrecio, setSavingPrecio] = useState(false)
  const [auditLog, setAuditLog]         = useState(null)
  const [cargandoAudit, setCargandoAudit] = useState(false)
  const [panelEmpresas, setPanelEmpresas] = useState(null) // { modeloId, label, empresas }
  const [cargandoPanel, setCargandoPanel] = useState(false)
  const [migraDestino, setMigraDestino] = useState('')
  const [migrando, setMigrando]         = useState(false)
  const [msgMigra, setMsgMigra]         = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // { modelo, texto }

  const refrescar = async () => {
    const res = await fetch('/api/superadmin/modelos')
    const data = await res.json().catch(() => ({}))
    if (data.ok) setModelos(data.modelos)
  }

  const testKey = (f) => `${f.proveedor}|${f.api_model_id.trim()}`

  const set = (k) => (e) => {
    setForm(f => {
      const next = { ...f, [k]: e.target.value }
      if (k === 'proveedor' || k === 'api_model_id') setTestResult(null)
      return next
    })
    if (k === 'api_model_id') setErrApiId('')
  }

  const probarConexion = async () => {
    const apiErr = validarApiModelId(form.api_model_id)
    if (apiErr) { setErrApiId(apiErr); return }
    setTesting(true); setTestResult(null); setErrorForm('')
    try {
      const res = await fetch('/api/superadmin/modelos/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedor: form.proveedor,
          api_model_id: form.api_model_id.trim(),
          api_key: form.api_key.trim() || undefined,
          base_url: form.base_url.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      setTestResult({ ...data, validFor: testKey(form) })
    } catch {
      setTestResult({ ok: false, error: 'Error de conexión.', validFor: testKey(form) })
    } finally {
      setTesting(false)
    }
  }

  const probarFila = async (m) => {
    setTestingRowId(m.id)
    try {
      const res = await fetch('/api/superadmin/modelos/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proveedor: m.proveedor, api_model_id: m.api_model_id, base_url: m.base_url || undefined, modelo_id: m.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.ok) await refrescar()
      else setErrorForm(`Prueba fallida para "${m.label}": ${data.error || 'Error desconocido.'}`)
    } finally {
      setTestingRowId(null)
    }
  }

  const crear = async (e) => {
    e.preventDefault()
    const apiErr = validarApiModelId(form.api_model_id)
    if (apiErr) { setErrApiId(apiErr); return }
    const testValido = testResult?.ok && testResult.validFor === testKey(form)
    if (!testValido) { setErrorForm('Prueba la conexión antes de guardar el modelo.'); return }
    const slug = slugify(form.id || form.label)
    if (modelos.some(m => m.id.toLowerCase() === slug.toLowerCase())) {
      setErrorForm(`Ya existe un modelo con el id "${slug}". Usá otro en el campo ID interno.`)
      return
    }
    setSaving(true); setErrorForm('')
    // Convertir costos de USD/1M a USD/token antes de enviar.
    const payload = {
      ...form,
      api_model_id: form.api_model_id.trim(),
      costo_in:  (parseFloat(form.costo_in)  || 0) / 1_000_000,
      costo_out: (parseFloat(form.costo_out) || 0) / 1_000_000,
    }
    try {
      const res = await fetch('/api/superadmin/modelos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) { setForm(VACIO); setFormAbierto(false); setTestResult(null); await refrescar() }
      else setErrorForm(data.message || 'No se pudo crear.')
    } catch {
      setErrorForm('Error de conexión.')
    } finally {
      setSaving(false)
    }
  }

  const cambiarEstado = async (m, nuevoEstado) => {
    if (nuevoEstado === m.estado) return
    setBusyId(m.id); setErrorForm('')
    try {
      const res = await fetch(`/api/superadmin/modelos/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: nuevoEstado }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) await refrescar()
      else setErrorForm(data.message || 'No se pudo actualizar.')
    } finally {
      setBusyId(null)
    }
  }

  const eliminar = (m) => setConfirmDelete({ modelo: m, texto: '' })

  const confirmarEliminar = async () => {
    const m = confirmDelete.modelo
    setConfirmDelete(cd => ({ ...cd, texto: cd.texto })) // keep modal open while loading
    setBusyId(m.id); setErrorForm('')
    try {
      const res = await fetch(`/api/superadmin/modelos/${m.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) { setConfirmDelete(null); await refrescar() }
      else { setErrorForm(data.message || 'No se pudo eliminar.'); setConfirmDelete(null) }
    } finally {
      setBusyId(null)
    }
  }

  const abrirPanelEmpresas = async (m) => {
    setCargandoPanel(true)
    setPanelEmpresas({ modeloId: m.id, label: m.label, empresas: null })
    setMigraDestino(''); setMsgMigra('')
    try {
      const res = await fetch(`/api/superadmin/modelos/${m.id}/empresas`)
      const data = await res.json().catch(() => ({}))
      setPanelEmpresas(p => ({ ...p, empresas: data.empresas ?? [] }))
    } finally {
      setCargandoPanel(false)
    }
  }

  const ejecutarMigracion = async () => {
    if (!migraDestino || !panelEmpresas) return
    setMigrando(true); setMsgMigra('')
    try {
      const res = await fetch('/api/superadmin/modelos/migrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: panelEmpresas.modeloId, to: migraDestino }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setMsgMigra(`✓ ${data.empresas} empresa(s) migradas.`)
        await refrescar()
        const res2 = await fetch(`/api/superadmin/modelos/${panelEmpresas.modeloId}/empresas`)
        const d2 = await res2.json().catch(() => ({}))
        setPanelEmpresas(p => ({ ...p, empresas: d2.empresas ?? [] }))
      } else {
        setMsgMigra(`Error: ${data.message || 'No se pudo migrar.'}`)
      }
    } finally {
      setMigrando(false)
    }
  }

  const cargarAuditLog = async () => {
    setCargandoAudit(true)
    try {
      const res = await fetch('/api/superadmin/modelos/auditoria')
      const data = await res.json().catch(() => ({}))
      setAuditLog(data.log ?? [])
    } finally {
      setCargandoAudit(false)
    }
  }

  const abrirTab = (t) => {
    setTab(t)
    if (t === 'auditoria' && auditLog === null) cargarAuditLog()
  }

  const guardarPrecio = async () => {
    if (!editPrecio) return
    setSavingPrecio(true)
    try {
      const ci = (parseFloat(editPrecio.form.costo_in)  || 0) / 1_000_000
      const co = (parseFloat(editPrecio.form.costo_out) || 0) / 1_000_000
      const res = await fetch(`/api/superadmin/modelos/${editPrecio.modelo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costo_in: ci, costo_out: co, fuente: editPrecio.form.fuente.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) { setEditPrecio(null); await refrescar() }
      else setErrorForm(data.message || 'No se pudo actualizar el precio.')
    } finally {
      setSavingPrecio(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <style>{SPIN_STYLE}</style>

      {/* Modal de confirmación de eliminación */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-card" style={{ maxWidth: '420px', width: '90%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'hsl(var(--color-gasto))' }}>
              ¿Eliminar "{confirmDelete.modelo.label}"?
            </div>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'hsl(var(--text-secondary))' }}>
              Esta acción es irreversible. Escribe el id del modelo (<code style={{ fontFamily: 'var(--font-mono)', background: 'hsl(var(--bg-base))', padding: '1px 5px', borderRadius: '4px' }}>{confirmDelete.modelo.id}</code>) para confirmar.
            </p>
            <input
              className="input-field"
              autoFocus
              value={confirmDelete.texto}
              onChange={e => setConfirmDelete(cd => ({ ...cd, texto: e.target.value }))}
              placeholder={confirmDelete.modelo.id}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button
                className="btn btn-primary"
                style={{ background: 'hsl(var(--color-gasto))', borderColor: 'hsl(var(--color-gasto))' }}
                disabled={confirmDelete.texto !== confirmDelete.modelo.id || busyId === confirmDelete.modelo.id}
                onClick={confirmarEliminar}
              >
                {busyId === confirmDelete?.modelo.id ? 'Eliminando…' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de actualización de precio */}
      {editPrecio && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-card" style={{ maxWidth: '380px', width: '90%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
              Actualizar precio — {editPrecio.modelo.label}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Campo label="Entrada (USD / 1M tokens)">
                <input className="input-field" type="number" step="0.01" min="0" autoFocus
                  value={editPrecio.form.costo_in}
                  onChange={e => setEditPrecio(ep => ({ ...ep, form: { ...ep.form, costo_in: e.target.value } }))}
                />
                <p style={hint}>Ej: 0.59</p>
              </Campo>
              <Campo label="Salida (USD / 1M tokens)">
                <input className="input-field" type="number" step="0.01" min="0"
                  value={editPrecio.form.costo_out}
                  onChange={e => setEditPrecio(ep => ({ ...ep, form: { ...ep.form, costo_out: e.target.value } }))}
                />
                <p style={hint}>Ej: 0.79</p>
              </Campo>
            </div>
            <Campo label="Fuente (URL o nota, opcional)">
              <input className="input-field" placeholder="https://groq.com/pricing"
                value={editPrecio.form.fuente}
                onChange={e => setEditPrecio(ep => ({ ...ep, form: { ...ep.form, fuente: e.target.value } }))}
              />
            </Campo>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditPrecio(null)}>Cancelar</button>
              <button
                className="btn btn-primary"
                disabled={savingPrecio || (!editPrecio.form.costo_in && !editPrecio.form.costo_out)}
                onClick={guardarPrecio}
                style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
              >
                {savingPrecio ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <DollarSign size={13} />}
                {savingPrecio ? 'Guardando…' : 'Guardar precio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel lateral de empresas */}
      {panelEmpresas && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(400px, 100vw)', background: 'hsl(var(--bg-card))', borderLeft: '1px solid hsl(var(--border))', zIndex: 998, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Empresas asignadas</div>
              <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>{panelEmpresas.label}</div>
            </div>
            <button className="btn btn-secondary" style={{ padding: '5px 8px' }} onClick={() => setPanelEmpresas(null)}>
              <X size={14} />
            </button>
          </div>

          {cargandoPanel ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
              <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : panelEmpresas.empresas?.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))' }}>Ninguna empresa usa este modelo.</p>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {(panelEmpresas.empresas ?? []).map(e => (
                <div key={e.id} style={{ padding: '8px 10px', borderRadius: '8px', background: 'hsl(var(--bg-base))', fontSize: '0.82rem' }}>
                  <span style={{ fontWeight: 600 }}>{e.nombre}</span>
                  {e.rubro && <span style={{ marginLeft: '8px', color: 'hsl(var(--text-muted))' }}>{e.rubro}</span>}
                  {!e.activa && <span style={{ marginLeft: '8px', fontSize: '0.68rem', color: 'hsl(var(--color-gasto))' }}>suspendida</span>}
                </div>
              ))}
            </div>
          )}

          {/* Migración */}
          {(panelEmpresas.empresas?.length ?? 0) > 0 && (
            <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: '14px', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ArrowRightLeft size={13} /> Migrar todas al modelo
              </div>
              <select
                className="input-field"
                value={migraDestino}
                onChange={e => { setMigraDestino(e.target.value); setMsgMigra('') }}
                style={{ fontSize: '0.8rem' }}
              >
                <option value="">— seleccionar destino —</option>
                {modelos.filter(m => m.id !== panelEmpresas.modeloId && m.estado !== 'deprecado').map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                disabled={!migraDestino || migrando}
                onClick={ejecutarMigracion}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
              >
                {migrando ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRightLeft size={13} />}
                {migrando ? 'Migrando…' : 'Confirmar migración'}
              </button>
              {msgMigra && (
                <span style={{ fontSize: '0.78rem', color: msgMigra.startsWith('✓') ? 'hsl(142 70% 40%)' : 'hsl(var(--color-gasto))' }}>
                  {msgMigra}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Botón agregar */}
      <div>
        <button
          type="button"
          onClick={() => { setFormAbierto(v => !v); setErrorForm(''); setErrApiId('') }}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 18px' }}
        >
          {formAbierto ? <ChevronUp size={15} /> : <Plus size={15} />}
          {formAbierto ? 'Cerrar formulario' : 'Agregar modelo'}
        </button>
      </div>

      {/* Formulario colapsable */}
      {formAbierto && (
        <form
          onSubmit={crear}
          autoComplete="off"
          className="glass-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Nuevo modelo</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>

            <Campo label="Nombre visible">
              <input className="input-field" name="nlu_model_label" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.label} onChange={set('label')} required />
              <p style={hint}>Ej: DeepSeek V3</p>
            </Campo>

            <Campo label="Proveedor">
              <select className="input-field" value={form.proveedor} onChange={set('proveedor')}>
                {PROVEEDORES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Campo>

            <Campo label="Tipo de alojamiento">
              <select className="input-field" value={form.tipo_hosting} onChange={set('tipo_hosting')}>
                {TIPOS_HOSTING.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <p style={hint}>{TIPOS_HOSTING.find(t => t.value === form.tipo_hosting)?.desc}</p>
            </Campo>

            <Campo label="Rol del modelo">
              <select className="input-field" value={form.rol} onChange={set('rol')}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <p style={hint}>{ROLES.find(r => r.value === form.rol)?.desc}</p>
            </Campo>

            <Campo label="API model id">
              <input className="input-field" name="nlu_model_api_id" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.api_model_id} onChange={set('api_model_id')} required />
              {errApiId
                ? <p style={errInline}>⚠️ {errApiId}</p>
                : <p style={hint}>Ej: deepseek/deepseek-chat</p>
              }
            </Campo>

            {(form.tipo_hosting !== 'cloud' || form.proveedor === 'openai-compat') && (
              <Campo label="Base URL">
                <input className="input-field" name="nlu_model_base_url" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.base_url} onChange={set('base_url')} required={form.proveedor === 'openai-compat' || form.tipo_hosting !== 'cloud'} />
                {form.tipo_hosting === 'local'
                  ? <p style={hint}>Ej: http://localhost:11434/v1 (Ollama)<br />
                      <span style={{ color: 'hsl(var(--color-gasto))' }}>⚠️ Vercel no puede alcanzar localhost. Usá un túnel (Cloudflare Tunnel, Tailscale).</span>
                    </p>
                  : <p style={hint}>Ej: https://…/v1 (endpoint OpenAI-compatible)</p>
                }
              </Campo>
            )}

            <Campo label="ID interno (opcional)">
              <input className="input-field" name="nlu_model_slug" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.id} onChange={set('id')} />
              <p style={hint}>Se genera del nombre si se deja vacío.</p>
            </Campo>

            <Campo label="Costo entrada (USD / 1M tokens)">
              <input className="input-field" type="number" name="nlu_model_costo_in" autoComplete="off" step="0.01" min="0" value={form.costo_in} onChange={set('costo_in')} />
              <p style={hint}>Ej: 0.59 (Groq Llama 3.3)</p>
            </Campo>

            <Campo label="Costo salida (USD / 1M tokens)">
              <input className="input-field" type="number" name="nlu_model_costo_out" autoComplete="off" step="0.01" min="0" value={form.costo_out} onChange={set('costo_out')} />
              <p style={hint}>Ej: 0.79 (Groq Llama 3.3)</p>
            </Campo>

            <Campo label="Fuente del precio (URL o nota, opcional)">
              <input className="input-field" name="nlu_model_fuente" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.fuente} onChange={set('fuente')} />
              <p style={hint}>Ej: https://groq.com/pricing</p>
            </Campo>

            <Campo label="Badge (opcional)">
              <input className="input-field" name="nlu_model_badge" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.badge} onChange={set('badge')} />
              <p style={hint}>Ej: Recomendado, Económico, Premium</p>
            </Campo>

            <Campo label="API key (opcional)">
              <input className="input-field" type="password" name="nlu_model_secret" autoComplete="new-password" data-1p-ignore value={form.api_key} onChange={set('api_key')} />
              {form.tipo_hosting === 'local'
                ? <p style={hint}>Ollama no exige API key. Podés dejarlo vacío.</p>
                : <p style={hint}>Se guarda cifrada. Vacío = usa la key global del proveedor.</p>
              }
            </Campo>

          </div>

          {errorForm && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {errorForm}</span>}

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={probarConexion}
              disabled={testing || !form.api_model_id.trim()}
              className="btn btn-secondary"
              style={{ padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '7px' }}
            >
              {testing ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={14} />}
              {testing ? 'Probando…' : 'Probar conexión'}
            </button>

            {testResult && (
              testResult.ok && testResult.validFor === testKey(form)
                ? <span style={{ fontSize: '0.82rem', color: 'hsl(142 70% 40%)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <CheckCircle size={14} /> Conexión OK · {testResult.latencia_ms} ms
                    {testResult.modelo_confirmado && <span style={{ color: 'hsl(var(--text-muted))' }}>({testResult.modelo_confirmado})</span>}
                  </span>
                : <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <XCircle size={14} /> {testResult.error || 'Falló la conexión.'}
                  </span>
            )}

            <button
              type="submit"
              disabled={saving || !(testResult?.ok && testResult.validFor === testKey(form))}
              className="btn btn-primary"
              style={{ padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
              title={!(testResult?.ok && testResult.validFor === testKey(form)) ? 'Prueba la conexión antes de guardar' : ''}
            >
              <Plus size={15} /> {saving ? 'Agregando…' : 'Agregar modelo'}
            </button>
          </div>
        </form>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid hsl(var(--border))', paddingBottom: '0' }}>
        {[{ key: 'modelos', label: 'Modelos' }, { key: 'auditoria', label: 'Auditoría' }].map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => abrirTab(t.key)}
            className="btn btn-secondary"
            style={{
              borderBottom: tab === t.key ? '2px solid hsl(var(--color-ingreso))' : '2px solid transparent',
              borderRadius: '6px 6px 0 0',
              padding: '7px 16px',
              fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))',
              fontSize: '0.83rem',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Modelos */}
      {tab === 'modelos' && (
        <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
          {errorForm && (
            <div style={{ padding: '10px 16px', fontSize: '0.82rem', color: 'hsl(var(--color-gasto))', borderBottom: '1px solid hsl(var(--border))' }}>
              ⚠️ {errorForm}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-base))' }}>
                <th style={th}>Modelo</th>
                <th style={th}>Proveedor</th>
                <th style={th}>Alojamiento</th>
                <th style={th}>Rol</th>
                <th style={th}>API model id</th>
                <th style={th}>API key</th>
                <th style={th}>Costo entrada</th>
                <th style={th}>Costo salida</th>
                <th style={th}>Precio desde</th>
                <th style={th}>Estado</th>
                <th style={th}>Última prueba</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {modelos.length === 0 ? (
                <tr><td style={{ ...td, textAlign: 'center', padding: '28px' }} colSpan={12}>Sin modelos.</td></tr>
              ) : modelos.map((m, i) => {
                const hostingBadge = HOSTING_BADGES[m.tipo_hosting] ?? HOSTING_BADGES.cloud
                const estadoBadge  = ESTADO_BADGES[m.estado] ?? ESTADO_BADGES.inactivo
                const rolLabel     = ROLES.find(r => r.value === m.rol)?.label ?? m.rol
                return (
                  <tr key={m.id} style={{ borderBottom: i < modelos.length - 1 ? '1px solid hsl(var(--border))' : 'none', opacity: m.estado === 'activo' ? 1 : 0.6 }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {m.label}
                      {m.badge && (
                        <span style={{ marginLeft: '8px', fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', background: 'hsl(var(--bg-base))', color: 'hsl(var(--text-secondary))' }}>
                          {m.badge}
                        </span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', fontFamily: 'var(--font-mono)' }}>{m.id}</span>
                        {m.empresas_count > 0 && (
                          <button
                            type="button"
                            onClick={() => abrirPanelEmpresas(m)}
                            style={{ fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: '99px', background: 'hsl(210 80% 55% / 0.15)', color: 'hsl(210 80% 45%)', border: 'none', cursor: 'pointer' }}
                          >
                            Empresas: {m.empresas_count}
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={td}>{m.proveedor}</td>
                    <td style={td}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: hostingBadge.bg, color: hostingBadge.color }}>
                        {hostingBadge.label}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: '0.78rem', color: 'hsl(var(--text-secondary))' }}>{rolLabel}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{m.api_model_id}</td>
                    <td style={td}>{m.tiene_api_key ? '🔑 Propia' : '— global'}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{formatCosto(m.costo_in)}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{formatCosto(m.costo_out)}</td>
                    <td style={{ ...td, fontSize: '0.75rem', color: 'hsl(var(--text-muted))', whiteSpace: 'nowrap' }}>
                      {m.precio_vigente_desde ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          {new Date(m.precio_vigente_desde).toLocaleDateString('es-PE')}
                          {precioVencido(m.precio_vigente_desde) && (
                            <span title="Precio sin verificar hace más de 90 días" style={{ color: 'hsl(38 90% 45%)', cursor: 'help', display: 'flex' }}>
                              <AlertTriangle size={12} />
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: estadoBadge.bg, color: estadoBadge.color }}>
                        {estadoBadge.label}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                      {m.ultima_prueba_at
                        ? <span title={new Date(m.ultima_prueba_at).toLocaleString('es-PE')}>
                            {m.ultima_prueba_latencia_ms} ms · {new Date(m.ultima_prueba_at).toLocaleDateString('es-PE')}
                          </span>
                        : '—'
                      }
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => setEditPrecio({ modelo: m, form: { costo_in: (m.costo_in * 1_000_000).toFixed(2), costo_out: (m.costo_out * 1_000_000).toFixed(2), fuente: m.precio_fuente || '' } })}
                        title="Actualizar precio"
                        className="btn btn-secondary"
                        style={{ padding: '5px 10px', marginRight: '4px', color: precioVencido(m.precio_vigente_desde) ? 'hsl(38 90% 45%)' : undefined }}
                      >
                        <DollarSign size={12} />
                      </button>
                      <button
                        onClick={() => probarFila(m)}
                        disabled={testingRowId === m.id}
                        title="Probar conexión"
                        className="btn btn-secondary"
                        style={{ padding: '5px 10px', marginRight: '4px' }}
                      >
                        {testingRowId === m.id
                          ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
                          : <Zap size={12} />
                        }
                      </button>
                      <select
                        value={m.estado}
                        onChange={e => cambiarEstado(m, e.target.value)}
                        disabled={busyId === m.id}
                        title="Cambiar estado"
                        className="input-field"
                        style={{ padding: '4px 6px', fontSize: '0.72rem', width: 'auto', display: 'inline-block', marginRight: '4px', cursor: 'pointer' }}
                      >
                        <option value="activo">Activo</option>
                        <option value="inactivo">Inactivo</option>
                        <option value="deprecado">Deprecado</option>
                      </select>
                      <button
                        onClick={() => eliminar(m)}
                        disabled={busyId === m.id}
                        title="Eliminar"
                        className="btn btn-secondary"
                        style={{ padding: '5px 10px', color: 'hsl(var(--color-gasto))' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab Auditoría */}
      {tab === 'auditoria' && (
        <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
          {cargandoAudit ? (
            <div style={{ padding: '28px', display: 'flex', justifyContent: 'center' }}>
              <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : !auditLog?.length ? (
            <div style={{ padding: '28px', textAlign: 'center', fontSize: '0.85rem', color: 'hsl(var(--text-muted))' }}>Sin eventos registrados.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-base))' }}>
                  <th style={th}>Fecha</th>
                  <th style={th}>Acción</th>
                  <th style={th}>Modelo</th>
                  <th style={th}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((ev, i) => (
                  <tr key={ev.id} style={{ borderBottom: i < auditLog.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}>
                    <td style={{ ...td, fontSize: '0.75rem', color: 'hsl(var(--text-muted))', whiteSpace: 'nowrap' }}>{formatFecha(ev.created_at)}</td>
                    <td style={{ ...td, fontWeight: 600, fontSize: '0.78rem' }}>{ev.accion}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>{ev.modelo_id ?? '—'}</td>
                    <td style={{ ...td, fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                      {ev.payload ? JSON.stringify(ev.payload) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function Campo({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.78rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>
      {label}
      {children}
    </label>
  )
}
