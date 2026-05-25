'use client'

import { useState } from 'react'
import { Building2, Mail, MapPin, Package, CheckCircle2, AlertCircle } from 'lucide-react'

const EDGE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/onboarding`

export default function Registro() {
  const [form, setForm] = useState({
    empresa: '',
    email:   '',
    sede1:   '',
    sede2:   '',
    sede3:   '',
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState(false)

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa_nombre: form.empresa,
          admin_email:    form.email,
          sedes:          [form.sede1, form.sede2, form.sede3],
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error desconocido')
      setSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Pantalla de éxito ─────────────────────────────────────────────────────

  if (success) {
    return (
      <div style={styles.wrapper}>
        <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <Brand />
          <div style={{ ...styles.card, gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <CheckCircle2 size={28} color="#16a34a" />
              <div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>¡Empresa registrada!</div>
                <div style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))' }}>
                  Revisá tu email para las credenciales y el token de Telegram
                </div>
              </div>
            </div>

            <div style={styles.infoBox}>
              <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '0.875rem' }}>Próximos pasos</div>
              <ol style={{ paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem' }}>
                <li>Revisá tu email — tiene tu contraseña temporal y el token del bot</li>
                <li>Ingresá al dashboard con tu email y esa contraseña</li>
                <li>Compartí el comando <code style={styles.code}>/start TOKEN</code> con cada empleado para que se vincule al bot de Telegram</li>
              </ol>
            </div>

            <a
              href="/login"
              className="btn btn-primary"
              style={{ width: '100%', padding: '11px', textAlign: 'center', textDecoration: 'none' }}
            >
              Ir al dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Formulario ────────────────────────────────────────────────────────────

  return (
    <div style={styles.wrapper}>
      <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <Brand />

        <div style={styles.card}>
          <div>
            <h1 style={{ fontSize: '1.35rem', marginBottom: '4px' }}>Registrá tu empresa</h1>
            <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
              En menos de un minuto tu equipo puede empezar a registrar ventas por voz
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

            {/* Nombre de empresa */}
            <Field label="Nombre de la empresa">
              <div style={{ position: 'relative' }}>
                <Building2 size={15} style={styles.fieldIcon} />
                <input
                  type="text"
                  required
                  value={form.empresa}
                  onChange={set('empresa')}
                  placeholder="Ej: Ferretería Los Andes"
                  className="input-field"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
            </Field>

            {/* Email administrador */}
            <Field label="Email del administrador">
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={styles.fieldIcon} />
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  placeholder="admin@tuempresa.com"
                  className="input-field"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
            </Field>

            {/* Sedes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={styles.label}>Nombres de las 3 sedes</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { key: 'sede1', placeholder: 'Ej: Sede Centro' },
                  { key: 'sede2', placeholder: 'Ej: Sede Norte' },
                  { key: 'sede3', placeholder: 'Ej: Sede Sur' },
                ].map(({ key, placeholder }, i) => (
                  <div key={key} style={{ position: 'relative' }}>
                    <MapPin size={15} style={styles.fieldIcon} />
                    <input
                      type="text"
                      required
                      value={form[key]}
                      onChange={set(key)}
                      placeholder={placeholder}
                      className="input-field"
                      style={{ paddingLeft: '38px' }}
                      aria-label={`Sede ${i + 1}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={styles.errorBox}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '11px', marginTop: '2px' }}
            >
              {loading ? 'Creando empresa...' : 'Crear empresa'}
            </button>
          </form>

          <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: '14px', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
            ¿Ya tenés cuenta?{' '}
            <a href="/login" style={{ color: 'hsl(var(--accent))', textDecoration: 'none', fontWeight: 500 }}>
              Iniciá sesión
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        width: '40px', height: '40px',
        background: 'hsl(var(--accent))',
        borderRadius: 'var(--radius-md)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Package size={20} color="#fff" />
      </div>
      <div>
        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Agent GMS</div>
        <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>Inventario por voz</div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  )
}

// ─── Estilos compartidos ──────────────────────────────────────────────────────

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'hsl(var(--bg-base))',
    padding: '20px',
    overflowY: 'auto',
  },
  card: {
    background: 'hsl(var(--bg-surface))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius-lg)',
    padding: '32px',
    boxShadow: 'var(--shadow-md)',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  label: {
    fontSize: '0.825rem',
    fontWeight: 500,
    color: 'hsl(var(--text-secondary))',
  },
  fieldIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'hsl(var(--text-muted))',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    fontSize: '0.825rem',
    color: '#dc2626',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  infoBox: {
    background: 'hsl(var(--bg-base))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
    color: 'hsl(var(--text-secondary))',
  },
  code: {
    fontFamily: 'var(--font-mono)',
    background: 'hsl(var(--border))',
    padding: '1px 5px',
    borderRadius: '4px',
    fontSize: '0.8rem',
  },
}
