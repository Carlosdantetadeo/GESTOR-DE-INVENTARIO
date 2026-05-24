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
      padding: '24px 16px',
      zIndex: 100
    }}>
      {/* Brand Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '40px',
        padding: '0 8px'
      }}>
        <div style={{
          background: 'hsl(var(--accent))',
          padding: '8px',
          borderRadius: 'var(--radius-sm)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Building2 size={20} />
        </div>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{empresa.nombre}</h3>
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>Multi-Company Hub</span>
        </div>
      </div>

      {/* Nav Menu */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
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
                gap: '12px',
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                color: isActive ? '#fff' : 'hsl(var(--text-secondary))',
                background: isActive ? 'hsl(var(--accent))' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                fontSize: '0.9rem',
                transition: 'var(--transition)'
              }}
            >
              <Icon size={18} />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* User / Sign Out */}
      <div style={{
        borderTop: '1px solid hsl(var(--border))',
        paddingTop: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 8px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'hsl(var(--bg-card-hover))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.85rem',
            fontWeight: 700,
            border: '1px solid hsl(var(--border))'
          }}>
            CD
          </div>
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600 }}>Carlos Dante</h4>
            <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>carlosdantetadeo@gmail.com</span>
          </div>
        </div>

        <button className="btn btn-secondary" style={{
          width: '100%',
          padding: '10px',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }}>
          <LogOut size={16} />
          Cerrar Sesión
        </button>
      </div>
    </aside>
  )
}
