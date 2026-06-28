'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

// El panel superadmin es una interfaz separada: no muestra el sidebar del
// cliente (Dashboard, Movimientos, etc.) ni el margen reservado para él.
export default function AppShell({ children, empresa }) {
  const pathname = usePathname()

  if (pathname?.startsWith('/superadmin')) {
    return <main style={{ minHeight: '100vh' }}>{children}</main>
  }

  return (
    <div className="layout-wrapper">
      <Sidebar empresa={empresa} />
      <main className="main-content">{children}</main>
    </div>
  )
}
