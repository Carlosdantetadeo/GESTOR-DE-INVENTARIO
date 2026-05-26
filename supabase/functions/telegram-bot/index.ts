// supabase/functions/telegram-bot/index.ts
// Bot de Telegram para Agent GMS.
//
// Soporta: voz (Groq Whisper STT) · texto · foto (Groq Vision)
// NLU multi-modelo: groq-llama · anthropic-haiku · anthropic-sonnet
// Consumo diferenciado por empresa en tabla consumo_ia.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Constantes ───────────────────────────────────────────────────────────────

const BOT_TOKEN     = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const GROQ_KEY      = Deno.env.get('GROQ_API_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const TG_API        = `https://api.telegram.org/bot${BOT_TOKEN}`
const TG_FILE       = `https://api.telegram.org/file/bot${BOT_TOKEN}`

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!,
)

// Modelos disponibles y sus IDs de API
const GROQ_MODEL_IDS: Record<string, string> = {
  'groq-llama': 'llama-3.3-70b-versatile',
}
const ANTHROPIC_MODEL_IDS: Record<string, string> = {
  'anthropic-haiku':  'claude-haiku-4-5-20251001',
  'anthropic-sonnet': 'claude-sonnet-4-6',
}

// Costo por token en USD [entrada, salida]
const TOKEN_COSTS: Record<string, [number, number]> = {
  'groq-llama':       [0.00000059, 0.00000079],
  'anthropic-haiku':  [0.0000008,  0.000004  ],
  'anthropic-sonnet': [0.000003,   0.000015  ],
}

// ─── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 })

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }

  try {
    if (update.callback_query?.data?.startsWith('undo_')) {
      await handleUndo(update.callback_query)
      return new Response('ok', { status: 200 })
    }

    const msg = update.message
    if (!msg) return new Response('ok', { status: 200 })

    if (msg.voice) {
      await handleVoice(msg)
      return new Response('ok', { status: 200 })
    }

    if (msg.text && !msg.text.startsWith('/')) {
      await handleTranscript(msg.chat.id, msg.from?.id, msg.text.trim())
      return new Response('ok', { status: 200 })
    }

    if (msg.photo?.length) {
      await handlePhoto(msg)
      return new Response('ok', { status: 200 })
    }
  } catch (err) {
    console.error('[telegram-bot] error no controlado:', err)
  }

  return new Response('ok', { status: 200 })
})

// ─── Undo ─────────────────────────────────────────────────────────────────────

async function handleUndo(cb: CallbackQuery) {
  const chatId = cb.message.chat.id
  const msgId  = cb.message.message_id
  const moviId = cb.data.replace('undo_', '')

  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Revirtiendo...' })

  const { error } = await supabase.from('movimientos').delete().eq('id', moviId)

  if (error) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No se pudo revertir el registro.' })
    return
  }

  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text:
      '↩️ *Registro revertido*\n' +
      'El stock fue restaurado automáticamente.\n\n' +
      '_Podés volver a enviar el mensaje con el dato correcto._',
    parse_mode: 'Markdown',
  })
}

// ─── Voz → STT → handleTranscript ────────────────────────────────────────────

async function handleVoice(message: TelegramMessage) {
  const chatId         = message.chat.id
  const telegramUserId = message.from?.id

  const fileInfo = await tg('getFile', { file_id: message.voice!.file_id })
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No se pudo obtener el audio.' })
    return
  }

  const audioResp = await fetch(`${TG_FILE}/${fileInfo.result.file_path}`)
  if (!audioResp.ok) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ Error descargando el audio.' })
    return
  }

  const form = new FormData()
  form.append('file', new Blob([await audioResp.arrayBuffer()], { type: 'audio/ogg' }), 'audio.ogg')
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

// ─── Foto → Groq Vision → handleTranscript ───────────────────────────────────

async function handlePhoto(message: TelegramMessage) {
  const chatId         = message.chat.id
  const telegramUserId = message.from?.id

  const photo    = message.photo![message.photo!.length - 1]
  const fileInfo = await tg('getFile', { file_id: photo.file_id })
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No se pudo obtener la imagen.' })
    return
  }

  const imgResp = await fetch(`${TG_FILE}/${fileInfo.result.file_path}`)
  if (!imgResp.ok) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ Error descargando la imagen.' })
    return
  }

  const base64   = btoa(String.fromCharCode(...new Uint8Array(await imgResp.arrayBuffer())))
  const mimeType = fileInfo.result.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg'

  await tg('sendMessage', { chat_id: chatId, text: '🔍 Analizando imagen...' })

  const visionResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          {
            type: 'text',
            text: `Eres el asistente de inventario de una ferretería.
Analizá esta imagen e identificá cualquier movimiento de inventario visible:
facturas, remitos, pizarras, anotaciones, etiquetas de productos, o stock.
Describí en una sola oración en español qué movimiento ves, mencionando:
producto, cantidad, tipo (venta/ingreso/gasto/traslado) y tienda si es visible.
Si no hay información de inventario, respondé solo: NO_INVENTARIO.`,
          },
        ],
      }],
    }),
  })

  const visionData = await visionResp.json()
  const descripcion: string = visionData.choices?.[0]?.message?.content?.trim() ?? ''

  if (!descripcion || descripcion === 'NO_INVENTARIO') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '❓ No encontré información de inventario en la imagen.\n\n_Enviá una foto de una factura, remito o pizarra con productos y cantidades._',
      parse_mode: 'Markdown',
    })
    return
  }

  await handleTranscript(chatId, telegramUserId, descripcion)
}

// ─── NLU → INSERT → Confirmar ────────────────────────────────────────────────

