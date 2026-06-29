// Preview del nuevo reporte de Telegram (handleReporte) con datos reales.
// Reusa la MISMA query + render que el bot, para validar el formato antes de probar en vivo.
//
//   deno run --allow-env --allow-net scripts/preview_reporte.ts [empresaNombre] [periodo]
//
// Env requeridas (no se commitean):
//   SUPABASE_URL         (o NEXT_PUBLIC_SUPABASE_URL)
//   SERVICE_ROLE_KEY     (service role — bypassa RLS, igual que el bot)
//
// periodo ∈ hoy | semana | mes  (default: mes, para tener más datos en el ejemplo)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('NEXT_PUBLIC_SUPABASE_URL') ?? ''
const KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
if (!URL || !KEY) {
  console.error('Falta SUPABASE_URL o SERVICE_ROLE_KEY en el entorno.')
  Deno.exit(1)
}
const supabase = createClient(URL, KEY, { auth: { persistSession: false } })

const empresaArg = Deno.args[0] ?? null
const periodo = (Deno.args[1] as 'hoy' | 'semana' | 'mes') ?? 'mes'

const PERU_OFFSET_MS = 5 * 60 * 60 * 1000
function inicioPeriodoPeru(p: 'hoy' | 'semana' | 'mes') {
  const ahora = new Date()
  const peruMs = ahora.getTime() - PERU_OFFSET_MS
  const peru = new Date(peruMs)
  const medianoche = Date.UTC(peru.getUTCFullYear(), peru.getUTCMonth(), peru.getUTCDate())
  const diasAtras = p === 'hoy' ? 0 : p === 'semana' ? 6 : 29
  const desdeMs = medianoche - diasAtras * 86400000 + PERU_OFFSET_MS
  const titulo = p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Últimos 7 días' : 'Últimos 30 días'
  return { desdeIso: new Date(desdeMs).toISOString(), titulo }
}

interface VentaRow {
  cantidad: number; total: number; tienda_origen: number | null
  usuario_id: number | null; productos: { nombre: string } | null
}

const mdSafe = (s: string) => s   // en consola no escapamos markdown

