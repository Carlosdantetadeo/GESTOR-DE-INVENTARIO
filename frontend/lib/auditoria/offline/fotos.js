// Flusher de la cola de fotos de evidencia (US5). Se registra junto al de
// conteos. Para cada foto resuelve el conteo real (por su client_op_id); si el
// conteo todavía no se sincronizó, lanza y se reintenta en el próximo flush.
import { flushStore } from './syncEngine'
import { getConteoIdByClientOp, subirEvidencia } from '../queries'

export const flushFotos = () =>
  flushStore('cola_fotos', async (item) => {
    const conteoId = await getConteoIdByClientOp(item.conteo_client_op_id)
    if (!conteoId) throw new Error('conteo aún no sincronizado')
    await subirEvidencia({
      clientOpId: item.client_op_id,
      empresaId: item.empresa_id,
      sesionId: item.sesion_id,
      conteoId,
      blob: item.blob,
    })
  })
