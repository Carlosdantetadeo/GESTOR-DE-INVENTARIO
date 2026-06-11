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
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
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

// waitUntil mantiene viva la función después de responder (Supabase Edge Runtime)
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 })

  // FIX SEGURIDAD (S2): el endpoint es público (--no-verify-jwt). Solo se
  // aceptan requests que traigan el secret registrado en setWebhook.
  // Fail-closed: si TELEGRAM_WEBHOOK_SECRET no está configurado, rechaza todo.
  if (!WEBHOOK_SECRET ||
      req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }

  // FIX (B5) parte 1: dedupe por update_id. Telegram reenvía el mismo update
  // si no recibe 200 a tiempo; el PRIMARY KEY de telegram_updates convierte
  // el reintento en un 23505 y se descarta sin duplicar movimientos.
  if (typeof update.update_id === 'number') {
    const { error: dupErr } = await supabase
      .from('telegram_updates')
      .insert({ update_id: update.update_id })
    if (dupErr?.code === '23505') {
      return new Response('ok', { status: 200 })   // ya procesado
    }
    // Cualquier otro error (tabla faltante, red): se procesa igual — mejor
    // arriesgar un duplicado que perder el mensaje del operario.

    // Limpieza oportunista (~1% de los updates): purgar registros de >2 días
    if (update.update_id % 100 === 0) {
      await supabase
        .from('telegram_updates')
        .delete()
        .lt('created_at', new Date(Date.now() - 2 * 86_400_000).toISOString())
    }
  }

  // FIX (B5) parte 2: responder 200 inmediato y procesar en background, para
  // que Telegram no reintente mientras corre STT + NLU (pueden tardar >5s).
  const tarea = procesarUpdate(update)
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(tarea)
  } else {
    await tarea   // fallback (ej. tests locales sin Edge Runtime)
  }

  return new Response('ok', { status: 200 })
})

async function procesarUpdate(update: TelegramUpdate) {
  try {
    if (update.callback_query?.data?.startsWith('undo_')) {
      await handleUndo(update.callback_query)
      return
    }

    if (update.callback_query?.data?.startsWith('join_')) {
      await handleJoin(update.callback_query)
      return
    }

    const msg = update.message
    if (!msg) return

    if (msg.text?.startsWith('/start')) {
      await handleStart(msg)
      return
    }

    if (msg.voice) {
      await handleVoice(msg)
      return
    }

    if (msg.text && !msg.text.startsWith('/')) {
      await handleTranscript(msg.chat.id, msg.from?.id, msg.text.trim())
      return
    }

    if (msg.photo?.length) {
      await handlePhoto(msg)
      return
    }
  } catch (err) {
    console.error('[telegram-bot] error no controlado:', err)
  }
}

// ─── /start <token> — registro de operario ───────────────────────────────────

async function handleStart(msg: TelegramMessage) {
  const chatId         = msg.chat.id
  const telegramUserId = msg.from?.id
  const token          = msg.text?.split(' ')[1]?.trim()

  if (!token) {
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        '👋 Para registrarte como operario enviá:\n\n' +
        '`/start TU_TOKEN`\n\n' +
        'Pedí el token al administrador de tu empresa.',
      parse_mode: 'Markdown',
    })
    return
  }

  // ¿Ya está registrado?
  const { data: existente } = await supabase
    .from('usuarios')
    .select('id, nombre, empresa_id, tienda_id, empresas(nombre), tiendas(nombre)')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  if (existente) {
    const empNombre    = (existente.empresas  as any)?.nombre ?? '—'
    const tiendaNombre = (existente.tiendas   as any)?.nombre ?? 'Sin asignar'
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        `✅ Ya estás registrado.\n\n` +
        `🏢 Empresa: *${empNombre}*\n` +
        `📍 Sede: *${tiendaNombre}*\n\n` +
        `Podés enviar notas de voz para registrar movimientos.`,
      parse_mode: 'Markdown',
    })
    return
  }

  // Buscar empresa por token
  const { data: empresa } = await supabase
    .from('empresas')
    .select('id, nombre')
    .eq('telegram_token', token)
    .eq('activa', true)
    .maybeSingle()

  if (!empresa) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '❌ Token inválido o empresa desactivada.\nVerificá el token con tu administrador.',
    })
    return
  }

  // Listar sedes de la empresa
  const { data: tiendas } = await supabase
    .from('tiendas')
    .select('id, nombre')
    .eq('empresa_id', empresa.id)
    .eq('activa', true)
    .order('id')

  if (!tiendas?.length) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '❌ La empresa no tiene sedes configuradas aún.',
    })
    return
  }

  // Mostrar botones con las sedes
  const buttons = tiendas.map(t => ([{
    text: t.nombre,
    callback_data: `join_${token}_${t.id}`,
  }]))

  await tg('sendMessage', {
    chat_id: chatId,
    text:
      `👋 Hola *${msg.from?.first_name ?? 'operario'}*!\n\n` +
      `Te vas a registrar en *${empresa.nombre}*.\n\n` +
      `📍 ¿En qué sede trabajás?`,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  })
}

