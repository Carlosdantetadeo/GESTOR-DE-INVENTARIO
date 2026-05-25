import './globals.css'
import Sidebar from '../components/Sidebar'

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
        <div className="layout-wrapper">
          <Sidebar empresa={empresaDemo} />
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
