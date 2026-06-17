'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, CheckCircle2, AlertTriangle } from 'lucide-react'

// Suspensión reversible de una empresa (sprint 021). Al desactivar, el bot deja
// de procesar y el login de clientes queda bloqueado. Reactivable.
export default function EstadoEmpresa({ empresaId, activa }) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const aplicar = async (nuevoActiva) => {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/superadmin/empresa/${empresaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activa: nuevoActiva }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setConfirmando(false)
        router.refresh()
      } else {
        setError(data.message || 'No se pudo guardar.')
      }
    } catch {
      setError('Error de conexión.')
    } finally {
      setSaving(false)
    }
  }

  if (!activa) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'hsl(var(--color-gasto) / 0.08)', border: '1px solid hsl(var(--color-gasto) / 0.3)' }}>
          <AlertTriangle size={18} color="hsl(var(--color-gasto))" />
          <span style={{ fontSize: '0.85rem' }}>Empresa suspendida: no puede iniciar sesión ni registrar por el bot.</span>
        </div>
        {error && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {error}</span>}
        <button onClick={() => aplicar(true)} disabled={saving} className="btn btn-primary"
          style={{ alignSelf: 'flex-start', padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={15} /> {saving ? 'Reactivando…' : 'Reactivar empresa'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))', margin: 0 }}>
        La empresa está activa. Suspenderla bloquea el login de sus clientes y el registro por el bot.
      </p>
      {error && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {error}</span>}

      {!confirmando ? (
        <button onClick={() => setConfirmando(true)} className="btn btn-secondary"
          style={{ alignSelf: 'flex-start', padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--color-gasto))', borderColor: 'hsl(var(--color-gasto) / 0.4)' }}>
          <Ban size={15} /> Suspender empresa
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid hsl(var(--color-gasto) / 0.3)', background: 'hsl(var(--color-gasto) / 0.05)' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            ¿Suspender esta empresa? No podrá iniciar sesión ni registrar por el bot hasta reactivarla.
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => aplicar(false)} disabled={saving} className="btn btn-primary"
              style={{ padding: '8px 18px', background: 'hsl(var(--color-gasto))', borderColor: 'hsl(var(--color-gasto))' }}>
              {saving ? 'Suspendiendo…' : 'Sí, suspender'}
            </button>
            <button onClick={() => setConfirmando(false)} disabled={saving} className="btn btn-secondary" style={{ padding: '8px 18px' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
