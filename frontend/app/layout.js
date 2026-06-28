import './globals.css'
import AppShell from '../components/AppShell'

export const metadata = {
  title: 'AGENT GMS - Dashboard Inteligente Bsale',
  description: 'Visualiza tus transacciones y stock en tiempo real con inteligencia artificial',
}

export default function RootLayout({ children }) {
  // Datos simulados de la empresa logueada
  const empresaDemo = {
    nombre: 'Inventario'
  }

  return (
    <html lang="es">
      <body>
        <AppShell empresa={empresaDemo}>{children}</AppShell>
      </body>
    </html>
  )
}
