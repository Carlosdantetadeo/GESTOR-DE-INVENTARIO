// supabase/functions/telegram-bot/index.ts
// Edge Function para el bot de Telegram de Agent GMS.
//
// Flujo completo:
//  Mensaje de voz → Groq Whisper (STT) → transcript → handleTranscript
//  Mensaje de texto                               → handleTranscript
//  handleTranscript → Groq Llama (NLU) → INSERT movimiento
//    → Telegram: confirmación + botón "↩️ Deshacer" (callback undo_<id>)
//  Callback undo_<id> → DELETE movimiento → trigger revierte stock → confirmación
//
// Variables de entorno requeridas (Supabase Dashboard → Edge Functions → Secrets):
//   GROQ_API_KEY
//   TELEGRAM_BOT_TOKEN
//   SUPABASE_URL          (disponible automáticamente en Supabase)
//   SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Clientes globales ────────────────────────────────────────────────────────

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const GROQ_KEY  = Deno.env.get('GROQ_API_KEY')!
const TG_API    = `https://api.telegram.org/bot${BOT_TOKEN}`
const TG_FILE   = `https://api.telegram.org/file/bot${BOT_TOKEN}`

// Siempre service_role — bypasea RLS para que n8n/bots puedan escribir.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!,
)

// ─── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Telegram envía siempre POST; cualquier otra cosa puede ser health-check
  if (req.method !== 'POST') {
    return new Response('ok', { status: 200 })
  }

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }

  try {
    // Callback del botón Deshacer
    if (update.callback_query?.data?.startsWith('undo_')) {
      await handleUndo(update.callback_query)
      return new Response('ok', { status: 200 })
    }

    const msg = update.message
    if (!msg) return new Response('ok', { status: 200 })

    // Mensaje de voz → STT → NLU → INSERT
    if (msg.voice) {
      await handleVoice(msg)
      return new Response('ok', { status: 200 })
    }

    // Mensaje de texto → NLU → INSERT (omite el paso de STT)
    if (msg.text && !msg.text.startsWith('/')) {
      await handleTranscript(msg.chat.id, msg.from?.id, msg.text.trim())
      return new Response('ok', { status: 200 })
    }

    // Comandos /start o cualquier otro — ignorar silenciosamente
  } catch (err) {
    console.error('[telegram-bot] error no controlado:', err)
  }

  // Siempre 200 → Telegram no reintenta el webhook
  return new Response('ok', { status: 200 })
})

// ─── PASO 8: Manejar callback "undo_<movimiento_id>" ─────────────────────────

async function handleUndo(cb: CallbackQuery) {
  const chatId  = cb.message.chat.id
  const msgId   = cb.message.message_id
  const moviId  = cb.data.replace('undo_', '')

  // Telegram requiere responder al callback para quitar el spinner del botón
  await tg('answerCallbackQuery', {
    callback_query_id: cb.id,
    text: 'Revirtiendo...',
  })

  const { error } = await supabase
    .from('movimientos')
    .delete()
    .eq('id', moviId)

  if (error) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '❌ No se pudo revertir el registro. Verifica en el dashboard e intenta de nuevo.',
    })
    return
  }

  // El trigger tr_actualizar_stock con factor -1 ya revirtió el stock automáticamente.
  // Editamos el mensaje original para que quede como registro de la reversión.
  await tg('editMessageText', {
    chat_id: chatId,
    message_id: msgId,
    text:
      '↩️ *Registro revertido*\n' +
      'El stock fue restaurado automáticamente.\n\n' +
      '_Podés volver a enviar el audio con el dato correcto._',
    parse_mode: 'Markdown',
  })
}

// ─── Manejar mensaje de voz: STT → handleTranscript ─────────────────────────

async function handleVoice(message: TelegramMessage) {
  const chatId         = message.chat.id
  const telegramUserId = message.from?.id
  const fileId         = message.voice!.file_id

  const fileInfo = await tg('getFile', { file_id: fileId })
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No se pudo obtener el audio.' })
    return
  }

  const audioResp = await fetch(`${TG_FILE}/${fileInfo.result.file_path}`)
  if (!audioResp.ok) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ Error descargando el audio.' })
    return
  }
  const audioBuffer = await audioResp.arrayBuffer()

  const form = new FormData()
  form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('language', 'es')
  form.append('response_format', 'json')

  const whisperResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: form,
  })
  const whisperData = await whisperResp.json()
  const transcript: string = whisperData.text?.trim()

  if (!transcript) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '❌ No pude transcribir el audio. Grabá más despacio y cerca del micrófono.',
    })
    return
  }

  await handleTranscript(chatId, telegramUserId, transcript)
}

// ─── NLU → INSERT → Confirmar (compartido por voz y texto) ───────────────────

async function handleTranscript(
  chatId: number,
  telegramUserId: number | undefined,
  transcript: string,
) {
  // Cargar catálogos para el prompt (primeros 200 items cada uno)
  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').limit(200),
    supabase.from('tiendas').select('id, nombre').eq('activa', true),
  ])

  const listaProd   = (productos ?? []).map(p => `${p.id}|${p.nombre}`).join('\n')
  const listaTienda = (tiendas   ?? []).map(t => `${t.id}|${t.nombre}`).join('\n')

  // Extraer estructura con Groq Llama
  const llmResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Eres el asistente de inventario de una ferretería peruana.
Extrae del texto del operario los siguientes campos y responde SOLO con JSON válido:
{
  "producto_id": <número del catálogo, o null si no coincide>,
  "tipo": <"venta"|"ingreso"|"gasto"|"traslado">,
  "cantidad": <número entero positivo>,
  "tienda_origen_id": <id de tienda, requerido para venta/gasto/traslado, null si no aplica>,
  "tienda_destino_id": <id de tienda, requerido para ingreso/traslado, null si no aplica>,
  "precio_unitario": <número decimal, 0 si no se menciona>,
  "costo_unitario": <número decimal, 0 si no se menciona>
}

