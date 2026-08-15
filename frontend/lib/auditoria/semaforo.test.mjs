// Tests del motor de semáforo (contrato: contracts/semaforo.md).
// Correr con:  node --test frontend/lib/auditoria/semaforo.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluarSemaforo } from './semaforo.js'

const ahora = new Date('2026-08-13T00:00:00Z')
const cfg = { ahora, meses_stock_muerto: 6 }
const haceMeses = (m) => new Date(ahora.getTime() - m * 30.4375 * 24 * 3600 * 1000).toISOString()

test('1 - quiebre de stock (bajo mínimo) → rojo', () => {
  const r = evaluarSemaforo({ stock_minimo: 5, punto_reorden: 0 }, { cantidad: 2, estado_fisico: 'integra' }, cfg)
  assert.equal(r.color, 'rojo')
  assert.match(r.razon, /quiebre/)
})

test('2 - daño físico gana sobre stock sano → rojo', () => {
  const r = evaluarSemaforo({ stock_minimo: 5, punto_reorden: 0 }, { cantidad: 100, estado_fisico: 'danada_oxidada' }, cfg)
  assert.equal(r.color, 'rojo')
  assert.match(r.razon, /daño/)
})

test('3 - bajo punto de reorden → amarillo', () => {
  const r = evaluarSemaforo({ stock_minimo: 5, punto_reorden: 10 }, { cantidad: 8, estado_fisico: 'integra' }, cfg)
  assert.equal(r.color, 'amarillo')
  assert.match(r.razon, /reorden/)
})

test('4 - stock muerto (8 meses sin salida) → amarillo', () => {
  const r = evaluarSemaforo(
    { stock_minimo: 5, punto_reorden: 10, ultima_salida_at: haceMeses(8) },
    { cantidad: 50, estado_fisico: 'integra' },
    cfg,
  )
  assert.equal(r.color, 'amarillo')
  assert.match(r.razon, /rotaci|muerto/)
})

test('5 - stock sano con rotación reciente → verde', () => {
  const r = evaluarSemaforo(
    { stock_minimo: 5, punto_reorden: 10, ultima_salida_at: haceMeses(1) },
    { cantidad: 50, estado_fisico: 'integra' },
    cfg,
  )
  assert.equal(r.color, 'verde')
})

test('6 - deterioro menor con stock sano → amarillo', () => {
  const r = evaluarSemaforo({ stock_minimo: 5, punto_reorden: 10 }, { cantidad: 50, estado_fisico: 'deterioro_menor' }, cfg)
  assert.equal(r.color, 'amarillo')
  assert.match(r.razon, /deterioro/)
})

test('7 - sin umbrales definidos → solo estado físico (verde)', () => {
  const r = evaluarSemaforo({ stock_minimo: 0, punto_reorden: 0 }, { cantidad: 0, estado_fisico: 'integra' }, cfg)
  assert.equal(r.color, 'verde')
})

test('8 - sobrestock (cantidad > máximo) → amarillo', () => {
  const r = evaluarSemaforo({ stock_minimo: 5, punto_reorden: 10, stock_maximo: 100 }, { cantidad: 200, estado_fisico: 'integra' }, cfg)
  assert.equal(r.color, 'amarillo')
  assert.match(r.razon, /sobrestock/)
})
