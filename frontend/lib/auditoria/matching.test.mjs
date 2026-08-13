// Tests del matching fuzzy on-device.
// Correr con:  node --test frontend/lib/auditoria/matching.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscar, normalizar, similitud } from './matching.js'

const catalogo = [
  { id: 1, nombre: 'Amortiguador Delantero Corolla', referencia: 'AMD-001' },
  { id: 2, nombre: 'Amortiguador Trasero Corolla', referencia: 'AMT-002' },
  { id: 3, nombre: 'Filtro de Aceite', referencia: 'FIL-010' },
]

test('normaliza acentos y mayúsculas', () => {
  assert.equal(normalizar('Bujía NGK'), 'bujia ngk')
})

test('encuentra por nombre aproximado', () => {
  const r = buscar('amortiguador delantero', catalogo)
  assert.equal(r[0].pieza.id, 1)
})

test('referencia exacta gana', () => {
  const r = buscar('FIL-010', catalogo)
  assert.equal(r[0].pieza.id, 3)
  assert.equal(r[0].score, 1)
})

test('devuelve top-3 como máximo', () => {
  const r = buscar('amortiguador', catalogo, { limite: 3 })
  assert.ok(r.length <= 3)
  assert.ok(r.length >= 2)
})

test('sin coincidencia devuelve vacío', () => {
  assert.deepEqual(buscar('xyz123nada', catalogo), [])
})

test('similitud idéntica es 1', () => {
  assert.equal(similitud('filtro', 'filtro'), 1)
})
