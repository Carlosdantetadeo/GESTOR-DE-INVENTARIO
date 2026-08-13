// Home de AuditorIA — accesos principales.
import Link from 'next/link'

export default function AuditoriaHome() {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 8 }}>Almacenero Digital</h1>
      <p style={{ color: '#475569' }}>Control de inventario por voz.</p>
      <Link
        href="/auditoria/captura"
        style={{
          display: 'inline-block', marginTop: 12, padding: '12px 18px',
          background: '#0d9488', color: '#fff', borderRadius: 10, textDecoration: 'none', fontWeight: 600,
        }}
      >
        🎤 Contar pieza
      </Link>
    </main>
  )
}
