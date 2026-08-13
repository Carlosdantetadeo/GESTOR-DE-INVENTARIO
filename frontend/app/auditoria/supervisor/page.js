'use client'

// Dashboard del supervisor (US3): estado del inventario auditado en tiempo real
// (conteos por color, alertas críticas), cierre de sesión con resumen y panel de
// piezas pendientes de aprobación. Scoped por empresa vía RLS.
import { useCallback, useEffect, useState } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { canSupervise } from '../../../lib/auditoria/auth'
import {
  supabase,
  getSesionesAbiertas,
  getConteosDeSesiones,
  cerrarSesion,
  getPiezasPendientes,
} from '../../../lib/auditoria/queries'

const COLOR_BG = { verde: '#16a34a', amarillo: '#f59e0b', rojo: '#ef4444' }

export default function SupervisorPage() {
  const { session } = useAuditoria()
  const [sesiones, setSesiones] = useState([])
  const [conteos, setConteos] = useState([])
  const [pendientes, setPendientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      const abiertas = await getSesionesAbiertas()
      const [cts, pend] = await Promise.all([
        getConteosDeSesiones(abiertas.map((s) => s.id)),
        getPiezasPendientes(),
      ])
      setSesiones(abiertas)
      setConteos(cts)
      setPendientes(pend)
      setError('')
    } catch {
      setError('No se pudieron cargar los datos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    if (!canSupervise(session.rol)) { setCargando(false); return }
    cargar()
    // Tiempo real: cualquier cambio en conteos o sesiones refresca (SC-006).
    // El refetch usa RLS, así que nunca trae datos de otro tenant.
    const ch = supabase
      .channel('supervisor-auditoria')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conteos' }, cargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sesiones_auditoria' }, cargar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session, cargar])

  async function cerrar(sesion) {
    const delaSesion = conteos.filter((c) => c.sesion_id === sesion.id)
    const por_color = { verde: 0, amarillo: 0, rojo: 0 }
    delaSesion.forEach((c) => { por_color[c.semaforo_color] += 1 })
    const resumen = { total: delaSesion.length, por_color }
    try {
      await cerrarSesion({ sesionId: sesion.id, resumen, uid: session.user.id })
      await cargar()
    } catch {
      setError('No se pudo cerrar la sesión.')
    }
  }

  if (!session) return <Cont><p>Cargando…</p></Cont>
  if (!canSupervise(session.rol)) {
    return <Cont><p>No tenés permiso para ver el panel del supervisor.</p></Cont>
  }
  if (cargando) return <Cont><p>Cargando panel…</p></Cont>

  const porColor = { verde: 0, amarillo: 0, rojo: 0 }
  conteos.forEach((c) => { porColor[c.semaforo_color] += 1 })
  const rojos = conteos.filter((c) => c.semaforo_color === 'rojo')

  return (
    <Cont>
      <h2 style={{ marginTop: 0 }}>Panel del supervisor</h2>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {/* Contadores por color */}
      <div style={{ display: 'flex', gap: 10 }}>
        {['rojo', 'amarillo', 'verde'].map((color) => (
          <div key={color} style={{ flex: 1, background: COLOR_BG[color], color: '#fff', borderRadius: 10, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{porColor[color]}</div>
            <div style={{ textTransform: 'capitalize', fontSize: '0.8rem' }}>{color}</div>
          </div>
        ))}
      </div>

      {/* Alertas críticas */}
      <Seccion titulo={`Alertas críticas (${rojos.length})`}>
        {rojos.length === 0 ? <Vacio>Sin piezas en rojo.</Vacio> : (
          <ul style={listaStyle}>
            {rojos.map((c) => (
              <li key={c.id} style={filaStyle}>
                <div><strong>{c.productos?.nombre ?? 'Pieza'}</strong> · {c.cantidad}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{c.semaforo_razon}</div>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* Sesiones abiertas */}
      <Seccion titulo={`Sesiones abiertas (${sesiones.length})`}>
        {sesiones.length === 0 ? <Vacio>No hay sesiones abiertas.</Vacio> : (
          <ul style={listaStyle}>
            {sesiones.map((s) => {
              const total = conteos.filter((c) => c.sesion_id === s.id).length
              return (
                <li key={s.id} style={{ ...filaStyle, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{s.tiendas?.nombre ?? `Sede ${s.tienda_id}`}</strong>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}> · {total} conteos</span>
                  </div>
                  <button onClick={() => cerrar(s)} style={btnCerrar}>Cerrar sesión</button>
                </li>
              )
            })}
          </ul>
        )}
      </Seccion>

      {/* Piezas pendientes de aprobación */}
      <Seccion titulo={`Piezas pendientes de aprobación (${pendientes.length})`}>
        {pendientes.length === 0 ? <Vacio>Sin piezas pendientes.</Vacio> : (
          <ul style={listaStyle}>
            {pendientes.map((p) => (
              <li key={p.id} style={filaStyle}>
                <strong>{p.descripcion_extraida}</strong>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  {p.cantidad ?? '—'} {p.unidad_sugerida ?? ''} · aprobación en US4
                </span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </Cont>
  )
}

function Cont({ children }) {
  return <main style={{ padding: 16, maxWidth: 640, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>{children}</main>
}
function Seccion({ titulo, children }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: '1rem', marginBottom: 8 }}>{titulo}</h3>
      {children}
    </section>
  )
}
function Vacio({ children }) {
  return <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{children}</p>
}

const listaStyle = { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }
const filaStyle = { display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }
const btnCerrar = { padding: '6px 12px', border: 'none', borderRadius: 8, background: '#0f172a', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' }
