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

    if (update.callback_query?.data?.startsWith('fotocompra_')) {
      await handleFotoConfirm(update.callback_query, 'ingreso')
      return
    }

    if (update.callback_query?.data?.startsWith('fotoventa_')) {
      await handleFotoConfirm(update.callback_query, 'venta')
      return
    }

    if (update.callback_query?.data?.startsWith('fotono_')) {
      await handleFotoCancel(update.callback_query)
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

  // Buscar empresa por token — puede ser el de operario o el de admin (014).
  // Se resuelve ANTES del chequeo de "ya registrado" para poder comparar: un
  // token de OTRA empresa debe permitir cambiar (re-vincular), no bloquear.
  const { data: empresa } = await supabase
    .from('empresas')
    .select('id, nombre, telegram_token, telegram_token_admin')
    .or(`telegram_token.eq.${token},telegram_token_admin.eq.${token}`)
    .eq('activa', true)
    .maybeSingle()

  if (!empresa) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '❌ Token inválido o empresa desactivada.\nVerificá el token con tu administrador.',
    })
    return
  }

  // ¿Ya está registrado?
  const { data: existente } = await supabase
    .from('usuarios')
    .select('id, nombre, empresa_id, tienda_id, tiendas(nombre)')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  // Ya registrado EN ESTA MISMA empresa → nada que hacer. Si el token es de otra
  // empresa, NO retornamos: caemos al flujo de sedes para re-vincular (switch).
  if (existente && existente.empresa_id === empresa.id) {
    const tiendaNombre = (existente.tiendas as any)?.nombre ?? 'Sin asignar'
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        `✅ Ya estás registrado.\n\n` +
        `🏢 Empresa: *${empresa.nombre}*\n` +
        `📍 Sede: *${tiendaNombre}*\n\n` +
        `Podés enviar notas de voz para registrar movimientos.`,
      parse_mode: 'Markdown',
    })
    return
  }

  const esAdmin       = empresa.telegram_token_admin === token
  const cambioEmpresa = !!existente   // existe pero en otra empresa → re-vinculación

  // ADMIN: NO se le pide sede — un administrador ve TODAS las sedes. Se registra
  // directo con tienda_id = null (los reportes filtran por empresa, no por sede).
  // Solo el vendedor elige una sede (su stock vive en una tienda concreta).
  if (esAdmin) {
    const nombre = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ')
    const datos  = { nombre, rol: 'admin', tienda_id: null, empresa_id: empresa.id }
    const { error } = existente
      ? await supabase.from('usuarios').update(datos).eq('id', existente.id)
      : await supabase.from('usuarios').insert({ telegram_id: telegramUserId, ...datos })

    if (error) {
      console.error('[handleStart admin] upsert error:', error)
      await tg('sendMessage', { chat_id: chatId, text: `❌ Error al registrar: ${error.message}` })
      return
    }

    await tg('sendMessage', {
      chat_id: chatId,
      text:
        (cambioEmpresa ? `✅ *¡Empresa cambiada!*\n\n` : `✅ *¡Registrado como administrador!*\n\n`) +
        `🏢 Empresa: *${empresa.nombre}*\n` +
        `👤 Rol: *Administrador*\n` +
        `🌐 Acceso: *todas las sedes*\n\n` +
        `Podés pedir reportes por voz/texto y registrar movimientos.`,
      parse_mode: 'Markdown',
    })
    return
  }

  // Listar sedes de la empresa (solo vendedores)
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
      (cambioEmpresa
        ? `Vas a *cambiar* a *${empresa.nombre}*`
        : `Te vas a registrar en *${empresa.nombre}*`) + `.\n\n` +
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

  // Verificar token — operario o admin (014). El rol se deriva del que coincidió.
  const { data: empresa } = await supabase
    .from('empresas')
    .select('id, nombre, telegram_token, telegram_token_admin')
    .or(`telegram_token.eq.${token},telegram_token_admin.eq.${token}`)
    .eq('activa', true)
    .maybeSingle()

  if (!empresa) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: '❌ Token expirado. Pedí un nuevo link al administrador.',
    })
    return
  }

  const rol = empresa.telegram_token_admin === token ? 'admin' : 'vendedor'

  // ¿Existe ya una cuenta para este telegram_id? Si está en ESTA empresa es un
  // doble tap (no hacemos nada); si está en OTRA, es un cambio de empresa y la
  // re-vinculamos (UPDATE). Si no existe, la creamos (INSERT) más abajo.
  const { data: existente } = await supabase
    .from('usuarios')
    .select('id, empresa_id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  if (existente && existente.empresa_id === empresa.id) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: '⚠️ Ya tenés una cuenta registrada en esta empresa.',
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

  // Re-vincular (cambio de empresa) o alta nueva. Keyed por telegram_id.
  const nombre = [cb.from.first_name, cb.from.last_name].filter(Boolean).join(' ')
  const datos  = { nombre, rol, tienda_id: tiendaId, empresa_id: empresa.id }
  const { error } = existente
    ? await supabase.from('usuarios').update(datos).eq('id', existente.id)
    : await supabase.from('usuarios').insert({ telegram_id: telegramUserId, ...datos })

  if (error) {
    console.error('[handleJoin] upsert error:', error)
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: `❌ Error al registrar: ${error.message}`,
    })
    return
  }

  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text:
      (existente ? `✅ *¡Empresa cambiada!*\n\n` : `✅ *¡Registrado exitosamente!*\n\n`) +
      `🏢 Empresa: *${empresa.nombre}*\n` +
      `📍 Sede: *${tienda?.nombre}*\n` +
      `👤 Rol: *${rol === 'admin' ? 'Administrador' : 'Operario'}*\n\n` +
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

  // El rubro de la empresa del operario personaliza el prompt de visión.
  // Si el usuario no está registrado, handleTranscript lo rechaza después.
  const { data: usuarioFoto } = await supabase
    .from('usuarios')
    .select('empresas(rubro)')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()
  const rubro = ((usuarioFoto?.empresas as { rubro?: string } | null)?.rubro ?? '').trim() || 'ferretería'

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
            text: `Eres el asistente de inventario de un negocio de ${rubro}.
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

  await handleTranscript(chatId, telegramUserId, descripcion, true)   // 016: pide confirmación
}

// ─── NLU → INSERT → Confirmar ────────────────────────────────────────────────

async function handleTranscript(
  chatId: number,
  telegramUserId: number | undefined,
  transcript: string,
  confirmar = false,   // true para fotos (016): estaciona y pide confirmación en vez de insertar
) {
  // Buscar usuario + modelo NLU de su empresa en una sola query
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, empresa_id, tienda_id, rol, empresas(nlu_model, rubro)')
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
  const rubro     = (usuario.empresas?.rubro ?? '').trim() || 'ferretería'
  const esAdmin   = usuario.rol === 'admin'

  // Cargar catálogos filtrados por empresa
  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', empresaId).limit(200),
    supabase.from('tiendas').select('id, nombre').eq('empresa_id', empresaId).eq('activa', true),
  ])

  const listaProd   = (productos ?? []).map(p => `${p.id}|${p.nombre}`).join('\n')
  const listaTienda = (tiendas   ?? []).map(t => `${t.id}|${t.nombre}`).join('\n')

  // Bloque de detección de reportes — SIEMPRE presente, también para vendedores.
  // El gate de seguridad vive en el handler (rama esAdmin → "acceso denegado").
  // Si el bloque fuera solo-admin, un vendedor que pide un reporte caería en el
  // flujo de movimientos y recibiría "no entendí" en vez del aviso de permiso.
  const reporteBloque = `
