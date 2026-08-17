// Kit de UI compartido del módulo Almacenero Digital (auditoría).
// Mobile-first: targets grandes, inputs a 16px (evita el zoom en iOS),
// paleta teal/slate consistente. Cada pantalla importa de acá para unificar
// botones, inputs, tipografía y espaciados.

export const T = {
  primary: '#0d9488',
  primaryDark: '#0f766e',
  ink: '#0f172a',
  text: '#1e293b',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#cbd5e1',
  line: '#e2e8f0',
  bg: '#f8fafc',
  danger: '#dc2626',
  dangerBorder: '#fecaca',
  radius: 12,
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

export function Page({ children }) {
  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto', fontFamily: T.font, color: T.text }}>
      {children}
    </main>
  )
}

export function Title({ children, sub }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.01em', color: T.ink }}>{children}</h2>
      {sub ? <p style={{ margin: '4px 0 0', color: T.muted, fontSize: '0.9rem' }}>{sub}</p> : null}
    </div>
  )
}

const btnBase = {
  border: 'none', borderRadius: T.radius, cursor: 'pointer', fontWeight: 600,
  fontSize: '1rem', minHeight: 46, padding: '11px 18px', lineHeight: 1.1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
const btnVariants = {
  primary: { background: T.primary, color: '#fff' },
  dark: { background: T.ink, color: '#fff' },
  secondary: { background: '#fff', color: T.ink, border: `1px solid ${T.border}` },
  danger: { background: '#fff', color: T.danger, border: `1px solid ${T.dangerBorder}` },
  ghost: { background: 'transparent', color: T.primary, minHeight: 'auto', padding: 4, fontSize: '0.85rem' },
}
export function Button({ variant = 'primary', full, style, ...props }) {
  const disabledStyle = props.disabled ? { opacity: 0.5, cursor: 'default' } : null
  return <button {...props} style={{ ...btnBase, ...btnVariants[variant], ...(full ? { width: '100%' } : null), ...disabledStyle, ...style }} />
}

export const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '12px 14px',
  border: `1px solid ${T.border}`, borderRadius: 10, fontSize: 16,
  background: '#fff', color: T.text, outline: 'none',
}
export function Input(props) { return <input {...props} style={{ ...inputStyle, ...props.style }} /> }
export function Select(props) { return <select {...props} style={{ ...inputStyle, ...props.style }} /> }

export function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', color: '#334155', fontWeight: 500 }}>
      {label}
      {children}
    </label>
  )
}

export function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: 14, background: '#fff', ...style }}>
      {children}
    </div>
  )
}

export function Note({ children, tone = 'info' }) {
  if (!children) return null
  return <p style={{ marginTop: 14, marginBottom: 0, color: tone === 'error' ? T.danger : T.primary, fontSize: '0.9rem' }}>{children}</p>
}
