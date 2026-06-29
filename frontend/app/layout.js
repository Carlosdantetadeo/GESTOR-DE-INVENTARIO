import './globals.css'
import AppShell from '../components/AppShell'

export const metadata = {
  title: 'Almacenero Digital — Gestión de Inventario Inteligente',
  description: 'Almacenero Digital: registra ventas e inventario por voz en segundos y visualiza tu stock en tiempo real con inteligencia artificial.',
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
