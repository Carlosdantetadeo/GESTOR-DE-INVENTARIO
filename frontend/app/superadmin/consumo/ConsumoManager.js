'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download, ChevronLeft, ChevronRight, Save, X } from 'lucide-react'

const ACCIONES = ['solo_avisar', 'bloquear', 'degradar']

function mesLabel(iso) {
  const [y, m] = iso.split('-')
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

function mesActual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function mesAnterior(iso) {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function mesSiguiente(iso) {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function BarraGasto({ pct }) {
  const clamped = Math.min(pct, 100)
  const color = pct >= 100 ? 'hsl(var(--color-gasto))' : pct >= 80 ? 'hsl(45 90% 50%)' : 'hsl(var(--color-entrada))'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'hsl(var(--border))' }}>
        <div style={{ width: `${clamped}%`, height: '100%', borderRadius: '3px', background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '0.75rem', color: pct >= 100 ? 'hsl(var(--color-gasto))' : pct >= 80 ? 'hsl(45 90% 50%)' : 'hsl(var(--text-muted))', minWidth: '38px', textAlign: 'right' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

export default function ConsumoManager({ modelosDisponibles = [] }) {
  const [mes, setMes] = useState(mesActual)
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState(null) // empresa_id
  const [formLimite, setFormLimite] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(async (m) => {
    setCargando(true)
    setError('')
    try {
      const r = await fetch(`/api/superadmin/consumo?mes=${m}`)
      const data = await r.json()
      if (!data.ok) throw new Error(data.message)
      setFilas(data.consumo || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar(mes) }, [mes, cargar])

  function iniciarEdicion(fila) {
    setEditando(fila.empresa_id)
    setFormLimite({
      limite_mensual_usd: fila.limite_mensual_usd ?? 10,
      accion_al_superar: fila.accion_al_superar ?? 'solo_avisar',
      modelo_degradado_id: fila.modelo_degradado_id ?? '',
      alerta_al_pct: fila.alerta_al_pct ?? 80,
    })
  }

  async function guardarLimite(empresa_id) {
    setGuardando(true)
    try {
      const r = await fetch('/api/superadmin/consumo/limites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id, ...formLimite }),
      })
      const data = await r.json()
      if (!data.ok) throw new Error(data.message)
      setEditando(null)
      await cargar(mes)
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  function exportarCSV() {
    const cabecera = ['empresa', 'modelo', 'tokens_entrada', 'tokens_salida', 'costo_usd', 'limite_usd', 'pct_usado', 'accion_al_superar']
    const filasCsv = filas.map(f => [
      f.empresa_nombre,
      f.modelo,
      f.tokens_entrada,
      f.tokens_salida,
      f.costo_usd.toFixed(4),
      f.limite_mensual_usd ?? '',
      f.limite_mensual_usd ? ((f.costo_usd / f.limite_mensual_usd) * 100).toFixed(1) : '',
      f.accion_al_superar ?? '',
    ])
    const csv = [cabecera, ...filasCsv].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `consumo-ia-${mes}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const esMesActual = mes === mesActual()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Consumo IA</h1>
          <p style={{ margin: 0, color: 'hsl(var(--text-muted))', fontSize: '0.85rem' }}>Gasto mensual por empresa · límites y alertas</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Navegador de mes */}
          <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => setMes(mesAnterior(mes))}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, minWidth: '140px', textAlign: 'center' }}>
            {mesLabel(mes)}
          </span>
          <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => setMes(mesSiguiente(mes))} disabled={esMesActual}>
            <ChevronRight size={16} />
          </button>

          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }} onClick={exportarCSV} disabled={filas.length === 0}>
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: '12px 16px', color: 'hsl(var(--color-gasto))', marginBottom: '16px', border: '1px solid hsl(var(--color-gasto) / 0.3)' }}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'hsl(var(--text-muted))' }}>Cargando…</div>
      ) : filas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'hsl(var(--text-muted))' }}>Sin consumo registrado para este mes.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                  {['Empresa', 'Modelo', 'Tokens entrada', 'Tokens salida', 'Costo mes', 'Límite USD', '% usado', 'Acción', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--text-secondary))', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map(fila => {
                  const pct = fila.limite_mensual_usd ? (fila.costo_usd / fila.limite_mensual_usd) * 100 : 0
                  const esEditando = editando === fila.empresa_id

                  return (
                    <tr key={fila.empresa_id + (fila.modelo || '')} style={{ borderBottom: '1px solid hsl(var(--border))', verticalAlign: 'middle' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500 }}>{fila.empresa_nombre}</td>
                      <td style={{ padding: '10px 14px', color: 'hsl(var(--text-secondary))' }}>{fila.modelo || '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fila.tokens_entrada?.toLocaleString('es-AR') ?? '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fila.tokens_salida?.toLocaleString('es-AR') ?? '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>${fila.costo_usd.toFixed(4)}</td>

                      {esEditando ? (
                        <>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="number" min="0" step="0.01"
                              value={formLimite.limite_mensual_usd}
                              onChange={e => setFormLimite(f => ({ ...f, limite_mensual_usd: e.target.value }))}
                              style={{ width: '80px', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-secondary))', fontSize: '0.85rem' }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="number" min="0" max="100"
                              value={formLimite.alerta_al_pct}
                              onChange={e => setFormLimite(f => ({ ...f, alerta_al_pct: e.target.value }))}
                              style={{ width: '60px', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-secondary))', fontSize: '0.85rem' }}
                              placeholder="% alerta"
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <select
                              value={formLimite.accion_al_superar}
                              onChange={e => setFormLimite(f => ({ ...f, accion_al_superar: e.target.value }))}
                              style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-secondary))', fontSize: '0.85rem' }}
                            >
                              {ACCIONES.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                            {formLimite.accion_al_superar === 'degradar' && (
                              <select
                                value={formLimite.modelo_degradado_id}
                                onChange={e => setFormLimite(f => ({ ...f, modelo_degradado_id: e.target.value }))}
                                style={{ marginTop: '4px', display: 'block', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-secondary))', fontSize: '0.85rem' }}
                              >
                                <option value="">— sin modelo —</option>
                                {modelosDisponibles.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                              </select>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                            <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '0.8rem', marginRight: '4px' }} onClick={() => guardarLimite(fila.empresa_id)} disabled={guardando}>
                              <Save size={12} /> Guardar
                            </button>
                            <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setEditando(null)}>
                              <X size={12} />
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            {fila.limite_mensual_usd ? `$${Number(fila.limite_mensual_usd).toFixed(2)}` : <span style={{ color: 'hsl(var(--text-muted))' }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px', minWidth: '130px' }}>
                            {fila.limite_mensual_usd ? <BarraGasto pct={pct} /> : <span style={{ color: 'hsl(var(--text-muted))' }}>sin límite</span>}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>{fila.accion_al_superar ?? '—'}</span>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => iniciarEdicion(fila)}>
                              Editar límite
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