CATÁLOGO DE PRODUCTOS (id|nombre):
${listaProd}

CATÁLOGO DE TIENDAS (id|nombre):
${listaTienda}

Reglas:
- Si el operario dice "vendí" o "vendimos" → tipo = "venta"
- Si dice "entró", "llegó", "recibimos" → tipo = "ingreso"
- Si dice "gasté", "compré para la tienda" → tipo = "gasto"
- Si dice "trasladé", "mandé a" → tipo = "traslado"
- Busca el producto más parecido al nombre mencionado (ignora tildes y mayúsculas).
- Si el nombre no coincide con ningún producto, devuelve producto_id = null.`,
        },
        { role: 'user', content: transcript },
      ],
    }),
  })

  const llmData = await llmResp.json()
  let parsed: ParsedMovimiento | null = null

  try {
    parsed = JSON.parse(llmData.choices[0].message.content)
  } catch {
    // JSON malformado
  }

  if (!parsed || !parsed.producto_id || !parsed.tipo || !parsed.cantidad) {
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        `❓ No entendí bien: _"${transcript}"_\n\n` +
        'Intentá decir: *"Vendí 5 tubos PVC media pulgada en Tienda 1"*',
      parse_mode: 'Markdown',
    })
    return
  }

  // Buscar usuario por telegram_id y hacer INSERT movimiento
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  const payload: Record<string, unknown> = {
    tipo:             parsed.tipo,
    producto_id:      parsed.producto_id,
    cantidad:         parsed.cantidad,
    precio_unitario:  parsed.precio_unitario  ?? 0,
    costo_unitario:   parsed.costo_unitario   ?? 0,
    tienda_origen:    parsed.tienda_origen_id  ?? null,
    tienda_destino:   parsed.tienda_destino_id ?? null,
    transcripcion:    transcript,
    usuario_id:       usuario?.id ?? null,
  }

  const { data: movimiento, error: insertErr } = await supabase
    .from('movimientos')
    .insert(payload)
    .select('id')
    .single()

  if (insertErr || !movimiento) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `❌ Error al guardar: ${insertErr?.message ?? 'desconocido'}`,
    })
    return
  }

  // Confirmar en Telegram con botón inline "↩️ Deshacer"
  const productoNombre = productos?.find(p => p.id === parsed!.producto_id)?.nombre ?? `Producto #${parsed.producto_id}`
  const tiendaNombre   = tiendaLabel(tiendas, parsed)
  const total          = (parsed.cantidad * (parsed.precio_unitario ?? 0)).toFixed(2)
  const emoji: Record<string, string> = { venta: '💰', ingreso: '📦', gasto: '🔧', traslado: '🔄' }

  const texto =
    `${emoji[parsed.tipo] ?? '✅'} *${capitalize(parsed.tipo)} registrada*\n` +
    `📦 ${productoNombre}\n` +
    `🔢 Cantidad: ${parsed.cantidad}\n` +
    `📍 ${tiendaNombre}\n` +
    (parsed.precio_unitario ? `💵 Total: S/. ${total}\n` : '') +
    `\n_¿Hubo un error? Pulsá Deshacer para revertir._`

  await tg('sendMessage', {
    chat_id: chatId,
    text: texto,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '↩️ Deshacer', callback_data: `undo_${movimiento.id}` },
      ]],
    },
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function tiendaLabel(
  tiendas: Array<{ id: number; nombre: string }> | null,
  p: ParsedMovimiento,
): string {
  if (p.tipo === 'traslado') {
    const orig = tiendas?.find(t => t.id === p.tienda_origen_id)?.nombre ?? `#${p.tienda_origen_id}`
    const dest = tiendas?.find(t => t.id === p.tienda_destino_id)?.nombre ?? `#${p.tienda_destino_id}`
    return `${orig} → ${dest}`
  }
  const tiendaId = p.tienda_origen_id ?? p.tienda_destino_id
  return tiendas?.find(t => t.id === tiendaId)?.nombre ?? `Tienda #${tiendaId}`
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  message?:        TelegramMessage
  callback_query?: CallbackQuery
}

interface TelegramMessage {
  chat:   { id: number }
  from?:  { id: number }
  voice?: { file_id: string }
  text?:  string
}

interface CallbackQuery {
  id:      string
  data:    string
  message: { chat: { id: number }; message_id: number }
}

interface ParsedMovimiento {
  producto_id:       number | null
  tipo:              string
  cantidad:          number
  tienda_origen_id:  number | null
  tienda_destino_id: number | null
  precio_unitario:   number
  costo_unitario:    number
}

// ==============================================================================
// REGISTRAR EL WEBHOOK EN TELEGRAM
// Ejecutar UNA sola vez después de hacer deploy de la función.
//
// curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
//   -H "Content-Type: application/json" \
//   -d '{"url":"https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot","secret_token":"<TOKEN_ALEATORIO>"}'
//
// Reemplazar:
//   <TELEGRAM_BOT_TOKEN>  → token de @BotFather
//   <PROJECT_REF>         → referencia del proyecto en Supabase (ej. abcdefghijklmnop)
//   <TOKEN_ALEATORIO>     → cualquier string largo (ej. openssl rand -hex 32)
//                           Supabase lo valida automáticamente en la cabecera X-Telegram-Bot-Api-Secret-Token
//
// Para verificar que el webhook quedó registrado:
// curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
// ==============================================================================