// ─── Selección de sede al registrarse ────────────────────────────────────────

async function handleJoin(cb: CallbackQuery) {
  const chatId         = cb.message.chat.id
  const msgId          = cb.message.message_id
  const telegramUserId = cb.from.id
  const parts          = cb.data.split('_')   // ['join', token(uuid), tiendaId]
  const token          = parts[1]
  const tiendaId       = parseInt(parts[2])

  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  // Verificar token
  const { data: empresa } = await supabase
    .from('empresas')
    .select('id, nombre')
    .eq('telegram_token', token)
    .eq('activa', true)
    .maybeSingle()

  if (!empresa) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: '❌ Token expirado. Pedí un nuevo link al administrador.',
    })
    return
  }

  // Evitar doble registro
  const { data: existente } = await supabase
    .from('usuarios')
    .select('id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  if (existente) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: '⚠️ Ya tenés una cuenta registrada en este sistema.',
    })
    return
  }

  // Obtener la sede validando que pertenece a la empresa del token (S3):
  // el callback_data podría manipularse para apuntar a una tienda ajena.
  const { data: tienda } = await supabase
    .from('tiendas')
    .select('nombre')
    .eq('id', tiendaId)
    .eq('empresa_id', empresa.id)
    .maybeSingle()

  if (!tienda) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: '❌ La sede seleccionada no pertenece a esta empresa. Volvé a enviar /start con el token.',
    })
    return
  }

  // Insertar en usuarios
  const nombre = [cb.from.first_name, cb.from.last_name].filter(Boolean).join(' ')
  const { error } = await supabase.from('usuarios').insert({
    telegram_id: telegramUserId,
    nombre,
    rol:        'vendedor',
    tienda_id:  tiendaId,
    empresa_id: empresa.id,
  })

  if (error) {
    console.error('[handleJoin] insert error:', error)
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: `❌ Error al registrar: ${error.message}`,
    })
    return
  }

  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text:
      `✅ *¡Registrado exitosamente!*\n\n` +
      `🏢 Empresa: *${empresa.nombre}*\n` +
      `📍 Sede: *${tienda?.nombre}*\n\n` +
      `Ya podés enviar notas de voz para registrar movimientos.\n` +
      `Decí algo como: _"Vendí 3 tubos PVC"_`,
    parse_mode: 'Markdown',
  })
}

// ─── Undo ─────────────────────────────────────────────────────────────────────

