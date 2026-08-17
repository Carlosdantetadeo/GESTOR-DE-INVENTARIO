'use client'

// Home de Almacenero Digital (módulo de auditoría) — accesos según rol.
import Link from 'next/link'
import { useAuditoria } from './AuditoriaShell'
import { isVendedor, canSupervise, isAdmin } from '../../lib/auditoria/auth'
import { Page, T } from '../../lib/auditoria/ui'

const ROL_LABEL = { vendedor: 'Vendedor', supervisor: 'Supervisor', admin: 'Administrador' }

export default function AuditoriaHome() {
  const { session } = useAuditoria()
  const rol = session?.rol
  const vendedor = isVendedor(rol)
  const supervisa = canSupervise(rol)
  const admin = isAdmin(rol)

  const accesos = [
    vendedor && { href: '/auditoria/salidas', icon: '💰', label: 'Venta', desc: 'Registrar una venta' },
    supervisa && { href: '/auditoria/ingreso', icon: '📦', label: 'Ingreso', desc: 'Cargar mercadería' },
    supervisa && { href: '/auditoria/captura', icon: '🎤', label: 'Contar', desc: 'Auditar stock por voz' },
    supervisa && { href: '/auditoria/recepcion', icon: '📷', label: 'Recepción', desc: 'Leer una factura' },
    supervisa && { href: '/auditoria/supervisor', icon: '📊', label: 'Panel', desc: 'Sesiones y alertas' },
    admin && { href: '/auditoria/reportes', icon: '📈', label: 'Reportes', desc: 'Ventas por sede y vendedor' },
    admin && { href: '/auditoria/catalogo', icon: '⚙️', label: 'Administración', desc: 'Catálogo, sedes y usuarios' },
  ].filter(Boolean)

  return (
    <Page>
      <div style={{ margin: '8px 0 20px' }}>
        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', color: T.ink }}>
          Almacenero Digital
        </h1>
        <p style={{ margin: '4px 0 0', color: T.muted, fontSize: '0.92rem' }}>
          {ROL_LABEL[rol] ? `Hola, ${ROL_LABEL[rol]}. ` : ''}¿Qué querés hacer?
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        {accesos.map((a) => (
          <Link key={a.href} href={a.href} style={tile}>
            <span style={{ fontSize: '1.7rem', lineHeight: 1 }}>{a.icon}</span>
            <span style={{ fontWeight: 700, fontSize: '1.02rem', color: T.ink }}>{a.label}</span>
            <span style={{ fontSize: '0.8rem', color: T.muted }}>{a.desc}</span>
          </Link>
        ))}
      </div>
    </Page>
  )
}

const tile = {
  display: 'flex', flexDirection: 'column', gap: 6,
  padding: '18px 16px', borderRadius: 16,
  border: `1px solid ${T.line}`, background: '#fff',
  textDecoration: 'none', minHeight: 116,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
}
