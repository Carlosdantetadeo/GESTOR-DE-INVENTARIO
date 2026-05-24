'use client'

import { useState } from 'react'
import { Building2, Mail, Lock, ArrowRight } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Simulación de ingreso con credenciales del usuario
    setTimeout(() => {
      if (email === 'carlosdantetadeo@gmail.com' && password === '123456') {
        window.location.href = '/'
      } else {
        setError('Credenciales incorrectas. Prueba con carlosdantetadeo@gmail.com y clave 123456')
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
      background: 'radial-gradient(circle at center, hsl(var(--bg-card)) 0%, hsl(var(--bg-base)) 100%)',
      padding: '20px',
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999
    }}>
      
      <div className="glass-card animate-fade-in" style={{
        width: '100%',
        maxWidth: '420px',
        padding: '40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '28px'
      }}>
        
        {/* Brand Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
          <div style={{
            background: 'hsl(var(--accent))',
            padding: '12px',
            borderRadius: 'var(--radius-md)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px hsl(var(--accent) / 0.3)'
          }}>
            <Building2 size={28} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700 }}>Iniciar Sesión</h2>
            <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem', marginTop: '4px' }}>
              Plataforma Multi-Empresa GMS
            </p>
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>EMAIL CORPORATIVO</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'hsl(var(--text-muted))'
              }} />
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@empresa.com" 
                className="input-field"
                style={{ paddingLeft: '44px' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>CONTRASEÑA</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'hsl(var(--text-muted))'
              }} />
              <input 
                type="password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" 
                className="input-field"
                style={{ paddingLeft: '44px' }}
              />
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(244, 63, 94, 0.08)',
              border: '1px solid rgba(244, 63, 94, 0.2)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
              fontSize: '0.8rem',
              color: 'hsl(var(--color-gasto))',
              lineHeight: '1.4'
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary" style={{
            width: '100%',
            padding: '14px',
            marginTop: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}>
            {loading ? 'Validando...' : (
              <>
                Ingresar al Panel
                <ArrowRight size={16} />
              </>
            )}
          </button>

        </form>

        {/* Footer info de prueba */}
        <div style={{
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'hsl(var(--text-muted))',
          borderTop: '1px solid hsl(var(--border))',
          paddingTop: '20px'
        }}>
          <span>Demo Admin: <b>carlosdantetadeo@gmail.com</b></span>
          <br/>
          <span>Clave de acceso: <b>123456</b></span>
        </div>

      </div>

    </div>
  )
}