async function handleUndo(cb: CallbackQuery) {
  const chatId = cb.message.chat.id
  const msgId  = cb.message.message_id
  const ids    = cb.data.replace('undo_', '').split(',').filter(Boolean)

  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Revirtiendo...' })

  // FIX SEGURIDAD (S3): defensa en profundidad — solo se borran movimientos
  // de la empresa del operario que pulsa el botón. El cliente usa service
  // role (bypasea RLS), así que el scoping se hace explícito acá.
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('empresa_id')
    .eq('telegram_id', cb.from.id)
    .maybeSingle()

  if (!usuario) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '⛔ Tu cuenta de Telegram no está registrada en el sistema.',
    })
    return
  }

  // Resolver qué ids pertenecen realmente a la empresa del operario
  // (movimientos no tiene empresa_id propio; se filtra vía productos)
  const { data: propios } = await supabase
    .from('movimientos')
    .select('id, productos!inner(empresa_id)')
    .in('id', ids)
    .eq('productos.empresa_id', usuario.empresa_id)

  const idsValidos = (propios ?? []).map(m => m.id)

  if (idsValidos.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '❌ No se pudo revertir: el registro ya no existe o no pertenece a tu empresa.',
    })
    return
  }

  const { error } = await supabase.from('movimientos').delete().in('id', idsValidos)

  if (error) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No se pudo revertir el registro.' })
    return
  }

  const cantidad = idsValidos.length
  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text:
      `↩️ *${cantidad === 1 ? 'Registro revertido' : `${cantidad} registros revertidos`}*\n` +
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

  const base64   = bufferToBase64(await imgResp.arrayBuffer())
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
    .select('id, empresa_id, tienda_id, empresas(nlu_model)')
    .eq('telegram_id', telegramUserId)
    .maybeSingle() as { data: UsuarioConEmpresa | null }

  if (!usuario) {
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        '⛔ Tu cuenta de Telegram no está registrada en el sistema.\n\n' +
        'Pedile al administrador que te agregue como operario.',
    })
    return
  }

  const empresaId = usuario.empresa_id
  const nluModel  = (usuario.empresas as { nlu_model?: string } | null)?.nlu_model ?? 'groq-llama'

  // Cargar catálogos filtrados por empresa
  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', empresaId).limit(200),
    supabase.from('tiendas').select('id, nombre').eq('empresa_id', empresaId).eq('activa', true),
  ])

  const listaProd   = (productos ?? []).map(p => `${p.id}|${p.nombre}`).join('\n')
  const listaTienda = (tiendas   ?? []).map(t => `${t.id}|${t.nombre}`).join('\n')

  const systemPrompt = `Eres el asistente de inventario de una ferretería peruana.
Extrae TODOS los productos mencionados y responde SOLO con JSON válido:
{
  "movimientos": [
    {
      "producto_id": <número del catálogo, o null si no coincide>,
      "producto_nombre": <nombre limpio del producto, siempre requerido>,
      "tipo": <"venta"|"ingreso"|"gasto"|"traslado">,
      "cantidad": <número entero positivo>,
      "tienda_origen_id": <id de tienda o null>,
      "tienda_destino_id": <id de tienda o null>,
      "precio_unitario": <precio de venta por unidad, 0 si no se menciona>,
      "costo_unitario": <costo de compra por unidad, 0 si no se menciona>
    }
  ]
}

CATÁLOGO DE PRODUCTOS (id|nombre):
${listaProd || '(vacío — todos los productos son nuevos)'}

CATÁLOGO DE TIENDAS (id|nombre):
${listaTienda}

Reglas:
- Si el operario menciona varios productos, genera un objeto por cada uno.
- "vendí"/"vendimos" → tipo = "venta"
- "entró"/"llegó"/"recibimos" → tipo = "ingreso"
- "gasté"/"compré para la tienda" → tipo = "gasto"
- "trasladé"/"mandé a" → tipo = "traslado"
- Coincidencia de catálogo: usa un producto del catálogo SOLO si es claramente el mismo artículo
  (mismo tipo de producto y misma medida; ignora tildes y mayúsculas).
  "Caño", "tubo", "codo", "llave" y "válvula" son productos DISTINTOS entre sí — nunca los mezcles.
- Ante la duda, devuelve producto_id = null pero SIEMPRE llena producto_nombre (se creará nuevo).
- producto_nombre debe ser el nombre normalizado (ej: "Bomba 2 pulgadas").
- PRECIOS según el tipo:
  · venta o gasto → el monto mencionado es precio_unitario (costo_unitario = 0 salvo que se diga).
  · ingreso → el monto mencionado es costo_unitario (lo que costó comprarlo); precio_unitario = 0
    salvo que el operario distinga ("costó 8 y lo vendo a 12" → costo_unitario = 8, precio_unitario = 12).
- Los montos son POR UNIDAD. Si el operario dice un total ("3 tubos por 30 soles en total"),
  divide el total entre la cantidad.`

  const { parsed: items, tokensIn, tokensOut } = await callNLU(nluModel, systemPrompt, transcript)

  if (!items || items.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        `❓ No entendí bien: _"${transcript}"_\n\n` +
        'Intentá decir: *"Vendí 5 tubos PVC y 3 codos de media pulgada a 2 soles"*',
      parse_mode: 'Markdown',
    })
    return
  }

  const primeraT = tiendas?.[0]?.id ?? null
  const emoji: Record<string, string> = { venta: '💰', ingreso: '📦', gasto: '🔧', traslado: '🔄' }
  const tipoRegistrado: Record<string, string> = {
    venta:    'Venta registrada',
    ingreso:  'Ingreso registrado',
    gasto:    'Gasto registrado',
    traslado: 'Traslado registrado',
  }
  const movimientos: Array<{ id: string; nombre: string; tipo: string }> = []
  const lineas: string[] = []
  let totalGeneral = 0

  // Obtener o crear categoría "General" una sola vez
  let categoriaIdGeneral: number | null = null
  const { data: catExistente } = await supabase
    .from('categorias')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('nombre', 'General')
    .maybeSingle()
  if (catExistente) {
    categoriaIdGeneral = catExistente.id
  } else {
    const { data: catNueva } = await supabase
      .from('categorias')
      .insert({ nombre: 'General', empresa_id: empresaId })
      .select('id')
      .single()
    categoriaIdGeneral = catNueva?.id ?? null
  }

  let omitidos = 0
  for (const item of items) {
    if (!item.tipo || !item.cantidad) { omitidos++; continue }

    // Auto-crear producto si no existe
    if (!item.producto_id && item.producto_nombre) {
      const nombre = item.producto_nombre.trim()
      const { data: prodNuevo } = await supabase
        .from('productos')
        .insert({
          nombre,
          empresa_id:            empresaId,
          categoria_id:          categoriaIdGeneral,
          precio_venta_sugerido: item.precio_unitario ?? 0,
          ultimo_costo:          item.costo_unitario  ?? 0,
        })
        .select('id')
        .single()
      if (prodNuevo) {
        item.producto_id = prodNuevo.id
        productos?.push({ id: prodNuevo.id, nombre })
      } else {
        // El insert pudo chocar con el unique (empresa_id, LOWER(nombre)):
        // el producto ya existe en esta empresa con otro casing, o no estaba
        // en el catálogo que vio el NLU (límite 200). Reusar el existente.
        const { data: prodExistente } = await supabase
          .from('productos')
          .select('id, nombre')
          .eq('empresa_id', empresaId)
          .ilike('nombre', nombre)
          .maybeSingle()
        if (prodExistente) {
          item.producto_id = prodExistente.id
          productos?.push({ id: prodExistente.id, nombre: prodExistente.nombre })
        }
      }
    }

    if (!item.producto_id) { omitidos++; continue }

    // FIX (B4): el default de tienda es la del operario, no la primera de la
    // empresa — un ingreso dicho desde la Sede 3 debe sumar stock en la Sede 3.
    const tiendaUsuario = usuario.tienda_id ?? primeraT
    const tiendaOrigen  = item.tienda_origen_id
      ?? (item.tipo !== 'ingreso' ? tiendaUsuario : null)
    const tiendaDestino = item.tienda_destino_id
      ?? (item.tipo === 'ingreso' ? tiendaUsuario
        : item.tipo === 'traslado' ? primeraT : null)

    const { data: mov, error: insertErr } = await supabase
      .from('movimientos')
      .insert({
        tipo:            item.tipo,
        producto_id:     item.producto_id,
        cantidad:        item.cantidad,
        precio_unitario: item.precio_unitario ?? 0,
        costo_unitario:  item.costo_unitario  ?? 0,
        tienda_origen:   tiendaOrigen,
        tienda_destino:  tiendaDestino,
        transcripcion:   transcript,
        usuario_id:      usuario?.id ?? null,
      })
      .select('id')
      .single()

    if (insertErr || !mov) { omitidos++; continue }

    const prodNombre   = productos?.find(p => p.id === item.producto_id)?.nombre ?? item.producto_nombre ?? `#${item.producto_id}`
    const tiendaLabel_ = tiendaLabel(tiendas, { ...item, tienda_origen_id: tiendaOrigen as number | null, tienda_destino_id: tiendaDestino as number | null })
    const precioUnit   = Number(item.precio_unitario ?? 0)
    const costoUnit    = Number(item.costo_unitario  ?? 0)
    const subtotal     = item.cantidad * precioUnit
    totalGeneral += subtotal

    // Línea de montos: en ventas/gastos muestra el precio unitario; en
    // ingresos el costo unitario (es lo que carga el NLU para ese tipo).
    let montoLinea = ''
    if (precioUnit > 0) {
      montoLinea = `\n   💵 S/. ${precioUnit.toFixed(2)} c/u → Subtotal: S/. ${subtotal.toFixed(2)}`
    } else if (costoUnit > 0) {
      montoLinea = `\n   💵 Costo: S/. ${costoUnit.toFixed(2)} c/u → S/. ${(item.cantidad * costoUnit).toFixed(2)}`
    }

    movimientos.push({ id: mov.id, nombre: prodNombre, tipo: item.tipo })
    lineas.push(
      `${emoji[item.tipo] ?? '✅'} *${capitalize(item.tipo)}* — *${prodNombre}* × ${item.cantidad}` +
      montoLinea +
      `\n   📍 ${tiendaLabel_}`
    )
  }

  if (movimientos.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `❓ No pude identificar productos en: _"${transcript}"_\n\nMencioná el nombre del producto claramente.`,
      parse_mode: 'Markdown',
    })
    return
  }

  logConsumo(empresaId, nluModel, tokensIn, tokensOut, 'nlu').catch(console.error)

  const encabezado = movimientos.length === 1
    ? `✅ *${tipoRegistrado[movimientos[0].tipo] ?? 'Movimiento registrado'}*`
    : `✅ *${movimientos.length} movimientos registrados*`

  // Botones: uno por producto + "Deshacer todo" si hay más de uno
  const botonesIndividuales = movimientos.map(m => ([{
    text:          `↩️ ${m.nombre.length > 25 ? m.nombre.slice(0, 23) + '…' : m.nombre}`,
    callback_data: `undo_${m.id}`,
  }]))
  // FIX (B2): callback_data tiene un límite duro de 64 bytes en Telegram.
  // Si la lista de ids no entra, Telegram rechaza el sendMessage COMPLETO y
  // el operario se queda sin confirmación ni botones. En ese caso se omite
  // solo el botón "Deshacer todo" (los individuales siempre caben).
  const undoTodo = `undo_${movimientos.map(m => m.id).join(',')}`
  const keyboard = movimientos.length > 1 && undoTodo.length <= 64
    ? [...botonesIndividuales, [{ text: '↩️ Deshacer todo', callback_data: undoTodo }]]
    : botonesIndividuales

  await tg('sendMessage', {
    chat_id: chatId,
    text:
      `${encabezado}\n` +
      `🎤 "${mdSafe(transcript)}"\n\n` +
      lineas.join('\n\n') +
      (totalGeneral > 0 ? `\n\n💵 *Total: S/. ${totalGeneral.toFixed(2)}*` : '') +
      (omitidos > 0 ? `\n\n⚠️ _${omitidos} producto(s) no se entendieron — repetílos en un nuevo mensaje._` : '') +
      `\n\n_Si lo escuchado no es lo que dijiste, tocá Deshacer y repetí el mensaje._`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: keyboard,
    },
  })
}

