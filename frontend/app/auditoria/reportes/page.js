'use client'

// Reporte de ventas por usuario registrado (solo admin). Agrega las ventas del
// rango por autor: usuarios web (auth_uid → email) y operarios de Telegram
// (usuario_id → nombre). Datos vía RLS por empresa.
import { useCallback, useEffect, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { isAdmin } from '../../../lib/auditoria/auth'
import { getVentas, getUsuariosTelegram } from '../../../lib/auditoria/queries'

function hace(dias) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

export default function ReportesPage() {
  const { session } = useAuditoria()
  const [desde, setDesde] = useState(hace(30))
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10))
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const generar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      // Resolver nombres: web (email) y Telegram (nombre).
      const [ventas, tg, resWeb] = await Promise.all([
        getVentas({ desde: `${desde}T00:00:00`, hasta: `${hasta}T23:59:59` }),
        getUsuariosTelegram(),
        fetch('/api/auditoria/usuarios').then((r) => (r.ok ? r.json() : { usuarios: [] })),
      ])
      const nombreTg = new Map(tg.map((u) => [u.id, u.nombre || `Telegram ${u.id}`]))
      const emailWeb = new Map((resWeb.usuarios || []).map((u) => [u.id, u.email]))

      const agg = new Map()
      for (const v of ventas) {
        let clave, etiqueta
        if (v.auth_uid) { clave = `web:${v.auth_uid}`; etiqueta = emailWeb.get(v.auth_uid) || 'Usuario web' }
        else if (v.usuario_id) { clave = `tg:${v.usuario_id}`; etiqueta = `📱 ${nombreTg.get(v.usuario_id) || v.usuario_id}` }
        else { clave = 'sin'; etiqueta = 'Sin autor' }
        const acc = agg.get(clave) || { etiqueta, ventas: 0, unidades: 0, total: 0 }
        acc.ventas += 1
        acc.unidades += v.cantidad || 0
        acc.total += Number(v.total || 0)
        agg.set(clave, acc)
      }
      setFilas([...agg.values()].sort((a, b) => b.total - a.total))
    } catch {
      setError('No se pudo generar el reporte.')
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  useEffect(() => {
    if (session && isAdmin(session.rol)) generar()
  }, [session, generar])

  if (!session) return <Cont><p>Cargando…</p></Cont>
  if (!isAdmin(session.rol)) return <Cont><p>Solo un administrador puede ver los reportes.</p></Cont>

  const totalGeneral = filas.reduce((s, f) => s + f.total, 0)

  return (
    <Cont>
      <h2 style={{ marginTop: 0 }}>Ventas por usuario</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <label style={label}>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={inp} /></label>
        <label style={label}>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={inp} /></label>
        <button onClick={generar} style={btn}>Generar</button>
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {cargando ? <p>Calculando…</p> : (
        filas.length === 0 ? <p style={{ color: '#94a3b8' }}>Sin ventas en el rango.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                <th style={th}>Usuario</th>
                <th style={{ ...th, textAlign: 'right' }}>Ventas</th>
                <th style={{ ...th, textAlign: 'right' }}>Unidades</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={td}>{f.etiqueta}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{f.ventas}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{f.unidades}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{f.total.toFixed(2)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: '2px solid #e2e8f0' }}>
                <td style={td}>Total</td>
                <td style={td}></td>
                <td style={td}></td>
                <td style={{ ...td, textAlign: 'right' }}>{totalGeneral.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        )
      )}
    </Cont>
  )
}

function Cont({ children }) {
  return <main style={{ padding: 16, maxWidth: 680, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>{children}</main>
}
const inp = { padding: '9px 11px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: '0.95rem' }
const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#334155' }
const btn = { padding: '9px 16px', border: 'none', borderRadius: 8, background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 600 }
const th = { padding: '8px 6px' }
const td = { padding: '8px 6px' }
