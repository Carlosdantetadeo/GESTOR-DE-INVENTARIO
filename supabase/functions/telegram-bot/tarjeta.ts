// supabase/functions/telegram-bot/tarjeta.ts
// Sprint 018 — Tarjeta de revisión unificada (decisión de diseño #1 y #5).
//
// UNA sola función arma el mensaje de revisión para los TRES canales (voz, texto,
// foto). Es idéntica salvo la línea de cuenta regresiva, que solo aparece en
// voz/texto con auto-confirmación (foto siempre espera tap explícito).
//
// Función PURA y sin dependencias: no toca red ni DB, para poder testearla sola.

export interface TarjetaItem {
  nombre: string
  cantidad: number
  precio: number
}

export interface TarjetaPendiente {
  id: string                                   // movimiento_pendiente.id (UUID)
  channel: 'voz' | 'texto' | 'foto'
  tipo: 'compra' | 'venta' | 'ingreso' | 'traslado' | null
  items: TarjetaItem[]
}

export interface TarjetaOpciones {
  // Segundos de cuenta regresiva. La línea solo se muestra si es > 0 y el canal
  // NO es foto. En foto nunca hay auto-confirmación.
  countdownSegundos?: number
}

export interface TarjetaMensaje {
  text: string
  reply_markup: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
  }
}

const TIPO_LABEL: Record<string, string> = {
  venta:    'Venta (salida)',
  compra:   'Compra (entrada)',
  ingreso:  'Ingreso (entrada)',
  traslado: 'Traslado',
}

// Importe a 2 decimales. Las líneas usan "S/X" (sin espacio); el total "S/ X"
// (con espacio), tal como el template del brief.
function fmtMonto(n: number): string {
  return n.toFixed(2)
}

export function construirTarjeta(
  pendiente: TarjetaPendiente,
  opciones: TarjetaOpciones = {},
): TarjetaMensaje {
  const lineas = pendiente.items.map((it, i) => {
    const subtotal = it.cantidad * it.precio
    return `${i + 1}. ${it.nombre} — ${it.cantidad} × S/${fmtMonto(it.precio)} = S/${fmtMonto(subtotal)}`
  })

  // El total se DERIVA de los ítems (única fuente de verdad), no se confía en un
  // total externo que podría quedar desincronizado tras una edición.
  const total = pendiente.items.reduce((s, it) => s + it.cantidad * it.precio, 0)

  const tipoLabel = pendiente.tipo ? (TIPO_LABEL[pendiente.tipo] ?? pendiente.tipo) : '—'

  const mostrarCuenta =
    pendiente.channel !== 'foto' &&
    typeof opciones.countdownSegundos === 'number' &&
    opciones.countdownSegundos > 0

  let text =
    `🧾 Revisa el registro\n\n` +
    `Tipo: ${tipoLabel}\n` +
    `─────────\n` +
    (lineas.length ? lineas.join('\n') + '\n' : '') +
    `─────────\n` +
    `Total: S/ ${fmtMonto(total)}`

  if (mostrarCuenta) {
    text += `\n\n⏱ Registrando en ${opciones.countdownSegundos}s… toca Corregir si algo está mal.`
  }

  return {
    text,
    reply_markup: {
      inline_keyboard: [[
        { text: '✏️ Corregir',  callback_data: `corregir:${pendiente.id}` },
        { text: '✅ Confirmar', callback_data: `confirmar:${pendiente.id}` },
        { text: '❌ Cancelar',  callback_data: `cancelar:${pendiente.id}` },
      ]],
    },
  }
}
