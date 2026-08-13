// Motor de sincronización offline. Vacía las colas hacia el servidor cuando hay
// red. Se dispara en dos momentos (FR-017): al evento `online` del navegador y
// al arrancar la app (flush en arranque) — no depende solo de reintentos.
//
// Cada "flusher" es una función async que sube su propia cola y borra los items
// confirmados. El servidor deduplica por client_op_id, así que un doble flush
// concurrente (online + arranque a la vez) nunca duplica.
import { listQueue, removeFromQueue, countQueue } from './queue'

const flushers = []
let running = false

// Registra los flushers de cada historia (conteos, fotos, ...).
export function registerFlushers(fns) {
  for (const fn of fns) if (!flushers.includes(fn)) flushers.push(fn)
}

// Procesa una cola: por cada item llama a uploader(item); si resuelve OK, lo
// borra de la cola. Un error (típicamente red) deja el item para el próximo flush.
export async function flushStore(storeName, uploader) {
  const items = await listQueue(storeName)
  for (const item of items) {
    try {
      await uploader(item)
      await removeFromQueue(storeName, item.client_op_id)
    } catch {
      // Se reintenta en el próximo flush; no se rompe la cola.
    }
  }
}

// Corre todos los flushers registrados. Mutex simple para evitar solapamiento.
export async function flushAll() {
  if (running) return
  running = true
  try {
    for (const fn of flushers) await fn()
  } finally {
    running = false
  }
}

export async function pendingCount() {
  const [conteos, fotos, audios] = await Promise.all([
    countQueue('cola_conteos'),
    countQueue('cola_fotos'),
    countQueue('cola_audios'),
  ])
  return conteos + fotos + audios
}

// Engancha los disparadores. Devuelve una función de limpieza.
export function startSync() {
  const onOnline = () => { flushAll() }
  window.addEventListener('online', onOnline)
  // Flush en arranque (si ya hay red).
  if (navigator.onLine) flushAll()
  return () => window.removeEventListener('online', onOnline)
}
