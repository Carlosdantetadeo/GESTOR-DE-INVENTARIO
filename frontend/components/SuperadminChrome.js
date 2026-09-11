'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Cpu, LogOut, ShieldCheck, BarChart2 } from 'lucide-react'

export default function SuperadminChrome({ children }) {
  const pathname = usePathname()

  if (pathname === '/superadmin/login') {
    return <>{children}</>
  }

  const isEmpresas = pathname === '/superadmin'
  const isModelos  = pathname.startsWith('/superadmin/modelos')
  const isConsumo  = pathname.startsWith('/superadmin/consumo')

  const navLinkStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px',
    borderRadius: 'var(--radius-md)', textDecoration: 'none', fontSize: '0.9rem',
    fontWeight: active ? 600 : 400,
    color: active ? 'hsl(var(--accent))' : 'hsl(var(--text-secondary))',
    background: active ? 'hsl(var(--accent) / 0.08)' : 'transparent',
    whiteSpace: 'nowrap',
  })

  return (
    <>
      <style>{`
        .sa-layout { display: flex; min-height: 100vh; }
        .sa-sidebar {
          width: 240px; position: fixed; top: 0; left: 0; height: 100vh;
          display: flex; flex-direction: column; padding: 24px 16px;
          border-right: 1px solid hsl(var(--border)); z-index: 100;
        }
        .sa-main { flex: 1; margin-left: 240px; padding: 32px; }
        .sa-topbar { display: none; }

        @media (max-width: 640px) {
          .sa-sidebar { display: none; }
          .sa-main { margin-left: 0; padding: 16px; padding-top: 72px; }
          .sa-topbar {
            display: flex; align-items: center; justify-content: space-between;
            position: fixed; top: 0; left: 0; right: 0; z-index: 100;
            padding: 0 16px; height: 56px;
            border-bottom: 1px solid hsl(var(--border));
            background: hsl(var(--bg-glass) / 0.95);
            backdrop-filter: blur(12px);
          }
          .sa-topbar-brand { display: flex; align-items: center; gap: 8px; }
          .sa-topbar-nav { display: flex; align-items: center; gap: 4px; }
        }
      `}</style>

      {/* Barra superior — solo mobile */}
      <header className="sa-topbar glass">
        <div className="sa-topbar-brand">
          <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-md)', background: 'hsl(var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ShieldCheck size={15} color="#fff" />
          </div>
          <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>Superadmin</span>
        </div>
        <nav className="sa-topbar-nav">
          <Link href="/superadmin" style={navLinkStyle(isEmpresas)}><Building2 size={15} /> Empresas</Link>
          <Link href="/superadmin/modelos" style={navLinkStyle(isModelos)}><Cpu size={15} /> Modelos</Link>
          <Link href="/superadmin/consumo" style={navLinkStyle(isConsumo)}><BarChart2 size={15} /> Consumo</Link>
          <a href="/api/superadmin/logout" style={{ ...navLinkStyle(false), color: 'hsl(var(--color-gasto))' }}><LogOut size={15} /></a>
        </nav>
      </header>

      <div className="sa-layout">
        {/* Sidebar — solo desktop */}
        <aside className="sa-sidebar glass">
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
            <Link href="/superadmin" style={navLinkStyle(isEmpresas)}><Building2 size={16} /> Empresas</Link>
            <Link href="/superadmin/modelos" style={navLinkStyle(isModelos)}><Cpu size={16} /> Modelos</Link>
            <Link href="/superadmin/consumo" style={navLinkStyle(isConsumo)}><BarChart2 size={16} /> Consumo</Link>
          </nav>

          <a href="/api/superadmin/logout" className="btn btn-secondary" style={{ width: '100%', padding: '9px', fontSize: '0.8rem', textDecoration: 'none', justifyContent: 'center' }}>
            <LogOut size={14} /> Salir
          </a>
        </aside>

        <div className="sa-main">
          {children}
        </div>
      </div>
    </>
  )
}
