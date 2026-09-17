'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Lock, Mail, CheckCircle2, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [mode,     setMode]     = useState('login')
  const [resetSent, setResetSent] = useState(false)
  const [verClave, setVerClave] = useState(false)

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
    const empresaId = user?.app_metadata?.empresa_id
    if (!empresaId) {
      setError('Tu cuenta no tiene una empresa asignada. Contactá al administrador.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    const { data: emp } = await supabase.from('empresas').select('activa').eq('id', empresaId).single()
    if (emp && emp.activa === false) {
      setError('Tu empresa está suspendida. Contactá al proveedor.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    window.location.href = new URLSearchParams(window.location.search).get('redirect') || '/auditoria'
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
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .login-fade { animation: fadeUp 0.5s ease both; }
        .login-input {
          width: 100%; padding: 11px 14px 11px 40px;
          border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 0.9rem; color: #1a2236; background: #f8fafc;
          outline: none; transition: border-color 0.15s, box-shadow 0.15s;
          font-family: inherit;
        }
        .login-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); background: #fff; }
        .login-input::placeholder { color: #94a3b8; }
        .login-btn {
          width: 100%; padding: 12px; border-radius: 8px; border: none;
          background: #2563eb; color: #fff; font-size: 0.95rem; font-weight: 700;
          cursor: pointer; transition: background 0.15s, transform 0.1s;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          font-family: inherit;
        }
        .login-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
        .login-btn:disabled { opacity: 0.65; cursor: not-allowed; }
        .panel-left {
          width: 45%; background: linear-gradient(160deg, #0f2557 0%, #1a3a8f 50%, #2563eb 100%);
          display: flex; flex-direction: column; padding: 48px;
          position: relative; overflow: hidden;
        }
        .panel-right {
          flex: 1; display: flex; align-items: center; justify-content: center;
          padding: 40px 24px; background: #f8fafc;
        }
        @media (max-width: 768px) {
          .panel-left { display: none !important; }
          .panel-right { width: 100%; }
        }
      `}</style>

      {/* ── PANEL IZQUIERDO — MARCA ── */}
      <div className="panel-left">
        {/* Círculo decorativo fondo */}
        <div style={{ position: 'absolute', bottom: '-80px', right: '-80px', width: '320px', height: '320px', borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ position: 'absolute', top: '-40px', left: '-60px', width: '200px', height: '200px', borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />

        {/* Logo en blanco */}
        <div style={{ marginBottom: 'auto' }}>
          <Image
            src="/logo-almacenero-digital-hd.png"
            alt="Almacenero Digital"
            width={280}
            height={90}
            priority
            style={{ height: '44px', width: 'auto', filter: 'brightness(0) invert(1)' }}
          />
        </div>

        {/* Ícono central */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '32px', marginBottom: 'auto' }}>
          <Image
            src="/foto-perfil-almacenero-digital.png"
            alt=""
            width={100}
            height={100}
            style={{ width: '90px', height: '90px', borderRadius: '20px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
          />
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.6rem', fontWeight: 800, lineHeight: 1.2, marginBottom: '12px' }}>
              Tu inventario,<br />bajo control.
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.9rem', lineHeight: 1.7, maxWidth: '280px' }}>
              Registrá ventas por voz o foto. Controlá stock en tiempo real. Desde cualquier sede, desde cualquier celular.
            </p>
          </div>

          {/* Bullets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {['Registro por voz e IA', 'Dashboard en tiempo real', 'Multi-sede sin límites'].map(item => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.85rem' }}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer del panel */}
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', marginTop: '40px' }}>
          © {new Date().getFullYear()} Almacenero Digital · Claro Comunica
        </div>
      </div>

      {/* ── PANEL DERECHO — FORMULARIO ── */}
      <div className="panel-right">
        <div className="login-fade" style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '32px' }}>

          {/* Logo mobile (solo visible en mobile) */}
          <div style={{ display: 'none' }} className="logo-mobile">
            <Image src="/logo-almacenero-digital-hd.png" alt="Almacenero Digital" width={220} height={70} priority style={{ height: '40px', width: 'auto' }} />
          </div>

          {mode === 'login' ? (
            <>
              <div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>Bienvenido</h1>
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Ingresá a tu cuenta para continuar</p>
              </div>

              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>Correo electrónico</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                      <Mail size={15} />
                    </span>
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="tu@correo.com" className="login-input" autoComplete="email" />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>Contraseña</label>
                    <button type="button" onClick={() => { setMode('reset'); setError('') }}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.78rem', color: '#2563eb', fontWeight: 500, fontFamily: 'inherit' }}>
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                      <Lock size={15} />
                    </span>
                    <input type={verClave ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" className="login-input" autoComplete="current-password" style={{ paddingRight: '42px' }} />
                    <button type="button" onClick={() => setVerClave(v => !v)}
                      aria-label={verClave ? 'Ocultar contraseña' : 'Ver contraseña'}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: '4px', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}>
                      {verClave ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', fontSize: '0.825rem', color: '#dc2626' }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="login-btn">
                  {loading ? 'Verificando...' : (<>Ingresar <ArrowRight size={16} /></>)}
                </button>
              </form>

            </>

          ) : resetSent ? (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle2 size={28} color="#16a34a" />
              </div>
              <div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>Revisá tu correo</div>
                <div style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.6 }}>
                  Te enviamos un link para restablecer tu contraseña.
                </div>
              </div>
              <button type="button" onClick={() => { setMode('login'); setResetSent(false) }} className="login-btn">
                Volver al inicio de sesión
              </button>
            </div>

          ) : (
            <>
              <div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>Recuperar contraseña</h1>
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Te enviamos un link para crear una nueva</p>
              </div>

              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>Correo electrónico</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                      <Mail size={15} />
                    </span>
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="tu@correo.com" className="login-input" autoComplete="email" />
                  </div>
                </div>

                {error && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', fontSize: '0.825rem', color: '#dc2626' }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="login-btn">
                  {loading ? 'Enviando...' : 'Enviar link de recuperación'}
                </button>
              </form>

              <button type="button" onClick={() => { setMode('login'); setError('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#64748b', textAlign: 'center', fontFamily: 'inherit' }}>
                ← Volver al inicio de sesión
              </button>
            </>
          )}
        </div>
      </div>

    </div>
  )
}
