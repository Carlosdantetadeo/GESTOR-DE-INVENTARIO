'use client'

import { useState } from 'react'
import { Plus, Trash2, Power, ChevronDown, ChevronUp, Zap, CheckCircle, XCircle, Loader } from 'lucide-react'

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

const th = { padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--text-muted))', fontSize: '0.72rem', whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', fontSize: '0.82rem', whiteSpace: 'nowrap' }
const hint = { margin: '3px 0 0', fontSize: '0.72rem', color: 'hsl(var(--text-muted))', fontWeight: 400 }
const errInline = { margin: '3px 0 0', fontSize: '0.72rem', color: 'hsl(var(--color-gasto))', fontWeight: 400 }

const SPIN_STYLE = `@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`

const VACIO = { id: '', label: '', proveedor: 'openrouter', api_model_id: '', base_url: '', costo_in: '', costo_out: '', badge: '', api_key: '', tipo_hosting: 'cloud', rol: 'conversacion' }

function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function validarApiModelId(val) {
  const v = String(val || '').trim()
  if (!v) return 'El API model id es obligatorio.'
  if (v.includes('@')) return 'No puede contener "@" — revisá que no sea un email.'
  if (/\s/.test(v)) return 'No puede contener espacios.'
  return ''
}

function formatCosto(v) {
  const n = Number(v)
  if (!n) return '—'
  // Mostrar en USD por 1M tokens para que sea legible
  return `$${(n * 1_000_000).toFixed(4)} / 1M`
}

