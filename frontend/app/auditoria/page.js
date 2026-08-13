// Home de Almacenero Digital (módulo de auditoría) — accesos principales.
import Link from 'next/link'

const botonStyle = {
  display: 'inline-block', padding: '12px 18px',
  background: '#0d9488', color: '#fff', borderRadius: 10,
  textDecoration: 'none', fontWeight: 600,
}

export default function AuditoriaHome() {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 8 }}>Almacenero Digital</h1>
      <p style={{ color: '#475569' }}>Control de inventario por voz.</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <Link href="/auditoria/captura" style={botonStyle}>🎤 Contar pieza</Link>
        <Link href="/auditoria/recepcion" style={botonStyle}>📷 Recepción</Link>
        <Link href="/auditoria/salidas" style={botonStyle}>💰 Salida</Link>
        <Link href="/auditoria/supervisor" style={{ ...botonStyle, background: '#0f172a' }}>📊 Panel supervisor</Link>
        <Link href="/auditoria/catalogo" style={{ ...botonStyle, background: '#334155' }}>⚙️ Administración</Link>
      </div>
    </main>
  )
}