PRIMERO decidí la INTENCIÓN del mensaje:

A) CONSULTA / REPORTE — el mensaje PIDE información, no registra nada.
   Son preguntas o pedidos: "¿cuánto vendí hoy?", "reporte de la semana",
   "cómo van las ventas del mes", "ventas de la tienda Centro",
   "muéstrame el stock de cemento", "¿cuánto stock hay de varilla?".
   Respondé SOLO con este JSON (NADA de "movimientos"):
   {
     "tipo": "reporte",
     "periodo": <"hoy"|"semana"|"mes">,   // si no se especifica, usá "hoy"
     "tienda_nombre": <nombre de tienda mencionado tal cual, o null>,
     "producto": <nombre de producto si pide stock de uno puntual, o null>
   }

B) REGISTRO — el mensaje DECLARA acciones ya hechas ("vendí 3 tubos",
   "entraron 10 bolsas"). En ese caso usá el formato de "movimientos" de abajo.

Distinción clave: las consultas son PREGUNTAS sobre datos existentes;
los registros son AFIRMACIONES de algo que ya pasó. Ante la duda entre
ambos, asumí REGISTRO.

`

  const systemPrompt = `Eres el asistente de inventario de un negocio de ${rubro} en Perú.
${reporteBloque}Extrae TODOS los productos mencionados y responde SOLO con JSON válido:
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

  const { parsed: items, reporte, tokensIn, tokensOut } = await callNLU(nluModel, systemPrompt, transcript)

  // Rama de reportes. El prompt detecta la intención para TODOS (así un vendedor
  // recibe el aviso de permiso en vez de "no entendí"); el gate real es esAdmin.
  if (reporte) {
    logConsumo(empresaId, nluModel, tokensIn, tokensOut, 'reporte').catch(console.error)
    if (!esAdmin) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: '🔒 Los reportes están disponibles solo para administradores.',
      })
      return
    }
    await handleReporte(chatId, empresaId, reporte)
    return
  }

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

  logConsumo(empresaId, nluModel, tokensIn, tokensOut, 'nlu').catch(console.error)

  // Foto (016): no insertamos de inmediato — estacionamos en foto_pendiente y
  // pedimos confirmación. Voz/texto siguen el camino directo de abajo.
  if (confirmar) {
    await estacionarFoto(chatId, telegramUserId, empresaId, items, tiendas, transcript)
    return
  }

  await insertarMovimientos(chatId, empresaId, usuario, items, tiendas, productos, transcript)
}

