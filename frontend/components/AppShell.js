'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

// El panel superadmin y la PWA AuditorIA son interfaces separadas: no muestran
// el sidebar del cliente (Dashboard, Movimientos, etc.) ni su margen reservado.
export default function AppShell({ children, empresa }) {
  const pathname = usePathname()

  if (pathname?.startsWith('/superadmin') || pathname?.startsWith('/auditoria')) {
    return <main style={{ minHeight: '100vh' }}>{children}</main>
  }

  return (
    <div className="layout-wrapper">
      <Sidebar empresa={empresa} />
      <main className="main-content">{children}</main>
    </div>
  )
}
