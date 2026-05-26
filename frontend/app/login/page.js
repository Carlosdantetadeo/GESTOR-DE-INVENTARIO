'use client'

import { useState } from 'react'
import { Lock, Mail, Package, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [mode,     setMode]     = useState('login')   // 'login' | 'reset'
  const [resetSent, setResetSent] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Correo o contraseña incorrectos.')
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    const empresaId = user?.user_metadata?.empresa_id

    if (!empresaId) {
      setError('Tu cuenta no tiene una empresa asignada. Contactá al administrador.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    window.location.href = new URLSearchParams(window.location.search).get('redirect') || '/'
  }

  const handleReset = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    })

    setLoading(false)
    if (resetError) {
      setError('No se pudo enviar el correo. Verificá el email ingresado.')
      return
    }
    setResetSent(true)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'hsl(var(--bg-base))', padding: '20px'
    }}>
      <div style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', background: 'hsl(var(--accent))',
            borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Package size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Inventario</div>
            <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>Control de stock</div>
          </div>
        </div>

        <div style={{
          background: 'hsl(var(--bg-surface))', border: '1px solid hsl(var(--border))',
          borderRadius: 'var(--radius-lg)', padding: '32px', boxShadow: 'var(--shadow-md)',
          display: 'flex', flexDirection: 'column', gap: '20px'
        }}>

          {mode === 'login' ? (
            <>
              <div>
                <h1 style={{ fontSize: '1.4rem', marginBottom: '4px' }}>Iniciar sesión</h1>
                <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
                  Ingresá tus datos para continuar
                </p>
              </div>

              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <Field label="Correo electrónico">
                  <InputIcon icon={<Mail size={15} />}>
                    <input
                      type="email" required value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      className="input-field" style={{ paddingLeft: '38px' }}
                    />
                  </InputIcon>
                </Field>

                <Field label="Contraseña">
                  <InputIcon icon={<Lock size={15} />}>
                    <input
                      type="password" required value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="input-field" style={{ paddingLeft: '38px' }}
                    />
                  </InputIcon>
                </Field>

                <div style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => { setMode('reset'); setError('') }}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      fontSize: '0.8rem', color: 'hsl(var(--accent))', fontWeight: 500 }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>

                {error && <ErrorBox>{error}</ErrorBox>}

                <button type="submit" disabled={loading} className="btn btn-primary"
                  style={{ width: '100%', padding: '11px', marginTop: '4px' }}>
                  {loading ? 'Verificando...' : 'Ingresar'}
                </button>
              </form>

              <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: '14px',
                fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                ¿No tenés cuenta?{' '}
                <a href="/registro" style={{ color: 'hsl(var(--accent))', textDecoration: 'none', fontWeight: 500 }}>
                  Registrá tu empresa
                </a>
              </div>
            </>
          ) : resetSent ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <CheckCircle2 size={28} color="#16a34a" />
                <div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Revisá tu correo</div>
                  <div style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))' }}>
                    Te enviamos un link para restablecer tu contraseña
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => { setMode('login'); setResetSent(false) }}
                className="btn btn-primary" style={{ width: '100%', padding: '11px' }}>
                Volver al login
              </button>
            </>
          ) : (
            <>
              <div>
                <h1 style={{ fontSize: '1.4rem', marginBottom: '4px' }}>Recuperar contraseña</h1>
                <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
                  Te enviamos un link para crear una nueva contraseña
                </p>
              </div>

              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <Field label="Correo electrónico">
                  <InputIcon icon={<Mail size={15} />}>
                    <input
                      type="email" required value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      className="input-field" style={{ paddingLeft: '38px' }}
                    />
                  </InputIcon>
                </Field>

                {error && <ErrorBox>{error}</ErrorBox>}

                <button type="submit" disabled={loading} className="btn btn-primary"
                  style={{ width: '100%', padding: '11px', marginTop: '4px' }}>
                  {loading ? 'Enviando...' : 'Enviar link de recuperación'}
                </button>
              </form>

              <button type="button" onClick={() => { setMode('login'); setError('') }}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: '0.85rem', color: 'hsl(var(--text-muted))', textAlign: 'center' }}>
                ← Volver al login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '0.825rem', fontWeight: 500, color: 'hsl(var(--text-secondary))' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function InputIcon({ icon, children }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: '12px', top: '50%',
        transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))' }}>
        {icon}
      </span>
      {children}
    </div>
  )
}

function ErrorBox({ children }) {
  return (
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca',
      borderRadius: 'var(--radius-md)', padding: '10px 14px',
      fontSize: '0.825rem', color: '#dc2626' }}>
      {children}
    </div>
  )
}
