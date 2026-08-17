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
  aprobarPieza,
  rechazarPieza,
  urlEvidencia,
} from '../../../lib/auditoria/queries'
import { Page, Title, Button, Card, Note, T } from '../../../lib/auditoria/ui'

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

  async function aprobar(pieza) {
    try {
      await aprobarPieza({ pieza, empresaId: session.empresaId, uid: session.user.id })
      await cargar()
    } catch {
      setError('No se pudo aprobar la pieza.')
    }
  }

  async function rechazar(pieza) {
    try {
      await rechazarPieza({ piezaId: pieza.id, uid: session.user.id })
      await cargar()
    } catch {
      setError('No se pudo rechazar la pieza.')
    }
  }

  async function verFoto(path) {
    const url = await urlEvidencia(path)
    if (url) window.open(url, '_blank', 'noopener')
    else setError('No se pudo abrir la foto.')
  }

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

  if (!session) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!canSupervise(session.rol)) return <Page><p style={{ color: T.muted }}>No tenés permiso para ver el panel del supervisor.</p></Page>
  if (cargando) return <Page><p style={{ color: T.muted }}>Cargando panel…</p></Page>

  const porColor = { verde: 0, amarillo: 0, rojo: 0 }
  conteos.forEach((c) => { porColor[c.semaforo_color] += 1 })
  const rojos = conteos.filter((c) => c.semaforo_color === 'rojo')

  return (
    <Page>
      <Title>Panel del supervisor</Title>
      {error && <Note tone="error">{error}</Note>}

      {/* Contadores por color */}
      <div style={{ display: 'flex', gap: 10 }}>
        {['rojo', 'amarillo', 'verde'].map((color) => (
          <div key={color} style={{ flex: 1, background: COLOR_BG[color], color: '#fff', borderRadius: 14, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{porColor[color]}</div>
            <div style={{ textTransform: 'capitalize', fontSize: '0.8rem', opacity: 0.9 }}>{color}</div>
          </div>
        ))}
      </div>

      <Panel titulo={`Alertas críticas (${rojos.length})`}>
        {rojos.length === 0 ? <Vacio>Sin piezas en rojo.</Vacio> : (
          <ul style={lista}>
            {rojos.map((c) => (
              <li key={c.id} style={{ ...fila, flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span><strong style={{ color: T.ink }}>{c.productos?.nombre ?? 'Pieza'}</strong> · {c.cantidad}</span>
                  {c.evidencias?.length > 0 && (
                    <Button variant="secondary" onClick={() => verFoto(c.evidencias[0].storage_path)} style={mini}>📷 Ver foto</Button>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: T.muted }}>{c.semaforo_razon}</div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel titulo={`Sesiones abiertas (${sesiones.length})`}>
        {sesiones.length === 0 ? <Vacio>No hay sesiones abiertas.</Vacio> : (
          <ul style={lista}>
            {sesiones.map((s) => {
              const total = conteos.filter((c) => c.sesion_id === s.id).length
              return (
                <li key={s.id} style={{ ...fila, justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ color: T.ink }}>{s.tiendas?.nombre ?? `Sede ${s.tienda_id}`}</strong>
                    <span style={{ color: T.muted, fontSize: '0.85rem' }}> · {total} conteos</span>
                  </div>
                  <Button variant="dark" onClick={() => cerrar(s)} style={mini}>Cerrar sesión</Button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel titulo={`Piezas pendientes de aprobación (${pendientes.length})`}>
        {pendientes.length === 0 ? <Vacio>Sin piezas pendientes.</Vacio> : (
          <ul style={lista}>
            {pendientes.map((p) => (
              <li key={p.id} style={{ ...fila, flexDirection: 'column', gap: 6 }}>
                <strong style={{ color: T.ink }}>{p.descripcion_extraida}</strong>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.8rem', color: T.muted }}>
                    {p.cantidad ?? '—'} {p.unidad_sugerida ?? ''}
                    {p.precio_unitario != null ? ` · ${p.precio_unitario}` : ''}
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <Button onClick={() => aprobar(p)} style={{ ...mini, background: '#16a34a', color: '#fff' }}>Aprobar</Button>
                    <Button variant="secondary" onClick={() => rechazar(p)} style={mini}>Rechazar</Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  )
}

function Panel({ titulo, children }) {
  return (
    <Card style={{ marginTop: 14 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: '1.02rem', color: T.ink }}>{titulo}</h3>
      {children}
    </Card>
  )
}
function Vacio({ children }) {
  return <p style={{ color: T.faint, fontSize: '0.85rem', margin: 0 }}>{children}</p>
}

const lista = { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }
const fila = { display: 'flex', padding: '10px 12px', border: `1px solid ${T.line}`, borderRadius: 10, background: '#fff' }
const mini = { minHeight: 'auto', padding: '6px 12px', fontSize: '0.8rem' }
