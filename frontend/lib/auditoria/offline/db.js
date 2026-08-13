// IndexedDB de AuditorIA — almacenamiento local para operación offline.
// Stores (ver specs/002-auditoria-autopartes/contracts/sync-offline.md):
//   catalogo    → piezas + umbrales + ultima_salida_at (clave: producto_id)
//   cola_conteos → conteos pendientes de subir (clave: client_op_id)
//   cola_fotos   → blobs de evidencia + metadata (clave: client_op_id)
//   meta         → last_sync_at, sesion_activa (clave fija)
import { openDB } from 'idb'

const DB_NAME = 'auditoria'
const DB_VERSION = 1

export function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('catalogo')) {
        db.createObjectStore('catalogo', { keyPath: 'producto_id' })
      }
      if (!db.objectStoreNames.contains('cola_conteos')) {
        db.createObjectStore('cola_conteos', { keyPath: 'client_op_id' })
      }
      if (!db.objectStoreNames.contains('cola_fotos')) {
        db.createObjectStore('cola_fotos', { keyPath: 'client_op_id' })
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }
    },
  })
}
