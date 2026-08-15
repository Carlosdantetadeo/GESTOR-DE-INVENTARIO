// Notas de voz capturadas sin conexión (FR-016/017/018). El audio se guarda
// con su mimeType SIN convertir. Al reconectar se transcribe (flush en `online`
// y en arranque) y queda listo para que el auditor complete el conteo. La UI
// nunca muestra "registrado" hasta que el auditor confirma.
import { getDB } from './db'

export async function encolarAudio({ blob, mimeType }) {
  const db = await getDB()
  const item = {
    client_op_id: crypto.randomUUID(),
    blob,
    mimeType,
    transcripcion: null,
    created_at: new Date().toISOString(),
  }
  await db.put('cola_audios', item)
  return item
}

export async function listAudios() {
  const db = await getDB()
  return db.getAll('cola_audios')
}

export async function removeAudio(clientOpId) {
  const db = await getDB()
  await db.delete('cola_audios', clientOpId)
}

async function updateAudio(item) {
  const db = await getDB()
  await db.put('cola_audios', item)
}

// Transcribe las notas pendientes (sin transcripción). No las borra: quedan
// "transcritas" para que el auditor las use y complete el conteo.
export const flushAudios = async () => {
  const pendientes = (await listAudios()).filter((a) => !a.transcripcion)
  for (const a of pendientes) {
    try {
      const fd = new FormData()
      fd.append('audio', a.blob, 'audio')
      const res = await fetch('/api/auditoria/transcribir', { method: 'POST', body: fd })
      if (res.ok) {
        const { texto } = await res.json()
        await updateAudio({ ...a, transcripcion: texto || '' })
      }
    } catch {
      // Se reintenta en el próximo flush.
    }
  }
}
