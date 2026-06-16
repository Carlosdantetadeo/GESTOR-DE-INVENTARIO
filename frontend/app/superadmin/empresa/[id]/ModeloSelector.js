'use client'

import { useState } from 'react'
import { Check, Save } from 'lucide-react'

export default function ModeloSelector({ empresaId, current, modelos }) {
  const [selected, setSelected] = useState(current)
  const [activo,   setActivo]   = useState(current)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [error,    setError]    = useState('')

  const save = async () => {
    if (selected === activo || saving) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/superadmin/empresa/${empresaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelo: selected }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setActivo(selected)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(data.message || 'No se pudo guardar.')
      }
    } catch {
      setError('Error de conexión.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {modelos.map(m => {
        const isSel = selected === m.id
        const isAct = activo === m.id
        return (
          <button key={m.id} onClick={() => setSelected(m.id)} style={{
            display: 'flex', alignItems: 'center', gap: '14px', textAlign: 'left', width: '100%',
            padding: '14px 16px', cursor: 'pointer', borderRadius: 'var(--radius-lg)',
            background: isSel ? 'hsl(var(--accent) / 0.06)' : 'hsl(var(--bg-surface))',
            border: `2px solid ${isSel ? 'hsl(var(--accent))' : 'hsl(var(--border))'}`,
          }}>
            <div style={{
              width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
              border: `2px solid ${isSel ? 'hsl(var(--accent))' : 'hsl(var(--border))'}`,
              background: isSel ? 'hsl(var(--accent))' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isSel && <Check size={10} color="#fff" strokeWidth={3} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{m.label}</span>
                <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', background: 'hsl(var(--bg-base))', color: 'hsl(var(--text-secondary))' }}>{m.badge}</span>
                {isAct && <span style={{ fontSize: '0.66rem', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', color: 'hsl(var(--accent))', border: '1px solid hsl(var(--accent))' }}>Activo</span>}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{m.costo}</div>
            </div>
          </button>
        )
      })}

      {error && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {error}</span>}

      <button onClick={save} disabled={saving || selected === activo} className="btn btn-primary"
        style={{ alignSelf: 'flex-start', padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '8px', opacity: selected === activo ? 0.5 : 1 }}>
        {saving ? 'Guardando…' : saved ? <><Check size={14} /> Guardado</> : <><Save size={14} /> Guardar modelo</>}
      </button>
    </div>
  )
}