async function handleTranscript(
  chatId: number,
  telegramUserId: number | undefined,
  transcript: string,
) {
  // Buscar usuario + modelo NLU de su empresa en una sola query
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, empresa_id, empresas(nlu_model)')
    .eq('telegram_id', telegramUserId)
    .maybeSingle() as { data: UsuarioConEmpresa | null }

  const empresaId = usuario?.empresa_id ?? undefined
  const nluModel  = (usuario?.empresas as { nlu_model?: string } | null)?.nlu_model ?? 'groq-llama'

  // Cargar catálogos
  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').limit(200),
    supabase.from('tiendas').select('id, nombre').eq('activa', true),
  ])

  const listaProd   = (productos ?? []).map(p => `${p.id}|${p.nombre}`).join('\n')
  const listaTienda = (tiendas   ?? []).map(t => `${t.id}|${t.nombre}`).join('\n')

  const systemPrompt = `Eres el asistente de inventario de una ferretería peruana.
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
- "vendí"/"vendimos" → tipo = "venta"
- "entró"/"llegó"/"recibimos" → tipo = "ingreso"
- "gasté"/"compré para la tienda" → tipo = "gasto"
- "trasladé"/"mandé a" → tipo = "traslado"
- Busca el producto más parecido (ignora tildes y mayúsculas).
- Si no coincide ningún producto, devuelve producto_id = null.`

  // Llamar al modelo NLU de la empresa
  const { parsed, tokensIn, tokensOut } = await callNLU(nluModel, systemPrompt, transcript)

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

  // INSERT movimiento
  const payload: Record<string, unknown> = {
    tipo:            parsed.tipo,
    producto_id:     parsed.producto_id,
    cantidad:        parsed.cantidad,
    precio_unitario: parsed.precio_unitario ?? 0,
    costo_unitario:  parsed.costo_unitario  ?? 0,
    tienda_origen:   parsed.tienda_origen_id  ?? null,
    tienda_destino:  parsed.tienda_destino_id ?? null,
    transcripcion:   transcript,
    usuario_id:      usuario?.id ?? null,
  }

  const { data: movimiento, error: insertErr } = await supabase
    .from('movimientos').insert(payload).select('id').single()

  if (insertErr || !movimiento) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `❌ Error al guardar: ${insertErr?.message ?? 'desconocido'}`,
    })
    return
  }

  // Registrar consumo (fire-and-forget, no bloquea la respuesta)
  logConsumo(empresaId, nluModel, tokensIn, tokensOut, 'nlu').catch(console.error)

  // Confirmar con botón Deshacer
  const productoNombre = productos?.find(p => p.id === parsed!.producto_id)?.nombre ?? `Producto #${parsed.producto_id}`
  const tiendaNombre   = tiendaLabel(tiendas, parsed)
  const total          = (parsed.cantidad * (parsed.precio_unitario ?? 0)).toFixed(2)
  const emoji: Record<string, string> = { venta: '💰', ingreso: '📦', gasto: '🔧', traslado: '🔄' }

  await tg('sendMessage', {
    chat_id: chatId,
    text:
      `${emoji[parsed.tipo] ?? '✅'} *${capitalize(parsed.tipo)} registrada*\n` +
      `📦 ${productoNombre}\n` +
      `🔢 Cantidad: ${parsed.cantidad}\n` +
      `📍 ${tiendaNombre}\n` +
      (parsed.precio_unitario ? `💵 Total: S/. ${total}\n` : '') +
      `\n_¿Hubo un error? Pulsá Deshacer para revertir._`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '↩️ Deshacer', callback_data: `undo_${movimiento.id}` }]],
    },
  })
}

// ─── NLU multi-modelo ─────────────────────────────────────────────────────────

async function callNLU(
  nluModel: string,
  systemPrompt: string,
  transcript: string,
): Promise<{ parsed: ParsedMovimiento | null; tokensIn: number; tokensOut: number }> {

  // ── Groq ──
  if (nluModel in GROQ_MODEL_IDS) {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL_IDS[nluModel],
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: transcript },
        ],
      }),
    })
    const data = await resp.json()
    const tokensIn  = data.usage?.prompt_tokens     ?? 0
    const tokensOut = data.usage?.completion_tokens ?? 0
    try {
      return { parsed: JSON.parse(data.choices[0].message.content), tokensIn, tokensOut }
    } catch {
      return { parsed: null, tokensIn, tokensOut }
    }
  }

  // ── Anthropic ──
  if (nluModel in ANTHROPIC_MODEL_IDS) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL_IDS[nluModel],
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcript }],
      }),
    })
    const data = await resp.json()
    const tokensIn  = data.usage?.input_tokens  ?? 0
    const tokensOut = data.usage?.output_tokens ?? 0
    try {
      return { parsed: JSON.parse(data.content[0].text), tokensIn, tokensOut }
    } catch {
      return { parsed: null, tokensIn, tokensOut }
    }
  }

  return { parsed: null, tokensIn: 0, tokensOut: 0 }
}

// ─── Registro de consumo ──────────────────────────────────────────────────────

async function logConsumo(
  empresaId: string | undefined,
  modelo: string,
  tokensIn: number,
  tokensOut: number,
  tipo: string,
) {
  if (!empresaId) return
  const [cIn, cOut] = TOKEN_COSTS[modelo] ?? [0, 0]
  await supabase.from('consumo_ia').insert({
    empresa_id:     empresaId,
    modelo,
    tipo,
    tokens_entrada: tokensIn,
    tokens_salida:  tokensOut,
    costo_usd:      tokensIn * cIn + tokensOut * cOut,
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
  chat:    { id: number }
  from?:   { id: number }
  voice?:  { file_id: string }
  text?:   string
  photo?:  Array<{ file_id: string; width: number; height: number }>
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

interface UsuarioConEmpresa {
  id:         string
  empresa_id: string
  empresas:   { nlu_model: string } | null
}
