'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Límite de usuarios (plan) por empresa. Vacío = ilimitado. Se valida al crear
// usuarios en la empresa (evita que paguen por 1 y creen muchos).
export default function LimiteUsuarios({ empresaId, valor }) {
  const router = useRouter()
  const [texto, setTexto] = useState(valor == null ? '' : String(valor))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const original = valor == null ? '' : String(valor)
  const cambiado = texto.trim() !== original

  const guardar = async () => {
    setSaving(true); setMsg('')
    try {
      const res = await fetch(`/api/superadmin/empresa/${empresaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_usuarios: texto.trim() === '' ? '' : Number(texto) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) { setMsg('Guardado ✅'); router.refresh() }
      else setMsg(data.message || 'No se pudo guardar.')
    } catch {
      setMsg('Error de conexión.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <p style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))', margin: 0 }}>
        Máximo de <strong>vendedores</strong> permitidos (según el plan contratado). Admin y supervisor son 1 fijo cada uno.
        Dejalo <strong>vacío para ilimitado</strong>.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <input
          type="number" min="1" step="1"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ilimitado"
          style={{
            width: '120px', padding: '9px 12px', borderRadius: 'var(--radius-md)',
            border: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-base))', fontSize: '0.9rem',
          }}
        />
        <button onClick={guardar} disabled={saving || !cambiado} className="btn btn-primary" style={{ padding: '9px 20px' }}>
          {saving ? 'Guardando…' : 'Guardar límite'}
        </button>
        {msg && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))' }}>{msg}</span>}
      </div>
    </div>
  )
}
