'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Package,
  BarChart3,
  Users,
  Settings,
  LogOut,
  Menu,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function Sidebar({ empresa = { nombre: 'Inventario' } }) {
  const pathname = usePathname()
  const router = useRouter()
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [userInitials, setUserInitials] = useState('--')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      const email = user.email ?? ''
      setUserEmail(email)
      setUserInitials(email.slice(0, 2).toUpperCase())
    })
  }, [])

  const menuItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Movimientos', path: '/movimientos', icon: ArrowLeftRight },
    { name: 'Inventario', path: '/inventario', icon: Package },
    { name: 'Reportes', path: '/reportes', icon: BarChart3 },
    { name: 'Usuarios', path: '/admin/usuarios', icon: Users },
    { name: 'Configuración', path: '/admin/config', icon: Settings },
  ]

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const closeMobile = () => setIsMobileOpen(false)

  return (
    <>
      {/* Mobile hamburger trigger */}
      <button
        className="hamburger-btn"
        onClick={() => setIsMobileOpen(true)}
        aria-label="Abrir menú de navegación"
      >
        <Menu size={20} />
      </button>

      {/* Mobile backdrop overlay */}
      <div
        className={`sidebar-overlay${isMobileOpen ? ' sidebar-open' : ''}`}
        onClick={closeMobile}
        aria-hidden="true"
      />

      <aside className={`glass sidebar${isMobileOpen ? ' sidebar-open' : ''}`} style={{
        width: '260px',
        height: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid hsl(var(--border))',
        padding: '28px 16px 24px',
        zIndex: 100
      }}>
        {/* Brand */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '36px',
          padding: '0 8px',
          borderBottom: '1px solid hsl(var(--border))',
          paddingBottom: '24px'
        }}>
          <div style={{
            width: '34px', height: '34px',
            background: 'hsl(var(--accent))',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Package size={17} color="#fff" />
          </div>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{
              fontSize: '1rem',
              fontWeight: 700,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {empresa.nombre}
            </div>
            <span style={{
              fontSize: '0.72rem',
              color: 'hsl(var(--text-muted))'
            }}>
              Control de stock
            </span>
          </div>
          {/* Mobile close button */}
          <button
            onClick={closeMobile}
            aria-label="Cerrar menú"
            style={{
              display: 'none',
              background: 'none',
              border: 'none',
              color: 'hsl(var(--text-muted))',
              cursor: 'pointer',
              padding: '4px',
              flexShrink: 0
            }}
            className="sidebar-close-btn"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }} role="navigation" aria-label="Navegación principal">
          {menuItems.map((item) => {
            const isActive = pathname === item.path
            const Icon = item.icon

            return (
              <Link
                key={item.name}
                href={item.path}
                onClick={closeMobile}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-md)',
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'hsl(var(--accent))' : 'hsl(var(--text-secondary))',
                  background: isActive ? 'hsl(var(--accent) / 0.08)' : 'transparent',
                  transition: 'var(--transition)',
                }}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={16} strokeWidth={isActive ? 2.5 : 1.75} aria-hidden="true" />
                {item.name}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div style={{
          borderTop: '1px solid hsl(var(--border))',
          paddingTop: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 4px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              background: 'hsl(var(--bg-card-hover))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              fontWeight: 500,
              border: '1px solid hsl(var(--border))',
              flexShrink: 0
            }} aria-hidden="true">
              {userInitials}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                {userEmail || '…'}
              </span>
            </div>
          </div>

          <button
            className="btn btn-secondary"
            onClick={handleLogout}
            style={{ width: '100%', padding: '9px', fontSize: '0.8rem' }}
            aria-label="Cerrar sesión"
          >
            <LogOut size={14} aria-hidden="true" />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      <style jsx global>{`
        @media (max-width: 1024px) {
          .sidebar-close-btn {
            display: flex !important;
          }
        }
      `}</style>
    </>
  )
}
