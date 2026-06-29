'use client'

import { useState } from 'react'
import { Unlink } from 'lucide-react'

const th = { padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--text-muted))', fontSize: '0.74rem', whiteSpace: 'nowrap' }
const td = { padding: '10px 14px', fontSize: '0.84rem', whiteSpace: 'nowrap' }

function fmtFecha(s) {
  if (!s) return 'Sin actividad'
  return new Date(s).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Lista de operarios de Telegram de la empresa con acción de Desconectar (solo
// superadmin). Desconectar elimina el vínculo (tabla usuarios); deberá re-vincularse
// con /start para volver a registrar.
export default function OperariosSuperadmin({ empresaId, operarios: inicial }) {
  const [operarios, setOperarios] = useState(inicial)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const desconectar = async (u) => {
    if (!confirm(`¿Desconectar a ${u.nombre || 'este operario'}? Deberá volver a vincularse con /start.`)) return
    setBusyId(u.id); setError('')
    try {
      const res = await fetch(`/api/superadmin/empresa/${empresaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desconectar: u.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) setOperarios(prev => prev.filter(o => o.id !== u.id))
      else setError(data.message || 'No se pudo desconectar.')
    } catch {
      setError('Error de conexión.')
    } finally {
      setBusyId(null)
    }
  }

  if (operarios.length === 0) {
    return <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))', margin: 0 }}>Sin operarios vinculados.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {error && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {error}</span>}
      <div style={{ overflowX: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'hsl(var(--bg-base))' }}>
              <th style={th}>Nombre</th><th style={th}>Rol</th><th style={th}>Sede</th><th style={th}>Último registro</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {operarios.map((u) => (
              <tr key={u.id} style={{ borderTop: '1px solid hsl(var(--border))' }}>
                <td style={{ ...td, fontWeight: 600 }}>{u.nombre || '—'}</td>
                <td style={td}>{u.rol === 'admin' ? 'Admin' : 'Operario'}</td>
                <td style={{ ...td, color: 'hsl(var(--text-secondary))' }}>{u.sede}</td>
                <td style={{ ...td, color: 'hsl(var(--text-secondary))' }}>{fmtFecha(u.ultimoRegistro)}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button onClick={() => desconectar(u)} disabled={busyId === u.id} title="Desconectar"
                    className="btn btn-secondary"
                    style={{ padding: '5px 11px', display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'hsl(var(--color-gasto))', borderColor: 'hsl(var(--color-gasto) / 0.35)', fontSize: '0.78rem' }}>
                    <Unlink size={13} /> {busyId === u.id ? 'Desconectando…' : 'Desconectar'}
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
