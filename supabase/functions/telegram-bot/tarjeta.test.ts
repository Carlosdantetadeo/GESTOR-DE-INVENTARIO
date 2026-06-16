// supabase/functions/telegram-bot/tarjeta.test.ts
// Tests unitarios del template de la tarjeta de revisión (sprint 018).
// Correr con: deno test supabase/functions/telegram-bot/tarjeta.test.ts

import { assertEquals, assertStringIncludes, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { construirTarjeta, type TarjetaPendiente } from './tarjeta.ts'

const base: TarjetaPendiente = {
  id: '11111111-2222-3333-4444-555555555555',
  channel: 'voz',
  tipo: 'venta',
  items: [
    { nombre: 'Tubo PVC 1"', cantidad: 5,  precio: 2.50 },
    { nombre: 'Codo PVC 1"', cantidad: 10, precio: 0.80 },
  ],
}

Deno.test('voz con cuenta regresiva: muestra tipo, ítems, total y la línea de countdown', () => {
  const { text } = construirTarjeta(base, { countdownSegundos: 5 })
  assertStringIncludes(text, '🧾 Revisa el registro')
  assertStringIncludes(text, 'Tipo: Venta (salida)')
  assertStringIncludes(text, '1. Tubo PVC 1" — 5 × S/2.50 = S/12.50')
  assertStringIncludes(text, '2. Codo PVC 1" — 10 × S/0.80 = S/8.00')
  assertStringIncludes(text, 'Total: S/ 20.50')
  assertStringIncludes(text, '⏱ Registrando en 5s')
})

Deno.test('foto: NUNCA muestra cuenta regresiva aunque se pase countdown', () => {
  const { text } = construirTarjeta({ ...base, channel: 'foto', tipo: 'compra' }, { countdownSegundos: 5 })
  assert(!text.includes('Registrando en'), 'la foto no debe tener countdown')
  assertStringIncludes(text, 'Tipo: Compra (entrada)')
})

Deno.test('voz/texto sin countdown: no muestra la línea (exige tap)', () => {
  const { text } = construirTarjeta(base)   // sin opciones
  assert(!text.includes('Registrando en'))
})

Deno.test('countdown 0 no muestra la línea', () => {
  const { text } = construirTarjeta(base, { countdownSegundos: 0 })
  assert(!text.includes('Registrando en'))
})

Deno.test('tipo null se muestra como —', () => {
  const { text } = construirTarjeta({ ...base, tipo: null })
  assertStringIncludes(text, 'Tipo: —')
})

Deno.test('total se deriva de los ítems (1 ítem)', () => {
  const { text } = construirTarjeta({
    ...base,
    items: [{ nombre: 'Tee PVC 1"', cantidad: 6, precio: 1.30 }],
  })
  assertStringIncludes(text, '1. Tee PVC 1" — 6 × S/1.30 = S/7.80')
  assertStringIncludes(text, 'Total: S/ 7.80')
})

Deno.test('callback_data usa el id del pendiente y entra en 64 bytes', () => {
  const { reply_markup } = construirTarjeta(base)
  const fila = reply_markup.inline_keyboard[0]
  assertEquals(fila.map(b => b.callback_data), [
    `corregir:${base.id}`,
    `confirmar:${base.id}`,
    `cancelar:${base.id}`,
  ])
  for (const b of fila) {
    assert(new TextEncoder().encode(b.callback_data).length <= 64, `${b.callback_data} excede 64 bytes`)
  }
})

Deno.test('los 3 botones presentes en una sola fila', () => {
  const { reply_markup } = construirTarjeta(base)
  assertEquals(reply_markup.inline_keyboard.length, 1)
  assertEquals(reply_markup.inline_keyboard[0].map(b => b.text), ['✏️ Corregir', '✅ Confirmar', '❌ Cancelar'])
})
