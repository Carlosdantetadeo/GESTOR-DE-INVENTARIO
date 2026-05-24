'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  Package, 
  BarChart3, 
  Users, 
  Settings, 
  LogOut,
  Building2
} from 'lucide-react'

export default function Sidebar({ empresa = { nombre: 'Empresa Demo GMS' } }) {
  const pathname = usePathname()

  const menuItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Movimientos', path: '/movimientos', icon: ArrowLeftRight },
    { name: 'Inventario', path: '/inventario', icon: Package },
    { name: 'Reportes', path: '/reportes', icon: BarChart3 },
    { name: 'Usuarios', path: '/admin/usuarios', icon: Users },
    { name: 'Configuración', path: '/admin/config', icon: Settings },
  ]

  return (
    <aside className="glass" style={{
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
          background: 'hsl(var(--accent))',
          padding: '7px',
          borderRadius: 'var(--radius-sm)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <Building2 size={18} />
        </div>
        <div style={{ overflow: 'hidden' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {empresa.nombre}
          </div>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            color: 'hsl(var(--accent))',
            letterSpacing: '0.1em',
            textTransform: 'uppercase'
          }}>
            SYS · OPERATIVO
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
        {menuItems.map((item) => {
          const isActive = pathname === item.path
          const Icon = item.icon

          return (
            <Link
              key={item.name}
              href={item.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                fontFamily: 'var(--font-display)',
                fontSize: '0.95rem',
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: isActive ? '#fff' : 'hsl(var(--text-muted))',
                background: isActive ? 'hsl(var(--accent))' : 'transparent',
                borderLeft: isActive ? '3px solid hsl(var(--accent-light))' : '3px solid transparent',
                transition: 'var(--transition)',
                boxShadow: isActive ? '0 2px 12px hsl(var(--accent) / 0.3)' : 'none'
              }}
            >
              <Icon size={16} strokeWidth={isActive ? 2.5 : 1.75} />
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
          }}>
            CD
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Carlos Dante
            </div>
            <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
              carlosdantetadeo@gmail.com
            </span>
          </div>
        </div>

        <button className="btn btn-secondary" style={{
          width: '100%',
          padding: '9px',
          fontSize: '0.8rem'
        }}>
          <LogOut size={14} />
          Cerrar Sesión
        </button>
      </div>
    </aside>
  )
}
