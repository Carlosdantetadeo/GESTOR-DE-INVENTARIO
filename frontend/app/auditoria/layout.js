// Layout de la sección AuditorIA (PWA de auditoría de inventario).
import AuditoriaShell from './AuditoriaShell'

export const metadata = {
  title: 'Almacenero Digital',
  description: 'Control de inventario por voz con semáforo',
  manifest: '/auditoria-manifest.json',
}

export const viewport = {
  themeColor: '#0d9488',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function AuditoriaLayout({ children }) {
  return <AuditoriaShell>{children}</AuditoriaShell>
}
