'use client'

import { useState } from 'react'
import { Lock, Mail, Package } from 'lucide-react'

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
        setError('Correo o contraseña incorrectos.')
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
      background: 'hsl(var(--bg-base))',
      padding: '20px'
    }}>
      <div style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

        {/* Logo / Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px',
            background: 'hsl(var(--accent))',
            borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Package size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Inventario</div>
            <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>Control de stock</div>
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'hsl(var(--bg-surface))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 'var(--radius-lg)',
          padding: '32px',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '4px' }}>Iniciar sesión</h1>
            <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
              Ingresa tus datos para continuar
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.825rem', fontWeight: 500, color: 'hsl(var(--text-secondary))' }}>
                Correo electrónico
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={{
                  position: 'absolute', left: '12px', top: '50%',
                  transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))'
                }} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="input-field"
                  style={{ paddingLeft: '38px' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.825rem', fontWeight: 500, color: 'hsl(var(--text-secondary))' }}>
                Contraseña
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} style={{
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
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                fontSize: '0.825rem',
                color: '#dc2626'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '11px', marginTop: '4px' }}
            >
              {loading ? 'Verificando...' : 'Ingresar'}
            </button>
          </form>

          <div style={{
            borderTop: '1px solid hsl(var(--border))',
            paddingTop: '14px',
            fontSize: '0.8rem',
            color: 'hsl(var(--text-muted))'
          }}>
            <div style={{ marginBottom: '4px', fontWeight: 500 }}>Acceso demo:</div>
            <div>carlosdantetadeo@gmail.com · 123456</div>
          </div>
        </div>

      </div>
    </div>
  )
}