// ─── Insert de movimientos ────────────────────────────────────────────────────
// Compartido por el flujo voz/texto (inmediato) y la confirmación de foto (016,
// diferido). Auto-crea productos que no estén en el catálogo, inserta los
// movimientos y manda el mensaje con los botones de Deshacer.

async function insertarMovimientos(
  chatId: number,
  empresaId: string,
  usuario: { id: string; tienda_id: number | null },
  items: ParsedMovimiento[],
  tiendas: Array<{ id: number; nombre: string }> | null,
  productos: Array<{ id: number; nombre: string }> | null,
  transcript: string,
) {
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

// ─── Confirmación de fotos (016) ──────────────────────────────────────────────
// Una foto no se inserta directo: se estaciona en foto_pendiente (JSONB) y se
// pide confirmación. Confirmar → insertarMovimientos + borrar; Cancelar → borrar.
// Los productos nuevos recién se crean al confirmar (una foto cancelada no
// ensucia el catálogo), porque insertarMovimientos hace el auto-create.

// Fija la dirección de TODOS los ítems de una foto a venta o ingreso (compra).
// Una factura es ambigua (¿la vendí o la compré?), así que NO asumimos: el
// operario elige. El monto se reubica según el tipo elegido: en venta vive en
// precio_unitario, en ingreso (compra) en costo_unitario (regla del systemPrompt).
// gasto/traslado quedan intactos (no son parte de la disyuntiva compra/venta).
function aplicarDireccion(items: ParsedMovimiento[], destino: 'venta' | 'ingreso'): ParsedMovimiento[] {
  return items.map(it => {
    if (it.tipo !== 'venta' && it.tipo !== 'ingreso') return it
    const monto = Number(it.precio_unitario ?? 0) || Number(it.costo_unitario ?? 0)
    return destino === 'ingreso'
      ? { ...it, tipo: 'ingreso', costo_unitario: monto, precio_unitario: 0 }
      : { ...it, tipo: 'venta',   precio_unitario: monto, costo_unitario: 0 }
  })
}

// Arma texto + teclado de la confirmación de foto. Muestra los productos de
// forma neutral (sin presumir tipo) y deja que el usuario elija Compra o Venta;
// recién al tocar uno se fija la dirección y se registra.
function construirPreviewFoto(pendId: number, items: ParsedMovimiento[], transcript: string) {
  const lineas = items.map(it => {
    const monto = Number(it.precio_unitario ?? 0) || Number(it.costo_unitario ?? 0)
    const montoTxt = monto > 0 ? ` · S/. ${monto.toFixed(2)} c/u` : ''
    return `• *${mdSafe(it.producto_nombre ?? '—')}* × ${it.cantidad ?? '?'}${montoTxt}`
  })

  return {
    text:
      `🖼️ *Revisá lo que entendí de la foto:*\n` +
      `🗒️ "${mdSafe(transcript)}"\n\n` +
      lineas.join('\n') +
      `\n\n¿Es una *compra* o una *venta*?`,
    parse_mode: 'Markdown' as const,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📦 Compra', callback_data: `fotocompra_${pendId}` },
          { text: '💰 Venta',  callback_data: `fotoventa_${pendId}` },
        ],
        [{ text: '❌ Cancelar', callback_data: `fotono_${pendId}` }],
      ],
    },
  }
}

