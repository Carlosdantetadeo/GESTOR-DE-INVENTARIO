'use client'

// Home de Almacenero Digital (módulo de auditoría) — accesos según rol.
import Link from 'next/link'
import { useAuditoria } from './AuditoriaShell'
import { isVendedor, canSupervise, isAdmin } from '../../lib/auditoria/auth'

export default function AuditoriaHome() {
  const { session } = useAuditoria()
  const rol = session?.rol
  const vendedor = isVendedor(rol)
  const supervisa = canSupervise(rol)
  const admin = isAdmin(rol)

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 8 }}>Almacenero Digital</h1>
      <p style={{ color: '#475569' }}>Control de inventario.</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        {/* Vendedor: solo registra ventas */}
        {vendedor && <Link href="/auditoria/salidas" style={botonStyle}>💰 Venta</Link>}
        {/* Supervisor (y admin): cuenta y mueve inventario */}
        {supervisa && <Link href="/auditoria/captura" style={botonStyle}>🎤 Contar</Link>}
        {supervisa && <Link href="/auditoria/ingreso" style={botonStyle}>📦 Ingreso</Link>}
        {supervisa && <Link href="/auditoria/recepcion" style={botonStyle}>📷 Recepción</Link>}
        {supervisa && <Link href="/auditoria/supervisor" style={{ ...botonStyle, background: '#0f172a' }}>📊 Panel</Link>}
        {/* Admin: reportes y configuración (no vende) */}
        {admin && <Link href="/auditoria/reportes" style={{ ...botonStyle, background: '#334155' }}>📈 Reportes</Link>}
        {admin && <Link href="/auditoria/catalogo" style={{ ...botonStyle, background: '#334155' }}>⚙️ Administración</Link>}
      </div>
    </main>
  )
}

const botonStyle = {
  display: 'inline-block', padding: '12px 18px',
  background: '#0d9488', color: '#fff', borderRadius: 10,
  textDecoration: 'none', fontWeight: 600,
}
