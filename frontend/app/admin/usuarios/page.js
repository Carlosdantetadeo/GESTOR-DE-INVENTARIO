'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Copy, Check, Users, Send, MapPin } from 'lucide-react'

function formatFecha(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-PE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

export default function UsuariosPage() {
  const [empresa,   setEmpresa]   = useState(null)   // { nombre, telegram_token }
  const [operarios, setOperarios] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [copied,    setCopied]    = useState(null)   // 'token' | 'comando'

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const empId = user.app_metadata?.empresa_id
      if (!empId) { setLoading(false); return }

      // RLS limita ambas queries a la empresa del admin
      const [{ data: emp }, { data: usrs }] = await Promise.all([
        supabase.from('empresas').select('nombre, telegram_token').eq('id', empId).single(),
        supabase
          .from('usuarios')
          .select('id, nombre, rol, created_at, tiendas (nombre)')
          .order('created_at', { ascending: false }),
      ])

      setEmpresa(emp)
      setOperarios(usrs ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2500)
    } catch { /* clipboard no disponible */ }
  }

  if (loading) {
    return (
      <div style={styles.wrapper}>
        <p style={{ color: 'hsl(var(--text-muted))' }}>Cargando...</p>
      </div>
    )
  }

  const token   = empresa?.telegram_token ?? ''
  const comando = `/start ${token}`

  return (
    <div style={styles.wrapper}>
      <div style={{ maxWidth: '680px', width: '100%', display: 'flex', flexDirection: 'column', gap: '32px' }}>

        {/* Header */}
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '4px' }}>Usuarios</h1>
          <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
            Vinculá operarios al bot de Telegram y mirá quiénes ya están conectados
          </p>
        </div>

        {/* Token de vinculación */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={styles.sectionLabel}>Token de Telegram de tu empresa</div>

          <div style={styles.card}>
            <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
              Cada empleado debe enviarle este comando al bot de Telegram y elegir su sede.
              El token es único para <strong>{empresa?.nombre ?? 'tu empresa'}</strong> — compartilo solo con tu equipo.
            </p>

            <div style={styles.tokenRow}>
              <code style={styles.tokenCode}>{comando}</code>
              <button
                onClick={() => copy(comando, 'comando')}
                className="btn btn-primary"
                style={styles.copyBtn}
                aria-label="Copiar comando"
              >
                {copied === 'comando'
                  ? <><Check size={14} /> Copiado</>
                  : <><Copy size={14} /> Copiar comando</>}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
              <Send size={13} />
              Solo el token:
              <code style={{ ...styles.codeInline }}>{token}</code>
              <button
                onClick={() => copy(token, 'token')}
                style={styles.linkBtn}
              >
                {copied === 'token' ? 'copiado ✓' : 'copiar'}
              </button>
            </div>
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
                Todavía no hay operarios vinculados.<br />
                Compartí el comando de arriba con tu equipo para empezar.
              </p>
            </div>
          ) : (
            <div style={styles.tableCard}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'hsl(var(--bg-base))', borderBottom: '1px solid hsl(var(--border))' }}>
                    {['Nombre', 'Rol', 'Sede', 'Vinculado'].map((h, i) => (
                      <th key={h} style={{
                        padding: '10px 16px', fontWeight: 600,
                        color: 'hsl(var(--text-muted))', fontSize: '0.775rem',
                        textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'left',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {operarios.map((u, i) => (
                    <tr key={u.id} style={{
                      borderBottom: i < operarios.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                    }}>
                      <td style={{ padding: '10px 16px', fontWeight: 600 }}>{u.nombre || '—'}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={styles.rolBadge}>{u.rol}</span>
                      </td>
                      <td style={{ padding: '10px 16px', color: 'hsl(var(--text-secondary))' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <MapPin size={12} />
                          {u.tiendas?.nombre || 'Sin asignar'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'hsl(var(--text-muted))' }}>
                        {formatFecha(u.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
    overflow: 'hidden',
  },
  tokenRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'stretch',
    flexWrap: 'wrap',
  },
  tokenCode: {
    flex: 1,
    minWidth: '260px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    background: 'hsl(var(--bg-base))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    overflowX: 'auto',
    whiteSpace: 'nowrap',
  },
  codeInline: {
    fontFamily: 'var(--font-mono)',
    background: 'hsl(var(--bg-base))',
    padding: '1px 6px',
    borderRadius: '4px',
    fontSize: '0.75rem',
  },
  copyBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    whiteSpace: 'nowrap',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'hsl(var(--accent))',
    fontSize: '0.78rem',
    fontWeight: 500,
  },
  rolBadge: {
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '2px 10px',
    borderRadius: '99px',
    background: 'hsl(var(--accent) / 0.1)',
    color: 'hsl(var(--accent))',
    textTransform: 'capitalize',
  },
}