async function estacionarFoto(
  chatId: number,
  telegramUserId: number | undefined,
  empresaId: string,
  items: ParsedMovimiento[],
  tiendas: Array<{ id: number; nombre: string }> | null,
  transcript: string,
) {
  const { data: pend, error } = await supabase
    .from('foto_pendiente')
    .insert({
      telegram_id:   telegramUserId,
      empresa_id:    empresaId,
      movimientos:   items,         // JSONB: el array crudo del NLU (producto_id puede ser null)
      transcripcion: transcript,
    })
    .select('id')
    .single()

  if (error || !pend) {
    console.error('[estacionarFoto] insert error:', error)
    await tg('sendMessage', { chat_id: chatId, text: '❌ No pude preparar la confirmación. Reenviá la foto.' })
    return
  }

  // Vista previa de lo entendido (sin tienda: el default se resuelve al insertar).
  const preview = construirPreviewFoto(pend.id, items, transcript)
  await tg('sendMessage', { chat_id: chatId, ...preview })
}

// El usuario eligió Compra o Venta sobre una foto pendiente. Fija esa dirección
// en los ítems y registra. destino lo decide el prefijo del callback
// (fotocompra_ → ingreso, fotoventa_ → venta).
async function handleFotoConfirm(cb: CallbackQuery, destino: 'venta' | 'ingreso') {
  const chatId         = cb.message.chat.id
  const msgId          = cb.message.message_id
  const telegramUserId = cb.from.id
  const pendId         = parseInt(cb.data.split('_')[1])   // fotocompra_<id> | fotoventa_<id>

  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  // Borrar PRIMERO y verificar pertenencia en el mismo paso: si la fila ya no
  // está (doble tap / ya cancelada), el delete no devuelve filas → no insertamos
  // dos veces (evita stock duplicado). El filtro telegram_id impide que otro
  // usuario confirme una foto ajena.
  const { data: borradas } = await supabase
    .from('foto_pendiente')
    .delete()
    .eq('id', pendId)
    .eq('telegram_id', telegramUserId)
    .select('id, empresa_id, movimientos, transcripcion')

  const pend = borradas?.[0] as
    { id: number; empresa_id: string; movimientos: ParsedMovimiento[]; transcripcion: string | null } | undefined

  if (!pend) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: '⚠️ Esta confirmación ya no está disponible.',
    })
    return
  }

  // Re-resolver contexto para el insert (usuario + catálogos de su empresa).
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, tienda_id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  if (!usuario) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: '⛔ Tu cuenta ya no está registrada en el sistema.',
    })
    return
  }

  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', pend.empresa_id).limit(200),
    supabase.from('tiendas').select('id, nombre').eq('empresa_id', pend.empresa_id).eq('activa', true),
  ])

  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text: destino === 'ingreso' ? '📦 Compra confirmada — registrando...' : '💰 Venta confirmada — registrando...',
  })

  // insertarMovimientos manda su propio mensaje con el detalle + botones Deshacer.
  await insertarMovimientos(
    chatId,
    pend.empresa_id,
    usuario as { id: string; tienda_id: number | null },
    aplicarDireccion(pend.movimientos, destino),
    tiendas,
    productos,
    pend.transcripcion ?? '',
  )
}

async function handleFotoCancel(cb: CallbackQuery) {
  const chatId         = cb.message.chat.id
  const msgId          = cb.message.message_id
  const telegramUserId = cb.from.id
  const pendId         = parseInt(cb.data.split('_')[1])   // fotono_<id>

  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  await supabase
    .from('foto_pendiente')
    .delete()
    .eq('id', pendId)
    .eq('telegram_id', telegramUserId)

  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text: '❌ Descartado. No se registró nada.',
  })
}

// ─── Reportes (solo admins) ───────────────────────────────────────────────────

