'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, LogOut, ShieldCheck } from 'lucide-react'

// Navegación propia del superadmin. En /superadmin/login se renderiza sin sidebar.
export default function SuperadminChrome({ children }) {
  const pathname = usePathname()

  if (pathname === '/superadmin/login') {
    return <>{children}</>
  }

  const isEmpresas = pathname === '/superadmin'

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside className="glass" style={{
        width: '240px', position: 'fixed', top: 0, left: 0, height: '100vh',
        display: 'flex', flexDirection: 'column', padding: '24px 16px',
        borderRight: '1px solid hsl(var(--border))', zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px', paddingBottom: '20px', borderBottom: '1px solid hsl(var(--border))' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-md)', background: 'hsl(var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ShieldCheck size={17} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.1 }}>Superadmin</div>
            <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>Claro Comunica</span>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
          <Link href="/superadmin" style={{
            display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px',
            borderRadius: 'var(--radius-md)', textDecoration: 'none', fontSize: '0.9rem',
            fontWeight: isEmpresas ? 600 : 400,
            color: isEmpresas ? 'hsl(var(--accent))' : 'hsl(var(--text-secondary))',
            background: isEmpresas ? 'hsl(var(--accent) / 0.08)' : 'transparent',
          }}>
            <Building2 size={16} /> Empresas
          </Link>
        </nav>

        <a href="/api/superadmin/logout" className="btn btn-secondary" style={{ width: '100%', padding: '9px', fontSize: '0.8rem', textDecoration: 'none', justifyContent: 'center' }}>
          <LogOut size={14} /> Salir
        </a>
      </aside>

      <div style={{ flex: 1, marginLeft: '240px', padding: '32px' }}>
        {children}
      </div>
    </div>
  )
}
