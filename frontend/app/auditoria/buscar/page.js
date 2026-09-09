'use client'

import { useState, useCallback, useRef } from 'react'
import { useAuditoria } from '../AuditoriaShell'
import { buscarStockPorSede } from '../../../lib/auditoria/queries'
import { Page, Title, Input, Card, T } from '../../../lib/auditoria/ui'

export default function BuscarPage() {
  const { session } = useAuditoria()
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const buscar = useCallback((q) => {
    setTexto(q)
    setError('')
    clearTimeout(timerRef.current)
    if (!q.trim()) { setResultados([]); return }
    timerRef.current = setTimeout(async () => {
      setBuscando(true)
      try {
        const data = await buscarStockPorSede(q.trim())
        setResultados(data)
        if (!data.length) setError('Sin resultados para ese término.')
      } catch {
        setError('No se pudo buscar. Verificá la conexión.')
      } finally {
        setBuscando(false)
      }
    }, 350)
  }, [])

  if (!session) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>

  return (
    <Page>
      <Title>¿Dónde está?</Title>
      <p style={{ color: T.muted, fontSize: '0.9rem', marginTop: -8, marginBottom: 12 }}>
        Buscá una pieza y ves el stock en cada sede.
      </p>

      <Input
        value={texto}
        onChange={(e) => buscar(e.target.value)}
        placeholder="Nombre del producto…"
        autoFocus
      />

      {buscando && <p style={{ color: T.muted, fontSize: '0.9rem', marginTop: 12 }}>Buscando…</p>}
      {!buscando && error && <p style={{ color: T.muted, fontSize: '0.9rem', marginTop: 12 }}>{error}</p>}

      {!buscando && resultados.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
          {resultados.map((prod) => (
            <Card key={prod.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.02rem', color: T.ink }}>{prod.nombre}</div>
                {prod.referencia && <div style={{ fontSize: '0.82rem', color: T.muted }}>{prod.referencia}</div>}
              </div>

              {prod.sedes.length === 0 ? (
                <div style={{ fontSize: '0.88rem', color: T.muted }}>Sin stock registrado en ninguna sede.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {prod.sedes.map((s) => (
                    <div key={s.tiendaId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.9rem', color: T.ink }}>{s.nombre}</span>
                      <span style={stockChip(s.cantidad)}>{s.cantidad} und</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}

function stockChip(cantidad) {
  const base = { fontSize: '0.82rem', fontWeight: 700, padding: '3px 12px', borderRadius: 99, whiteSpace: 'nowrap' }
  if (cantidad <= 0) return { ...base, background: '#fee2e2', color: '#991b1b' }
  if (cantidad <= 5) return { ...base, background: '#fef3c7', color: '#92400e' }
  return { ...base, background: '#dcfce7', color: '#166534' }
}