// Inicio del período en hora Perú (UTC-5 fijo, sin DST). created_at se guarda en
// UTC; si calculáramos "hoy" con la fecha UTC, entre las 19:00 y medianoche Perú
// (00:00–05:00 UTC del día siguiente) el reporte mostraría datos del día equivocado.
function inicioPeriodoPeru(periodo: 'hoy' | 'semana' | 'mes'): { desdeIso: string; titulo: string } {
  const PERU_OFFSET_MS = 5 * 60 * 60 * 1000
  const nowPeru = new Date(Date.now() - PERU_OFFSET_MS)   // componentes UTC == reloj de pared Perú
  const y = nowPeru.getUTCFullYear()
  const m = nowPeru.getUTCMonth()
  const d = nowPeru.getUTCDate()
  const diasAtras = periodo === 'hoy' ? 0 : periodo === 'semana' ? 6 : 29
  // Medianoche Perú del día (hoy - diasAtras), reconvertida a UTC.
  const desdeMs = Date.UTC(y, m, d - diasAtras, 0, 0, 0) + PERU_OFFSET_MS
  const titulo = periodo === 'hoy' ? 'Hoy' : periodo === 'semana' ? 'Últimos 7 días' : 'Últimos 30 días'
  return { desdeIso: new Date(desdeMs).toISOString(), titulo }
}

async function handleReporte(chatId: number, empresaId: string, rep: ParsedReporte) {
  // ── Modo A: stock actual de un producto puntual (ignora período) ──
  if (rep.producto) {
    const { data: prods } = await supabase
      .from('productos')
      .select('id, nombre')
      .eq('empresa_id', empresaId)               // regla #1: siempre por empresa
      .ilike('nombre', `%${rep.producto}%`)      // regla #3: match parcial
      .limit(20)

    if (!prods || prods.length === 0) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `🔍 No encontré ningún producto que coincida con *${mdSafe(rep.producto)}*.`,
        parse_mode: 'Markdown',
      })
      return
    }

    const ids = prods.map(p => p.id)
    const { data: stockRows } = await supabase
      .from('stock')
      .select('cantidad, producto_id, tiendas(nombre), productos!inner(empresa_id)')
      .in('producto_id', ids)
      .eq('productos.empresa_id', empresaId)      // regla #1 (defensa en profundidad)

    const porProducto = new Map<number, Array<{ tienda: string; cantidad: number }>>()
    for (const s of (stockRows ?? []) as Array<{ cantidad: number; producto_id: number; tiendas: { nombre: string } | null }>) {
      const arr = porProducto.get(s.producto_id) ?? []
      arr.push({ tienda: s.tiendas?.nombre ?? '—', cantidad: Number(s.cantidad ?? 0) })
      porProducto.set(s.producto_id, arr)
    }

    const bloques = prods.map(p => {
      const filas = porProducto.get(p.id) ?? []
      const total = filas.reduce((acc, f) => acc + f.cantidad, 0)
      const detalle = filas.length
        ? filas.map(f => `   • ${mdSafe(f.tienda)}: *${f.cantidad}* u.`).join('\n')
        : '   _(sin stock registrado)_'
      return `📦 *${mdSafe(p.nombre)}* — total *${total}* u.\n${detalle}`
    })

    await tg('sendMessage', {
      chat_id: chatId,
      text: `📊 *Stock actual*\n\n${bloques.join('\n\n')}`,
      parse_mode: 'Markdown',
    })
    return
  }

  // ── Modo B: reporte de ventas del período ──
  const { desdeIso, titulo } = inicioPeriodoPeru(rep.periodo)

  // Resolver sede por nombre parcial (regla #3) si se mencionó una.
  let tiendaId: number | null = null
  let tiendaNombre: string | null = null
  if (rep.tienda_nombre) {
    const { data: t } = await supabase
      .from('tiendas')
      .select('id, nombre')
      .eq('empresa_id', empresaId)               // regla #1
      .ilike('nombre', `%${rep.tienda_nombre}%`)
      .limit(1)
      .maybeSingle()
    if (!t) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `🔍 No encontré ninguna sede que coincida con *${mdSafe(rep.tienda_nombre)}*.`,
        parse_mode: 'Markdown',
      })
      return
    }
    tiendaId = t.id
    tiendaNombre = t.nombre
  }

  // Ventas del período. movimientos no tiene empresa_id → el scoping multi-tenant
  // va por el join productos!inner(empresa_id) (regla #1). Top 5 es solo ventas
  // (regla #5), por eso filtramos tipo = 'venta' acá mismo.
  let q = supabase
    .from('movimientos')
    .select('cantidad, total, tienda_origen, productos!inner(nombre, empresa_id)')
    .eq('tipo', 'venta')
    .eq('productos.empresa_id', empresaId)
    .gte('created_at', desdeIso)
  if (tiendaId) q = q.eq('tienda_origen', tiendaId)
  const { data: ventas } = await q as { data: Array<{ cantidad: number; total: number; productos: { nombre: string } | null }> | null }

  // regla #4: sin datos → mensaje claro, no ceros.
  if (!ventas || ventas.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        `📊 No hay movimientos registrados para ese período ` +
        `(_${titulo.toLowerCase()}_${tiendaNombre ? `, sede ${mdSafe(tiendaNombre)}` : ''}).`,
      parse_mode: 'Markdown',
    })
    return
  }

  let totalVentas = 0
  const porProd = new Map<string, { cantidad: number; monto: number }>()
  for (const v of ventas) {
    const monto = Number(v.total ?? 0)
    totalVentas += monto
    const nombre = v.productos?.nombre ?? '—'
    const acc = porProd.get(nombre) ?? { cantidad: 0, monto: 0 }
    acc.cantidad += Number(v.cantidad ?? 0)
    acc.monto    += monto
    porProd.set(nombre, acc)
  }

  const numVentas = ventas.length
  const ticket    = totalVentas / numVentas
  const top = [...porProd.entries()]
    .sort((a, b) => b[1].monto - a[1].monto)
    .slice(0, 5)
    .map(([nombre, v], i) =>
      `${i + 1}. ${mdSafe(nombre)} — *${v.cantidad}* u. · S/. ${v.monto.toFixed(2)}`)
    .join('\n')

  await tg('sendMessage', {
    chat_id: chatId,
    text:
      `📊 *Reporte de ventas — ${titulo}*` +
      (tiendaNombre ? `\n🏪 Sede: *${mdSafe(tiendaNombre)}*` : '') + `\n\n` +
      `💰 Total vendido: *S/. ${totalVentas.toFixed(2)}*\n` +
      `🧾 N° de ventas: *${numVentas}*\n` +
      `🎟️ Ticket promedio: *S/. ${ticket.toFixed(2)}*\n\n` +
      `🏆 *Top productos:*\n${top}`,
    parse_mode: 'Markdown',
  })
}

