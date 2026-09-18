'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Botón compacto para suspender/reactivar una empresa desde la lista.
// Suspender pide confirmación (evita accidentes); reactivar es directo (reversible).
export default function EstadoEmpresaToggle({ empresaId, activa }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  async function aplicar(nuevaActiva) {
    setSaving(true)
    try {
      const res = await fetch(`/api/superadmin/empresa/${empresaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activa: nuevaActiva }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) { setConfirmando(false); router.refresh() }
    } finally {
      setSaving(false)
    }
  }

  const btn = { padding: '6px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }

  if (!activa) {
    return (
      <button onClick={() => aplicar(true)} disabled={saving} className="btn btn-secondary" style={btn}>
        {saving ? '…' : 'Reactivar'}
      </button>
    )
  }

  if (confirmando) {
    return (
      <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
        <button onClick={() => aplicar(false)} disabled={saving} className="btn"
          style={{ ...btn, background: 'hsl(var(--color-gasto))', color: '#fff', border: 'none' }}>
          {saving ? '…' : 'Sí, suspender'}
        </button>
        <button onClick={() => setConfirmando(false)} disabled={saving} className="btn btn-secondary" style={btn}>
          No
        </button>
      </span>
    )
  }

  return (
    <button onClick={() => setConfirmando(true)} className="btn btn-secondary"
      style={{ ...btn, color: 'hsl(var(--color-gasto))', borderColor: 'hsl(var(--color-gasto) / 0.4)' }}>
      Suspender
    </button>
  )
}
