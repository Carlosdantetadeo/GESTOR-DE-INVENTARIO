'use client'

// Reportes de ventas (solo admin): total del período, con desglose por TIENDA y
// por VENDEDOR. Distingue usuarios web (auth_uid → email) y operarios de Telegram
// (usuario_id → nombre). Datos vía RLS por empresa.
import { useCallback, useEffect, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { isAdmin } from '../../../lib/auditoria/auth'
import { getVentas, getUsuariosTelegram, getTiendas } from '../../../lib/auditoria/queries'

function hace(dias) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

export default function ReportesPage() {
  const { session } = useAuditoria()
  const [desde, setDesde] = useState(hace(30))
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10))
  const [porTienda, setPorTienda] = useState([])
  const [porVendedor, setPorVendedor] = useState([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const generar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const [ventas, tg, tiendas, resWeb] = await Promise.all([
        getVentas({ desde: `${desde}T00:00:00`, hasta: `${hasta}T23:59:59` }),
        getUsuariosTelegram(),
        getTiendas(),
        fetch('/api/auditoria/usuarios').then((r) => (r.ok ? r.json() : { usuarios: [] })),
      ])
      const nombreTg = new Map(tg.map((u) => [u.id, u.nombre || `Telegram ${u.id}`]))
      // Nombre del vendedor web (app_metadata.nombre); si no tiene, cae al email.
      const emailWeb = new Map((resWeb.usuarios || []).map((u) => [u.id, u.nombre || u.email]))
      const nombreTienda = new Map(tiendas.map((t) => [t.id, t.nombre || `Sede ${t.id}`]))

      const aggT = new Map()
      const aggV = new Map()
      let tot = 0
      for (const v of ventas) {
        const monto = Number(v.total || 0)
        tot += monto

        // Por tienda (sede de origen de la venta)
        const tKey = v.tienda_origen ?? 'sin'
        const tEtq = v.tienda_origen ? (nombreTienda.get(v.tienda_origen) || `Sede ${v.tienda_origen}`) : 'Sin sede'
        const at = aggT.get(tKey) || { etiqueta: tEtq, ventas: 0, unidades: 0, total: 0 }
        at.ventas += 1; at.unidades += v.cantidad || 0; at.total += monto
        aggT.set(tKey, at)

        // Por vendedor (web o Telegram)
        let vKey, vEtq
        if (v.auth_uid) { vKey = `web:${v.auth_uid}`; vEtq = emailWeb.get(v.auth_uid) || 'Usuario web (sin nombre)' }
        else if (v.usuario_id) { vKey = `tg:${v.usuario_id}`; vEtq = `📱 ${nombreTg.get(v.usuario_id) || v.usuario_id}` }
        else { vKey = 'sin'; vEtq = 'Sin vendedor' }
        const av = aggV.get(vKey) || { etiqueta: vEtq, ventas: 0, unidades: 0, total: 0 }
        av.ventas += 1; av.unidades += v.cantidad || 0; av.total += monto
        aggV.set(vKey, av)
      }
      const ordenar = (m) => [...m.values()].sort((a, b) => b.total - a.total)
      setPorTienda(ordenar(aggT))
      setPorVendedor(ordenar(aggV))
      setTotal(tot)
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

  return (
    <Cont>
      <h2 style={{ marginTop: 0 }}>Reporte de ventas</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={label}>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={inp} /></label>
        <label style={label}>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={inp} /></label>
        <button onClick={generar} style={btn}>Generar</button>
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {cargando ? <p>Calculando…</p> : (
        <>
          <div style={{ background: '#0f172a', color: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>Total vendido en el período</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{total.toFixed(2)}</div>
          </div>

          <Tabla titulo="Por tienda" filas={porTienda} col1="Tienda" />
          <Tabla titulo="Por vendedor" filas={porVendedor} col1="Vendedor" />
        </>
      )}
    </Cont>
  )
}

function Tabla({ titulo, filas, col1 }) {
  return (
    <section style={{ marginTop: 8, marginBottom: 20 }}>
      <h3 style={{ fontSize: '1rem', marginBottom: 8 }}>{titulo}</h3>
      {filas.length === 0 ? <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Sin ventas en el rango.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
              <th style={th}>{col1}</th>
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
          </tbody>
        </table>
      )}
    </section>
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
