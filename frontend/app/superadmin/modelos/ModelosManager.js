'use client'

import { useState } from 'react'
import { Plus, Trash2, Power, ChevronDown, ChevronUp } from 'lucide-react'

const PROVEEDORES = ['groq', 'anthropic', 'openrouter', 'openai-compat']

const th = { padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--text-muted))', fontSize: '0.72rem', whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', fontSize: '0.82rem', whiteSpace: 'nowrap' }
const hint = { margin: '3px 0 0', fontSize: '0.72rem', color: 'hsl(var(--text-muted))', fontWeight: 400 }
const errInline = { margin: '3px 0 0', fontSize: '0.72rem', color: 'hsl(var(--color-gasto))', fontWeight: 400 }

const VACIO = { id: '', label: '', proveedor: 'openrouter', api_model_id: '', base_url: '', costo_in: '', costo_out: '', badge: '', api_key: '' }

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
  const [errorForm, setErrorForm]     = useState('')
  const [errApiId, setErrApiId]       = useState('')
  const [busyId, setBusyId]           = useState(null)

  const refrescar = async () => {
    const res = await fetch('/api/superadmin/modelos')
    const data = await res.json().catch(() => ({}))
    if (data.ok) setModelos(data.modelos)
  }

  const set = (k) => (e) => {
    setForm(f => ({ ...f, [k]: e.target.value }))
    if (k === 'api_model_id') setErrApiId('')
  }

  const crear = async (e) => {
    e.preventDefault()

    const apiErr = validarApiModelId(form.api_model_id)
    if (apiErr) { setErrApiId(apiErr); return }

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

            {form.proveedor === 'openai-compat' && (
              <Campo label="Base URL">
                <input
                  className="input-field"
                  name="nlu_model_base_url"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  value={form.base_url}
                  onChange={set('base_url')}
                  required
                />
                <p style={hint}>Ej: https://…/v1 (endpoint OpenAI-compatible)</p>
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
              <p style={hint}>Se guarda cifrada. Vacío = usa la key global del proveedor.</p>
            </Campo>

          </div>

          {errorForm && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {errorForm}</span>}

          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
            style={{ alignSelf: 'flex-start', padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Plus size={15} /> {saving ? 'Agregando…' : 'Agregar modelo'}
          </button>
        </form>
      )}

      {/* Tabla */}
      <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-base))' }}>
              <th style={th}>Modelo</th>
              <th style={th}>Proveedor</th>
              <th style={th}>API model id</th>
              <th style={th}>API key</th>
              <th style={th}>Costo entrada</th>
              <th style={th}>Costo salida</th>
              <th style={th}>Estado</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {modelos.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', padding: '28px' }} colSpan={8}>Sin modelos.</td></tr>
            ) : modelos.map((m, i) => (
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
                <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{m.api_model_id}</td>
                <td style={td}>{m.tiene_api_key ? '🔑 Propia' : '— global'}</td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{formatCosto(m.costo_in)}</td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{formatCosto(m.costo_out)}</td>
                <td style={td}>{m.activo ? '🟢 Activo' : '⚪ Inactivo'}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button
                    onClick={() => togglear(m)}
                    disabled={busyId === m.id}
                    title={m.activo ? 'Desactivar' : 'Activar'}
                    className="btn btn-secondary"
                    style={{ padding: '5px 10px', marginRight: '6px' }}
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
            ))}
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
