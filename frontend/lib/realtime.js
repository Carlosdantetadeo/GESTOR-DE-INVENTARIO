import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Hook para escuchar nuevos movimientos de forma activa en tiempo real.
 * Se gatilla cada vez que el operario de Telegram/n8n inserta un nuevo registro.
 */
export function useRealtimeMovimientos(empresaId, onNewMovimiento) {
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!empresaId) return

    // Suscribirse a cambios en la tabla movimientos
    const channel = supabase
      .channel('public:movimientos')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'movimientos' },
        async (payload) => {
          // Obtener el registro completo con relaciones (tienda, producto)
          const { data, error } = await supabase
            .from('movimientos')
            .select(`
              id,
              tipo,
              cantidad,
              precio_unitario,
              total,
              transcripcion,
              created_at,
              productos (id, nombre, categorias (id, nombre)),
              tienda_origen (id, nombre, empresa_id),
              tienda_destino (id, nombre, empresa_id),
              usuarios (id, nombre)
            `)
            .eq('id', payload.new.id)
            .single()

          if (!error && data) {
            // Verificar si pertenece a nuestra empresa
            const empresaOrig = data.tienda_origen?.empresa_id
            const empresaDest = data.tienda_destino?.empresa_id
            if (empresaOrig === empresaId || empresaDest === empresaId) {
              onNewMovimiento(data)
            }
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [empresaId, onNewMovimiento])

  return isConnected
}
