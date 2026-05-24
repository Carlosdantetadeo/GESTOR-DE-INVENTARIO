'use client'

import { useState } from 'react'
import { ArrowRight, Lock, Mail } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setTimeout(() => {
      if (email === 'carlosdantetadeo@gmail.com' && password === '123456') {
        window.location.href = '/'
      } else {
        setError('Credenciales incorrectas.')
        setLoading(false)
      }
    }, 1000)
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9999,
      background: 'hsl(var(--bg-base))',
      backgroundImage: `
        linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)
      `,
      backgroundSize: '28px 28px',
      padding: '20px'
    }}>

      {/* Acento decorativo — barra lateral izquierda */}
      <div style={{
        position: 'fixed',
        left: 0, top: 0, bottom: 0,
        width: '4px',
        background: `linear-gradient(to bottom, transparent, hsl(var(--accent)), transparent)`
      }} />

      <div style={{
        width: '100%',
        maxWidth: '400px',
        display: 'flex',
        flexDirection: 'column',
        gap: '32px'
      }}>

        {/* Header */}
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'hsl(var(--accent))',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            marginBottom: '12px'
          }}>
            AGENT GMS · v1.0
          </div>
          <h1 style={{
            fontSize: '3rem',
            fontWeight: 800,
            lineHeight: 1,
            marginBottom: '8px'
          }}>
            CONTROL<br />
            <span style={{ color: 'hsl(var(--accent))' }}>CENTRAL</span>
          </h1>
          <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
            Sistema de inventario inteligente por voz
          </p>
        </div>

        {/* Form */}
        <div style={{
          background: 'hsl(var(--bg-card))',
          border: '1px solid hsl(var(--border))',
          borderLeft: '3px solid hsl(var(--accent))',
          borderRadius: 'var(--radius-md)',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'hsl(var(--text-muted))'
              }}>
                Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={14} style={{
                  position: 'absolute', left: '12px', top: '50%',
                  transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))'
                }} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.com"
                  className="input-field"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'hsl(var(--text-muted))'
              }}>
                Contraseña
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{
                  position: 'absolute', left: '12px', top: '50%',
                  transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))'
                }} />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
            </div>

            {error && (
              <div style={{
                background: 'hsl(var(--color-gasto) / 0.08)',
                border: '1px solid hsl(var(--color-gasto) / 0.25)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: 'hsl(var(--color-gasto))'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '13px', marginTop: '4px' }}
            >
              {loading ? 'Verificando...' : (
                <>
                  Ingresar al Sistema
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          {/* Demo credentials */}
          <div style={{
            borderTop: '1px solid hsl(var(--border))',
            paddingTop: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65rem',
              color: 'hsl(var(--text-muted))',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              marginBottom: '6px'
            }}>
              — Acceso Demo —
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'hsl(var(--text-secondary))' }}>
              carlosdantetadeo@gmail.com
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'hsl(var(--text-secondary))' }}>
              pass: 123456
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
