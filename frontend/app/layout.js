import './globals.css'
import AppShell from '../components/AppShell'

export const metadata = {
  metadataBase: new URL('https://dashboard.almacenero.digital'),
  title: 'Almacenero Digital',
  description: 'Control de inventario y ventas para tu negocio',
  openGraph: {
    title: 'Almacenero Digital',
    description: 'Control de inventario y ventas para tu negocio',
    url: 'https://dashboard.almacenero.digital',
    siteName: 'Almacenero Digital',
    type: 'website',
    locale: 'es_PE',
  },
  twitter: {
    card: 'summary',
    title: 'Almacenero Digital',
    description: 'Control de inventario y ventas para tu negocio',
  },
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
