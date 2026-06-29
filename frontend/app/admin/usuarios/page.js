'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Users, MapPin, Unlink, X, Copy, Check } from 'lucide-react'

function formatFecha(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-PE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

function formatFechaHora(dateStr) {
  if (!dateStr) return 'Sin actividad'
  return new Date(dateStr).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Estado de actividad a partir del último movimiento registrado por el operario.
//  🟢 Activo      — registró algo en las últimas 24h
//  🟡 Inactivo    — más de 24h pero menos de 7 días
//  🔴 Sin actividad — más de 7 días o nunca registró
function estadoActividad(ultimo) {
  if (!ultimo) return { color: '#ef4444', label: 'Sin actividad' }
  const diffH = (Date.now() - new Date(ultimo).getTime()) / 3_600_000
  if (diffH <= 24)     return { color: '#22c55e', label: 'Activo' }
  if (diffH <= 24 * 7) return { color: '#eab308', label: 'Inactivo' }
  return { color: '#ef4444', label: 'Sin actividad' }
}

export default function UsuariosPage() {
  const [empresaId, setEmpresaId] = useState(null)
  const [operarios, setOperarios] = useState([])
  const [tokens,    setTokens]    = useState({ vendedor: '', admin: '' })
  const [loading,   setLoading]   = useState(true)
  const [confirmU,  setConfirmU]  = useState(null)   // operario pendiente de desconectar
  const [deleting,  setDeleting]  = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const empId = user.app_metadata?.empresa_id
      if (!empId) { setLoading(false); return }
      setEmpresaId(empId)

      // Tokens de conexión Telegram de la empresa (read-only; RLS limita a la propia).
      const { data: emp } = await supabase
        .from('empresas')
        .select('telegram_token, telegram_token_admin')
        .eq('id', empId)
        .single()
      if (emp) setTokens({ vendedor: emp.telegram_token ?? '', admin: emp.telegram_token_admin ?? '' })

      // RLS limita la query a la empresa del admin.
      const { data: usrs } = await supabase
        .from('usuarios')
        .select('id, telegram_id, nombre, rol, created_at, tiendas (nombre)')
        .order('created_at', { ascending: false })

      // Último movimiento de cada operario (1 query por operario; N es chico).
      const conActividad = await Promise.all((usrs ?? []).map(async (u) => {
        const { data: m } = await supabase
          .from('movimientos')
          .select('created_at')
          .eq('usuario_id', u.id)
          .order('created_at', { ascending: false })
          .limit(1)
        return { ...u, ultimoRegistro: m?.[0]?.created_at ?? null }
      }))

      setOperarios(conActividad)
      setLoading(false)
    }
    load()
  }, [])

  const desconectar = async () => {
    if (!confirmU || deleting) return
    setDeleting(true)
    const { error } = await supabase
      .from('usuarios')
      .delete()
      .eq('telegram_id', confirmU.telegram_id)
      .eq('empresa_id', empresaId)
    setDeleting(false)
    if (!error) {
      setOperarios(prev => prev.filter(o => o.id !== confirmU.id))
      setConfirmU(null)
    }
  }

  if (loading) {
    return (
      <div style={styles.wrapper}>
        <p style={{ color: 'hsl(var(--text-muted))' }}>Cargando...</p>
      </div>
    )
  }

  return (
    <div style={styles.wrapper}>
      <div style={{ maxWidth: '760px', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* Header */}
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '4px' }}>Usuarios</h1>
          <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
            Operarios conectados al bot de Telegram y su actividad reciente
          </p>
        </div>

        {/* Conexión Telegram (tokens read-only) */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={styles.sectionLabel}>Conexión Telegram</div>
          <div style={{ ...styles.card, gap: '14px' }}>
            <p style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))', margin: 0 }}>
              Tus empleados se conectan al bot enviándole <code>/start &lt;token&gt;</code>. Compartí el
              token de <strong>operario</strong> con tus vendedores. El token <strong>admin</strong> es
              para administradores (reportes) — no lo compartas.
            </p>
            <TokenReadOnly etiqueta="Token operario" valor={tokens.vendedor} />
            <TokenReadOnly etiqueta="Token admin" valor={tokens.admin} />
          </div>
        </section>

        {/* Operarios conectados */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={styles.sectionLabel}>Operarios conectados</div>
            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
              {operarios.length} {operarios.length === 1 ? 'operario' : 'operarios'}
            </span>
          </div>

          {operarios.length === 0 ? (
            <div style={{ ...styles.card, alignItems: 'center', textAlign: 'center', padding: '28px' }}>
              <Users size={22} color="hsl(var(--text-muted))" />
              <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem', margin: 0 }}>
                Todavía no hay operarios vinculados.
              </p>
            </div>
          ) : (
            <div style={styles.tableCard}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'hsl(var(--bg-base))', borderBottom: '1px solid hsl(var(--border))' }}>
                    {['Nombre', 'Rol', 'Sede', 'Último registro', 'Vinculado', ''].map((h, i) => (
                      <th key={h || i} style={{
                        padding: '10px 16px', fontWeight: 600,
                        color: 'hsl(var(--text-muted))', fontSize: '0.775rem',
                        textAlign: 'left', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {operarios.map((u, i) => {
                    const est = estadoActividad(u.ultimoRegistro)
                    return (
                      <tr key={u.id} style={{
                        borderBottom: i < operarios.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                      }}>
                        <td style={{ padding: '10px 16px', fontWeight: 600 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              title={est.label}
                              aria-label={est.label}
                              style={{
                                width: '9px', height: '9px', borderRadius: '50%',
                                background: est.color, flexShrink: 0,
                              }}
                            />
                            {u.nombre || '—'}
                            <span style={{ fontSize: '0.72rem', fontWeight: 500, color: est.color }}>
                              {est.label}
                            </span>
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={styles.rolBadge}>{u.rol === 'admin' ? 'Admin' : 'Operario'}</span>
                        </td>
                        <td style={{ padding: '10px 16px', color: 'hsl(var(--text-secondary))' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <MapPin size={12} />
                            {u.tiendas?.nombre || 'Sin asignar'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', color: 'hsl(var(--text-secondary))', whiteSpace: 'nowrap' }}>
                          {formatFechaHora(u.ultimoRegistro)}
                        </td>
                        <td style={{ padding: '10px 16px', color: 'hsl(var(--text-muted))', whiteSpace: 'nowrap' }}>
                          {formatFecha(u.created_at)}
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          <button
                            onClick={() => setConfirmU(u)}
                            style={styles.disconnectBtn}
                            aria-label={`Desconectar a ${u.nombre || 'operario'}`}
                          >
                            <Unlink size={13} />
                            Desconectar
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Modal de confirmación de desconexión */}
      {confirmU && (
        <div
          onClick={() => !deleting && setConfirmU(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'hsl(0 0% 0% / 0.55)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card"
            style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.15rem' }}>Desconectar operario</h2>
              <button type="button" onClick={() => !deleting && setConfirmU(null)} aria-label="Cerrar"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))', display: 'flex' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
              ¿Desconectás a <strong>{confirmU.nombre || 'este operario'}</strong>? Deberá volver a
              vincularse con el bot para registrar movimientos.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
              <button onClick={() => setConfirmU(null)} className="btn btn-secondary" disabled={deleting}>
                Cancelar
              </button>
              <button
                onClick={desconectar}
                disabled={deleting}
                className="btn"
                style={{ background: 'hsl(var(--color-gasto))', color: '#fff' }}
              >
                {deleting ? 'Desconectando…' : 'Desconectar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Token read-only con botón copiar (el cliente no puede rotarlo — eso es solo superadmin).
function TokenReadOnly({ etiqueta, valor }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch { /* noop */ }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>{etiqueta}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <code style={{ flex: '1 1 260px', minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'hsl(var(--bg-base))', border: '1px solid hsl(var(--border))', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          {valor || '—'}
        </code>
        <button onClick={copiar} className="btn btn-secondary" style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  wrapper: {
    padding: '32px 24px',
    display: 'flex',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'hsl(var(--text-secondary))',
  },
  card: {
    background: 'hsl(var(--bg-surface))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius-lg)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  tableCard: {
    background: 'hsl(var(--bg-surface))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius-lg)',
    overflowX: 'auto',
  },
  rolBadge: {
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '2px 10px',
    borderRadius: '99px',
    background: 'hsl(var(--accent) / 0.1)',
    color: 'hsl(var(--accent))',
  },
  disconnectBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: 'var(--radius-md)',
    background: 'transparent',
    border: '1px solid hsl(var(--color-gasto) / 0.35)',
    color: 'hsl(var(--color-gasto))',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
}