// ─── NLU multi-modelo ─────────────────────────────────────────────────────────

async function callNLU(
  nluModel: string,
  systemPrompt: string,
  transcript: string,
): Promise<{ parsed: ParsedMovimiento[] | null; tokensIn: number; tokensOut: number }> {

  function extractItems(raw: unknown): ParsedMovimiento[] | null {
    if (!raw || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    const arr = Array.isArray(obj.movimientos) ? obj.movimientos : [obj]
    return arr.length > 0 ? arr as ParsedMovimiento[] : null
  }

  // ── Groq ──
  if (nluModel in GROQ_MODEL_IDS) {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL_IDS[nluModel],
        temperature: 0,
        max_tokens: 2048,
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
      return { parsed: extractItems(JSON.parse(data.choices[0].message.content)), tokensIn, tokensOut }
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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcript }],
      }),
    })
    const data = await resp.json()
    const tokensIn  = data.usage?.input_tokens  ?? 0
    const tokensOut = data.usage?.output_tokens ?? 0
    try {
      return { parsed: extractItems(JSON.parse(data.content[0].text)), tokensIn, tokensOut }
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

// FIX (B1): btoa(String.fromCharCode(...bytes)) hace spread de un argumento
// por byte y revienta el stack con imágenes de >~100 KB (tamaño normal de una
// foto de Telegram). Se convierte en chunks para mantener el stack acotado.
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000   // 32 KB por iteración, muy por debajo del límite de args
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

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

// Quita caracteres que rompen el parse_mode Markdown de Telegram (un solo
// '*' o '_' sin cerrar hace fallar el sendMessage COMPLETO y el bot queda mudo)
function mdSafe(s: string) {
  return s.replace(/[*_`\[\]]/g, '')
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
  update_id?:      number
  message?:        TelegramMessage
  callback_query?: CallbackQuery
}

interface TelegramMessage {
  chat:    { id: number }
  from?:   { id: number; first_name?: string; last_name?: string }
  voice?:  { file_id: string }
  text?:   string
  photo?:  Array<{ file_id: string; width: number; height: number }>
}

interface CallbackQuery {
  id:      string
  data:    string
  from:    { id: number; first_name?: string; last_name?: string }
  message: { chat: { id: number }; message_id: number }
}

interface ParsedMovimiento {
  producto_id:       number | null
  producto_nombre:   string | null
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
  tienda_id:  number | null
  empresas:   { nlu_model: string } | null
}