async function render(empresaId: string, tiendaId: number | null, vendedorId: number | null, etiqueta: string, sedeTxt = 'Todas', vendTxt = 'Todos') {
  const { desdeIso, titulo } = inicioPeriodoPeru(periodo)
  let q = supabase
    .from('movimientos')
    .select('cantidad, total, tienda_origen, usuario_id, productos!inner(nombre, empresa_id)')
    .eq('tipo', 'venta')
    .eq('productos.empresa_id', empresaId)
    .gte('created_at', desdeIso)
  if (tiendaId) q = q.eq('tienda_origen', tiendaId)
  if (vendedorId) q = q.eq('usuario_id', vendedorId)
  const { data: ventas } = await q as { data: VentaRow[] | null }

  console.log('\n' + '═'.repeat(48) + `\n  ESCENARIO: ${etiqueta}\n` + '═'.repeat(48))
  if (!ventas || ventas.length === 0) { console.log('📊 Sin ventas para este filtro.'); return }

  let totalVentas = 0
  const porProd = new Map<string, { cantidad: number; monto: number }>()
  for (const v of ventas) {
    const monto = Number(v.total ?? 0); totalVentas += monto
    const nombre = v.productos?.nombre ?? '—'
    const acc = porProd.get(nombre) ?? { cantidad: 0, monto: 0 }
    acc.cantidad += Number(v.cantidad ?? 0); acc.monto += monto
    porProd.set(nombre, acc)
  }
  const numVentas = ventas.length
  const ticket = totalVentas / numVentas

  const ventasList = ventas
  const MAX = 10, MAX_PROD = 15
  const medalla = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`)
  const renderDesglose = (enc: string, keyOf: (v: VentaRow) => number | null, nombres: Map<number, string>) => {
    const g = new Map<number, { monto: number; ventas: number }>()
    for (const v of ventasList) {
      const k = keyOf(v); if (k == null) continue
      const x = g.get(k) ?? { monto: 0, ventas: 0 }; x.monto += Number(v.total ?? 0); x.ventas += 1; g.set(k, x)
    }
    const ord = [...g.entries()].sort((a, b) => b[1].monto - a[1].monto)
    const filas = ord.slice(0, MAX).map(([k, x], i) =>
      `${medalla(i)} ${mdSafe(nombres.get(k) ?? '—')} — S/. ${x.monto.toFixed(2)} · ${x.ventas} ${x.ventas === 1 ? 'venta' : 'ventas'}`).join('\n')
    const mas = ord.length > MAX ? `\n…y ${ord.length - MAX} más` : ''
    return `${enc} (${ord.length}):*\n${filas}${mas}`
  }
  const prodOrden = [...porProd.entries()].sort((a, b) => b[1].monto - a[1].monto)
  const totalUnidades = prodOrden.reduce((s, [, p]) => s + p.cantidad, 0)
  const filasProd = prodOrden.slice(0, MAX_PROD).map(([n, p]) => `• ${mdSafe(n)} — ${p.cantidad} u. · S/. ${p.monto.toFixed(2)}`).join('\n')
  const masProd = prodOrden.length > MAX_PROD ? `\n…y ${prodOrden.length - MAX_PROD} más` : ''
  const bloqueProd = `📦 *Por producto (${prodOrden.length} ítem(s), ${totalUnidades} u.):*\n${filasProd}${masProd}`

  const hayFiltro = tiendaId != null || vendedorId != null
  let cuerpo: string
  if (hayFiltro) {
    cuerpo = bloqueProd
  } else {
    const nombresSede = new Map<number, string>(), nombresVend = new Map<number, string>()
    const [s, u] = await Promise.all([
      supabase.from('tiendas').select('id, nombre').eq('empresa_id', empresaId),
      supabase.from('usuarios').select('id, nombre').eq('empresa_id', empresaId),
    ])
    for (const t of (s.data ?? []) as Array<{ id: number; nombre: string | null }>) nombresSede.set(t.id, t.nombre ?? '—')
    for (const x of (u.data ?? []) as Array<{ id: number; nombre: string | null }>) nombresVend.set(x.id, x.nombre ?? '—')
    cuerpo = `${renderDesglose('🏪 *Por sede', v => v.tienda_origen, nombresSede)}\n\n${renderDesglose('🧑 *Por vendedor', v => v.usuario_id, nombresVend)}\n\n${bloqueProd}`
  }

  console.log(
    `📊 *Reporte de ventas*\n🗓️ ${titulo}\n🏪 Sede: *${sedeTxt}*\n🧑 Vendedor: *${vendTxt}*\n` +
    `────────────\n💰 Total vendido: *S/. ${totalVentas.toFixed(2)}*\n` +
    `🧾 N° de ventas: *${numVentas}*\n🎟️ Ticket promedio: *S/. ${ticket.toFixed(2)}*\n\n${cuerpo}`)
}

// Resolver empresa de test.
let empresaId: string, empresaNombre: string
{
  let qe = supabase.from('empresas').select('id, nombre').limit(1)
  if (empresaArg) qe = supabase.from('empresas').select('id, nombre').ilike('nombre', `%${empresaArg}%`).limit(1)
  const { data } = await qe.maybeSingle() as { data: { id: string; nombre: string } | null }
  if (!data) { console.error('No encontré la empresa.'); Deno.exit(1) }
  empresaId = data.id; empresaNombre = data.nombre
}
console.log(`Empresa: ${empresaNombre}  ·  periodo: ${periodo}`)

await render(empresaId, null, null, 'CONSOLIDADO (todas/todos)')

// Un ejemplo filtrado: la primera sede con ventas.
const { data: primeraSede } = await supabase
  .from('tiendas').select('id, nombre').eq('empresa_id', empresaId).limit(1).maybeSingle() as { data: { id: number; nombre: string } | null }
if (primeraSede) await render(empresaId, primeraSede.id, null, `FILTRADO por sede = ${primeraSede.nombre}`, primeraSede.nombre, 'Todos')