export default function ModelosManager({ inicial }) {
  const [modelos, setModelos]         = useState(inicial)
  const [form, setForm]               = useState(VACIO)
  const [formAbierto, setFormAbierto] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [testing, setTesting]         = useState(false)   // prueba en el form
  const [testingRowId, setTestingRowId] = useState(null)  // prueba en la tabla
  const [testResult, setTestResult]   = useState(null)    // { ok, latencia_ms, error, validFor }
  const [errorForm, setErrorForm]     = useState('')
  const [errApiId, setErrApiId]       = useState('')
  const [busyId, setBusyId]           = useState(null)

  const refrescar = async () => {
    const res = await fetch('/api/superadmin/modelos')
    const data = await res.json().catch(() => ({}))
    if (data.ok) setModelos(data.modelos)
  }

  // Clave que identifica la combinación que fue probada. Si proveedor o api_model_id
  // cambian, el resultado anterior ya no es válido.
  const testKey = (f) => `${f.proveedor}|${f.api_model_id.trim()}`

  const set = (k) => (e) => {
    setForm(f => {
      const next = { ...f, [k]: e.target.value }
      // Invalida el resultado de prueba si cambia proveedor o api_model_id.
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

    // Verificar que la prueba de conexión fue exitosa para esta combinación
    const testValido = testResult?.ok && testResult.validFor === testKey(form)
    if (!testValido) {
      setErrorForm('Probá la conexión antes de guardar el modelo.')
      return
    }

    // Verificar unicidad del slug en cliente antes de llamar al servidor
    const slug = slugify(form.id || form.label)
    if (modelos.some(m => m.id.toLowerCase() === slug.toLowerCase())) {
      setErrorForm(`Ya existe un modelo con el id "${slug}". Podés usar "${slug}-2" en el campo ID interno.`)
      return
    }

    setSaving(true); setErrorForm('')
    try {
      const res = await fetch('/api/superadmin/modelos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, api_model_id: form.api_model_id.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setForm(VACIO)
        setFormAbierto(false)
        await refrescar()
      } else {
        setErrorForm(data.message || 'No se pudo crear.')
      }
    } catch {
      setErrorForm('Error de conexión.')
    } finally {
      setSaving(false)
    }
  }

  const togglear = async (m) => {
    setBusyId(m.id); setErrorForm('')
    try {
      const res = await fetch(`/api/superadmin/modelos/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !m.activo }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) await refrescar()
      else setErrorForm(data.message || 'No se pudo actualizar.')
    } finally {
      setBusyId(null)
    }
  }

  const eliminar = async (m) => {
    if (!confirm(`¿Eliminar el modelo "${m.label}"?`)) return
    setBusyId(m.id); setErrorForm('')
    try {
      const res = await fetch(`/api/superadmin/modelos/${m.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) await refrescar()
      else setErrorForm(data.message || 'No se pudo eliminar.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <style>{SPIN_STYLE}</style>

      {/* Botón para abrir/cerrar el formulario */}
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
              <input
                className="input-field"
                name="nlu_model_label"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={form.label}
                onChange={set('label')}
                required
              />
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
              <input
                className="input-field"
                name="nlu_model_api_id"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={form.api_model_id}
                onChange={set('api_model_id')}
                required
              />
              {errApiId
                ? <p style={errInline}>⚠️ {errApiId}</p>
                : <p style={hint}>Ej: deepseek/deepseek-chat</p>
              }
            </Campo>

            {(form.tipo_hosting !== 'cloud' || form.proveedor === 'openai-compat') && (
              <Campo label="Base URL">
                <input
                  className="input-field"
                  name="nlu_model_base_url"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  value={form.base_url}
                  onChange={set('base_url')}
                  required={form.proveedor === 'openai-compat' || form.tipo_hosting !== 'cloud'}
                />
                {form.tipo_hosting === 'local'
                  ? <p style={hint}>Ej: http://localhost:11434/v1 (Ollama) · http://localhost:1234/v1 (LM Studio)<br />
                      <span style={{ color: 'hsl(var(--color-gasto))' }}>⚠️ El backend corre en Vercel y no puede alcanzar localhost ni IPs 192.168.x.x. Para modelos locales, el backend debe estar en la misma red o el endpoint expuesto por túnel (Cloudflare Tunnel, Tailscale).</span>
                    </p>
                  : <p style={hint}>Ej: https://…/v1 (endpoint OpenAI-compatible)</p>
                }
              </Campo>
            )}

            <Campo label="ID interno (opcional)">
              <input
                className="input-field"
                name="nlu_model_slug"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={form.id}
                onChange={set('id')}
              />
              <p style={hint}>Se genera del nombre si se deja vacío. Ej: deepseek-v3</p>
            </Campo>

            <Campo label="Costo entrada (USD/token)">
              <input
                className="input-field"
                type="number"
                name="nlu_model_costo_in"
                autoComplete="off"
                step="0.000000001"
                min="0"
                value={form.costo_in}
                onChange={set('costo_in')}
              />
              <p style={hint}>Ej: 0.00000059 (Groq Llama 3.3)</p>
            </Campo>

            <Campo label="Costo salida (USD/token)">
              <input
                className="input-field"
                type="number"
                name="nlu_model_costo_out"
                autoComplete="off"
                step="0.000000001"
                min="0"
                value={form.costo_out}
                onChange={set('costo_out')}
              />
              <p style={hint}>Ej: 0.00000079 (Groq Llama 3.3)</p>
            </Campo>

            <Campo label="Badge (opcional)">
              <input
                className="input-field"
                name="nlu_model_badge"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={form.badge}
                onChange={set('badge')}
              />
              <p style={hint}>Ej: Recomendado, Económico, Premium</p>
            </Campo>

            <Campo label="API key (opcional)">
              <input
                className="input-field"
                type="password"
                name="nlu_model_secret"
                autoComplete="new-password"
                data-1p-ignore
                value={form.api_key}
                onChange={set('api_key')}
              />
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
              title={!(testResult?.ok && testResult.validFor === testKey(form)) ? 'Probá la conexión antes de guardar' : ''}
            >
              <Plus size={15} /> {saving ? 'Agregando…' : 'Agregar modelo'}
            </button>
          </div>
        </form>
      )}

      {/* Tabla */}
      <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
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
              <th style={th}>Estado</th>
              <th style={th}>Última prueba</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {modelos.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', padding: '28px' }} colSpan={10}>Sin modelos.</td></tr>
            ) : modelos.map((m, i) => {
              const hostingBadge = HOSTING_BADGES[m.tipo_hosting] ?? HOSTING_BADGES.cloud
              const rolLabel = ROLES.find(r => r.value === m.rol)?.label ?? m.rol
              return (
              <tr key={m.id} style={{ borderBottom: i < modelos.length - 1 ? '1px solid hsl(var(--border))' : 'none', opacity: m.activo ? 1 : 0.5 }}>
                <td style={{ ...td, fontWeight: 600 }}>
                  {m.label}
                  {m.badge && (
                    <span style={{ marginLeft: '8px', fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', background: 'hsl(var(--bg-base))', color: 'hsl(var(--text-secondary))' }}>
                      {m.badge}
                    </span>
                  )}
                  <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', fontFamily: 'var(--font-mono)' }}>{m.id}</div>
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
                <td style={td}>{m.activo ? '🟢 Activo' : '⚪ Inactivo'}</td>
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
                  <button
                    onClick={() => togglear(m)}
                    disabled={busyId === m.id}
                    title={m.activo ? 'Desactivar' : 'Activar'}
                    className="btn btn-secondary"
                    style={{ padding: '5px 10px', marginRight: '4px' }}
                  >
                    <Power size={13} />
                  </button>
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
            )})}
          </tbody>
        </table>
      </div>
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
