// Sincronización del catálogo del tenant a IndexedDB para matching y semáforo
// offline. Se llama al login/arranque cuando hay red (SC-010).
import { getDB } from './db'
import { fetchCatalogo } from '../queries'
import { buscar } from '../matching'

export async function syncCatalogo() {
  const piezas = await fetchCatalogo()
  const db = await getDB()

  const tx = db.transaction('catalogo', 'readwrite')
  await tx.store.clear()
  for (const p of piezas) await tx.store.put({ producto_id: p.id, ...p })
  await tx.done

  await db.put('meta', {
    key: 'catalogo',
    last_sync_at: new Date().toISOString(),
    total: piezas.length,
  })
  return piezas.length
}

export async function getCatalogoLocal() {
  const db = await getDB()
  return db.getAll('catalogo')
}

// Búsqueda fuzzy sobre el catálogo local (offline). Devuelve [{ pieza, score }].
export async function buscarLocal(texto, opts) {
  const catalogo = await getCatalogoLocal()
  return buscar(texto, catalogo, opts)
}

export async function getCatalogoMeta() {
  const db = await getDB()
  return db.get('meta', 'catalogo')
}