// ─── NLU multi-modelo ─────────────────────────────────────────────────────────

async function callNLU(
  nluModel: string,
  systemPrompt: string,
  transcript: string,
): Promise<{ parsed: ParsedMovimiento[] | null; reporte: ParsedReporte | null; tokensIn: number; tokensOut: number }> {

  // El NLU puede devolver un REPORTE (rama admin del prompt) o MOVIMIENTOS.
  // Un reporte es un objeto PLANO con tipo === 'reporte'. Los movimientos vienen
  // bajo la clave "movimientos" — o, en el peor caso, como un objeto suelto cuyo
  // tipo es venta/ingreso/gasto/traslado, nunca 'reporte', así que no colisiona.
  function classify(raw: unknown): { items: ParsedMovimiento[] | null; reporte: ParsedReporte | null } {
    if (!raw || typeof raw !== 'object') return { items: null, reporte: null }
    const obj = raw as Record<string, unknown>
    if (obj.tipo === 'reporte') {
      const periodo = obj.periodo === 'semana' || obj.periodo === 'mes' ? obj.periodo : 'hoy'
      return {
        items: null,
        reporte: {
          periodo,
          tienda_nombre: typeof obj.tienda_nombre === 'string' && obj.tienda_nombre.trim() ? obj.tienda_nombre.trim() : null,
          producto:      typeof obj.producto      === 'string' && obj.producto.trim()      ? obj.producto.trim()      : null,
        },
      }
    }
    const arr = Array.isArray(obj.movimientos) ? obj.movimientos : [obj]
    return { items: arr.length > 0 ? arr as ParsedMovimiento[] : null, reporte: null }
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
      const c = classify(JSON.parse(data.choices[0].message.content))
      return { parsed: c.items, reporte: c.reporte, tokensIn, tokensOut }
    } catch {
      return { parsed: null, reporte: null, tokensIn, tokensOut }
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
      const c = classify(JSON.parse(data.content[0].text))
      return { parsed: c.items, reporte: c.reporte, tokensIn, tokensOut }
    } catch {
      return { parsed: null, reporte: null, tokensIn, tokensOut }
    }
  }

  return { parsed: null, reporte: null, tokensIn: 0, tokensOut: 0 }
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
  rol:        string | null
  empresas:   { nlu_model: string; rubro?: string | null } | null
}

interface ParsedReporte {
  periodo:       'hoy' | 'semana' | 'mes'
  tienda_nombre: string | null
  producto:      string | null
}
