// Operaciones de bajo nivel sobre las colas de IndexedDB.
// Cada item se identifica por client_op_id (UUID) para idempotencia:
// un reintento de subida nunca duplica el registro en el servidor.
import { getDB } from './db'

// Agrega un item a una cola. Genera client_op_id si no viene.
export async function enqueue(storeName, item) {
  const withId = { ...item, client_op_id: item.client_op_id ?? crypto.randomUUID() }
  const db = await getDB()
  await db.put(storeName, withId)
  return withId
}

export async function listQueue(storeName) {
  const db = await getDB()
  return db.getAll(storeName)
}

export async function removeFromQueue(storeName, clientOpId) {
  const db = await getDB()
  await db.delete(storeName, clientOpId)
}

export async function countQueue(storeName) {
  const db = await getDB()
  return db.count(storeName)
}
