'use client'

import { useState } from 'react'
import { Plus, Trash2, Power } from 'lucide-react'

const PROVEEDORES = ['groq', 'anthropic', 'openrouter', 'openai-compat']

const th = { padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--text-muted))', fontSize: '0.72rem', whiteSpace: 'nowrap' }
const td = { padding: '10px 12px', fontSize: '0.82rem', whiteSpace: 'nowrap' }

const VACIO = { id: '', label: '', proveedor: 'openrouter', api_model_id: '', base_url: '', costo_in: '', costo_out: '', badge: '', api_key: '' }

export default function ModelosManager({ inicial }) {
  const [modelos, setModelos] = useState(inicial)
  const [form, setForm] = useState(VACIO)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const refrescar = async () => {
    const res = await fetch('/api/superadmin/modelos')
    const data = await res.json().catch(() => ({}))
    if (data.ok) setModelos(data.modelos)
  }

  const crear = async (e) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/superadmin/modelos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setForm(VACIO)
        await refrescar()
      } else {
        setError(data.message || 'No se pudo crear.')
      }
    } catch {
      setError('Error de conexión.')
    } finally {
      setSaving(false)
    }
  }

  const togglear = async (m) => {
    setBusyId(m.id); setError('')
    try {
      const res = await fetch(`/api/superadmin/modelos/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !m.activo }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) await refrescar()
      else setError(data.message || 'No se pudo actualizar.')
    } finally {
      setBusyId(null)
    }
  }

  const eliminar = async (m) => {
    if (!confirm(`¿Eliminar el modelo "${m.label}"?`)) return
    setBusyId(m.id); setError('')
    try {
      const res = await fetch(`/api/superadmin/modelos/${m.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) await refrescar()
      else setError(data.message || 'No se pudo eliminar.')
    } finally {
      setBusyId(null)
    }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Form de alta */}
      <form onSubmit={crear} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Agregar modelo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          <Campo label="Nombre visible">
            <input className="input-field" value={form.label} onChange={set('label')} placeholder="DeepSeek V3" required />
          </Campo>
          <Campo label="Proveedor">
            <select className="input-field" value={form.proveedor} onChange={set('proveedor')}>
              {PROVEEDORES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Campo>
          <Campo label="API model id">
            <input className="input-field" value={form.api_model_id} onChange={set('api_model_id')} placeholder="deepseek/deepseek-chat" required />
          </Campo>
          {form.proveedor === 'openai-compat' && (
            <Campo label="Base URL (endpoint OpenAI-compatible)">
              <input className="input-field" value={form.base_url} onChange={set('base_url')} placeholder="https://…/v1 (ej. MaaS de Huawei)" required />
            </Campo>
          )}
          <Campo label="ID interno (opcional)">
            <input className="input-field" value={form.id} onChange={set('id')} placeholder="se genera del nombre" />
          </Campo>
          <Campo label="Costo entrada (USD/token)">
            <input className="input-field" type="number" step="0.000000001" value={form.costo_in} onChange={set('costo_in')} placeholder="0.0000003" />
          </Campo>
          <Campo label="Costo salida (USD/token)">
            <input className="input-field" type="number" step="0.000000001" value={form.costo_out} onChange={set('costo_out')} placeholder="0.0000009" />
          </Campo>
          <Campo label="Badge (opcional)">
            <input className="input-field" value={form.badge} onChange={set('badge')} placeholder="Económico" />
          </Campo>
          <Campo label="API key (opcional)">
            <input className="input-field" type="password" autoComplete="off" value={form.api_key} onChange={set('api_key')} placeholder="sk-… (se guarda cifrada)" />
          </Campo>
        </div>
        {error && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {error}</span>}
        <button type="submit" disabled={saving} className="btn btn-primary"
          style={{ alignSelf: 'flex-start', padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={15} /> {saving ? 'Agregando…' : 'Agregar modelo'}
        </button>
      </form>

      {/* Tabla */}
      <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-base))' }}>
              <th style={th}>Modelo</th><th style={th}>Proveedor</th><th style={th}>API model id</th>
              <th style={th}>API key</th><th style={th}>Costo in</th><th style={th}>Costo out</th><th style={th}>Estado</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {modelos.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', padding: '28px' }} colSpan={8}>Sin modelos.</td></tr>
            ) : modelos.map((m, i) => (
              <tr key={m.id} style={{ borderBottom: i < modelos.length - 1 ? '1px solid hsl(var(--border))' : 'none', opacity: m.activo ? 1 : 0.5 }}>
                <td style={{ ...td, fontWeight: 600 }}>
                  {m.label}{m.badge ? <span style={{ marginLeft: '8px', fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', background: 'hsl(var(--bg-base))', color: 'hsl(var(--text-secondary))' }}>{m.badge}</span> : null}
                  <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', fontFamily: 'var(--font-mono)' }}>{m.id}</div>
                </td>
                <td style={td}>{m.proveedor}</td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{m.api_model_id}</td>
                <td style={td}>{m.tiene_api_key ? '🔑 Propia' : '— secret'}</td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{Number(m.costo_in)}</td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{Number(m.costo_out)}</td>
                <td style={td}>{m.activo ? '🟢 Activo' : '⚪ Inactivo'}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button onClick={() => togglear(m)} disabled={busyId === m.id} title={m.activo ? 'Desactivar' : 'Activar'}
                    className="btn btn-secondary" style={{ padding: '5px 10px', marginRight: '6px' }}>
                    <Power size={13} />
                  </button>
                  <button onClick={() => eliminar(m)} disabled={busyId === m.id} title="Eliminar"
                    className="btn btn-secondary" style={{ padding: '5px 10px', color: 'hsl(var(--color-gasto))' }}>
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
