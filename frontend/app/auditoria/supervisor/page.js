'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuditoria } from '../AuditoriaShell'
import { canSupervise } from '../../../lib/auditoria/auth'
import { supabase } from '../../../lib/supabase'
import { Page, Title, Card, Note, T } from '../../../lib/auditoria/ui'

export default function SupervisorPage() {
  const { session } = useAuditoria()
  const [critico, setCritico] = useState({ agotados: [], bajo: [] })
  const [sinMovimiento, setSinMovimiento] = useState([])
  const [masVendidos, setMasVendidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      // ── Stock crítico ──────────────────────────────────────────────
      const { data: stockRows } = await supabase
        .from('stock')
        .select('cantidad, productos(id, nombre, stock_minimo)')

      const porProducto = {}
      ;(stockRows ?? []).forEach(row => {
        const p = row.productos
        if (!p) return
        if (!porProducto[p.id])
          porProducto[p.id] = { id: p.id, nombre: p.nombre, minimo: p.stock_minimo ?? 5, total: 0 }
        porProducto[p.id].total += row.cantidad ?? 0
      })
      const todos = Object.values(porProducto)
      const agotados = todos.filter(p => p.total <= 0)
      const bajo = todos.filter(p => p.total > 0 && p.total < p.minimo)

      // ── Sin movimiento (60+ días sin ventas) ──────────────────────
      const hace180 = new Date()
      hace180.setDate(hace180.getDate() - 180)
      const { data: ventasHistorial } = await supabase
        .from('movimientos')
        .select('producto_id, created_at')
        .eq('tipo', 'venta')
        .gte('created_at', hace180.toISOString())
        .order('created_at', { ascending: false })

      const ultimaVenta = {}
      ;(ventasHistorial ?? []).forEach(m => {
        if (!ultimaVenta[m.producto_id]) ultimaVenta[m.producto_id] = m.created_at
      })

      const hoy = new Date()
      const hace60 = new Date()
      hace60.setDate(hoy.getDate() - 60)

      const parados = todos
        .filter(p => p.total > 0)
        .filter(p => !ultimaVenta[p.id] || new Date(ultimaVenta[p.id]) < hace60)
        .map(p => ({
          ...p,
          diasParado: ultimaVenta[p.id]
            ? Math.floor((hoy - new Date(ultimaVenta[p.id])) / 86400000)
            : null,
        }))
        .sort((a, b) => (b.diasParado ?? 9999) - (a.diasParado ?? 9999))

      // ── Más vendidos (últimos 30 días) ────────────────────────────
      const hace30 = new Date()
      hace30.setDate(hace30.getDate() - 30)
      const { data: ventas30 } = await supabase
        .from('movimientos')
        .select('producto_id, cantidad, productos(nombre)')
        .eq('tipo', 'venta')
        .gte('created_at', hace30.toISOString())

      const vendidos = {}
      ;(ventas30 ?? []).forEach(m => {
        const nombre = m.productos?.nombre
        if (!nombre) return
        if (!vendidos[m.producto_id])
          vendidos[m.producto_id] = { id: m.producto_id, nombre, total: 0 }
        vendidos[m.producto_id].total += m.cantidad ?? 0
      })
      const ranking = Object.values(vendidos).sort((a, b) => b.total - a.total)

      setCritico({ agotados, bajo })
      setSinMovimiento(parados)
      setMasVendidos(ranking)
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
  }, [session, cargar])

  if (!session || cargando) return <Page><p style={{ color: T.muted }}>Cargando…</p></Page>
  if (!canSupervise(session.rol)) return <Page><p style={{ color: T.muted }}>No tienes permiso.</p></Page>

  const totalCritico = critico.agotados.length + critico.bajo.length

  return (
    <Page>
      <Title>Panel</Title>
      {error && <Note tone="error">{error}</Note>}

      {/* Stock crítico */}
      <Seccion
        titulo={`⚠️ Stock crítico${totalCritico > 0 ? ` (${totalCritico})` : ''}`}
        vacio={totalCritico === 0}
        mensajeVacio="Todo en orden — sin alertas de stock"
      >
        {critico.agotados.length > 0 && <>
          <Etiqueta>Agotados — {critico.agotados.length}</Etiqueta>
          {critico.agotados.map(p => (
            <Fila key={p.id} nombre={p.nombre}
              badge={{ texto: 'Sin stock', color: '#dc2626', bg: '#fef2f2' }} />
          ))}
        </>}
        {critico.bajo.length > 0 && <>
          <Etiqueta style={{ marginTop: critico.agotados.length > 0 ? 10 : 0 }}>
            Bajo mínimo — {critico.bajo.length}
          </Etiqueta>
          {critico.bajo.map(p => (
            <Fila key={p.id} nombre={p.nombre}
              badge={{ texto: `${p.total} / mín ${p.minimo}`, color: '#92400e', bg: '#fffbeb' }} />
          ))}
        </>}
        {totalCritico > 0 && (
          <Link href="/auditoria/inventario" style={{ display: 'block', marginTop: 10, fontSize: '0.82rem', color: T.primary, textDecoration: 'none', fontWeight: 600 }}>
            Ver inventario completo →
          </Link>
        )}
      </Seccion>

      {/* Sin movimiento */}
      <Seccion
        titulo={`📦 Sin ventas hace 60+ días (${sinMovimiento.length})`}
        vacio={sinMovimiento.length === 0}
        mensajeVacio="Todos los productos con stock tuvieron ventas recientes"
      >
        {sinMovimiento.map(p => (
          <Fila key={p.id} nombre={p.nombre}
            badge={{
              texto: p.diasParado != null ? `${p.diasParado} días parado` : 'Nunca vendido',
              color: '#6b7280', bg: '#f3f4f6',
            }} />
        ))}
      </Seccion>

      {/* Más vendidos */}
      <Seccion
        titulo={`🔥 Más vendidos — últimos 30 días (${masVendidos.length})`}
        vacio={masVendidos.length === 0}
        mensajeVacio="Sin ventas registradas en los últimos 30 días"
      >
        {masVendidos.map((p, i) => (
          <Fila key={p.id} nombre={p.nombre}
            izq={<span style={{ fontSize: '0.72rem', color: T.faint, marginRight: 6, fontWeight: 700 }}>#{i + 1}</span>}
            badge={{ texto: `${p.total} und`, color: '#065f46', bg: '#ecfdf5' }} />
        ))}
      </Seccion>
    </Page>
  )
}

function Seccion({ titulo, children, vacio, mensajeVacio }) {
  return (
    <Card style={{ marginTop: 14 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 700, color: T.ink }}>{titulo}</h3>
      {vacio
        ? <p style={{ color: T.faint, fontSize: '0.85rem', margin: 0 }}>{mensajeVacio}</p>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
      }
    </Card>
  )
}

function Etiqueta({ children, style }) {
  return (
    <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em', ...style }}>
      {children}
    </p>
  )
}

function Fila({ nombre, badge, izq }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: T.bg, borderRadius: 8 }}>
      {izq}
      <span style={{ fontSize: '0.88rem', color: T.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {nombre}
      </span>
      <span style={{ fontSize: '0.74rem', fontWeight: 600, color: badge.color, background: badge.bg, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {badge.texto}
      </span>
    </div>
  )
}
