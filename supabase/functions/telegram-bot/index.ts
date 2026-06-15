// supabase/functions/telegram-bot/index.ts
// Bot de Telegram para Agent GMS.
//
// Soporta: voz (Groq Whisper STT) · texto · foto (Groq Vision)
// NLU multi-modelo: groq-llama · anthropic-haiku · anthropic-sonnet
// Consumo diferenciado por empresa en tabla consumo_ia.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { construirTarjeta, type TarjetaItem, type TarjetaOpciones } from './tarjeta.ts'

// ─── Constantes ───────────────────────────────────────────────────────────────

const BOT_TOKEN     = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const GROQ_KEY      = Deno.env.get('GROQ_API_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const TG_API        = `https://api.telegram.org/bot${BOT_TOKEN}`
const TG_FILE       = `https://api.telegram.org/file/bot${BOT_TOKEN}`

// Deep-link a reportes del dashboard (018, paso H). Mientras el dominio no esté
// comprado, queda vacío y el link NO se incluye en los reportes (feature dormida).
const DASHBOARD_BASE_URL = Deno.env.get('DASHBOARD_BASE_URL') ?? ''

// Auto-confirmación de voz/texto (018, decisión #2): 5s con cuenta regresiva.
const AUTO_CONFIRM_SEGUNDOS = 5
// Umbral de confianza del NLU bajo el cual NO se auto-confirma (decisión #3).
const CONFIANZA_MINIMA_AUTO = 0.7
// Ventana de auto-reversión del vendedor (018, decisión #10).
const UNDO_VENTANA_MS = 5 * 60 * 1000

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
    const cb = update.callback_query
    if (cb?.data) {
      if (cb.data.startsWith('undo_'))      { await handleUndo(cb);        return }
      if (cb.data.startsWith('join_'))      { await handleJoin(cb);        return }
      if (cb.data.startsWith('adminmodo:')) { await handleAdminModo(cb);   return }
      if (cb.data.startsWith('adminsede:')) { await handleAdminSede(cb);   return }
      if (cb.data.startsWith('fototipo:'))  { await handleFotoTipo(cb);    return }
      if (cb.data.startsWith('confirmar:')) { await handleConfirmarCb(cb); return }
      if (cb.data.startsWith('corregir:'))  { await handleCorregirCb(cb);  return }
      if (cb.data.startsWith('cancelar:'))  { await handleCancelarCb(cb);  return }
      return
    }

    const msg = update.message
    if (!msg) return

    if (msg.text?.startsWith('/start')) {
      await handleStart(msg)
      return
    }

    // /cancelar universal (decisión #7): prioridad alta, antes de cualquier
    // interpretación. Por texto exacto acá; por voz se chequea tras transcribir.
    if (msg.text && esComandoCancelar(msg.text)) {
      await handleCancelarUniversal(msg.chat.id, msg.from?.id)
      return
    }

    if (msg.voice) {
      await handleVoice(msg)
      return
    }

    if (msg.text && !msg.text.startsWith('/')) {
      await handleTextoEntrante(msg)
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

  const esAdmin       = empresa.telegram_token_admin === token
  const cambioEmpresa = !!existente   // existe pero en otra empresa → re-vinculación

  // Vendedor ya registrado EN ESTA MISMA empresa → nada que hacer. (Para admin NO
  // cortamos: dejamos que la rama admin de abajo re-aplique rol/tienda_id=null,
  // así un admin que quedó atado a una sede se corrige reenviando /start.)
  // Si el token es de otra empresa tampoco cortamos: caemos a re-vincular (switch).
  if (existente && existente.empresa_id === empresa.id && !esAdmin) {
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

  // ADMIN (decisión #8): NO se registra directo. Se pregunta el MODO — solo
  // consulta (tienda_id=null) o con sede asignada (elige sede default). El upsert
  // ocurre en handleAdminModo/handleAdminSede. Reenviar /start re-pregunta (re-vínculo).
  if (esAdmin) {
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        `👋 *Token admin reconocido* (${mdSafe(empresa.nombre)}). ¿Qué modo de admin usarás?\n\n` +
        `📊 *Solo consulta* → ves reportes consolidados, no registrás movimientos.\n` +
        `📦 *Con sede asignada* → registrás movimientos y ves reportes.`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Solo consulta',     callback_data: `adminmodo:consulta:${token}` }],
          [{ text: '📦 Con sede asignada', callback_data: `adminmodo:sede:${token}` }],
        ],
      },
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
    .select('id, created_at, productos!inner(empresa_id)')
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

  // Decisión #10: ventana de 5 min. Si CUALQUIER movimiento del lote la excede,
  // no se revierte acá — el admin lo hace desde el dashboard (con audit log).
  const ahora = Date.now()
  const vencido = (propios ?? []).some(m => ahora - new Date(m.created_at as string).getTime() > UNDO_VENTANA_MS)
  if (vencido) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '⏱ Ventana de reversión vencida (5 min). Pedile al admin que lo revierta desde el dashboard.',
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

// ─── Voz → STT → procesarRegistro ───────────────────────────────────────────

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

  // /cancelar por voz (decisión #7): la transcripción es solo "cancelar".
  if (esComandoCancelar(transcript)) {
    await handleCancelarUniversal(chatId, telegramUserId)
    return
  }

  // La corrección de un ítem va por TEXTO; una nota de voz durante la edición no
  // se interpreta como nuevo registro (decisión #6).
  if (await pendienteEnEdicion(telegramUserId)) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '✏️ Estás en modo edición de un registro pendiente. Terminá o enviá /cancelar.',
    })
    return
  }

  await procesarRegistro(chatId, telegramUserId, 'voz', transcript)
}

// ─── Foto → pregunta tipo (Vision recién al elegir, decisión #4) ─────────────

async function handlePhoto(message: TelegramMessage) {
  const chatId         = message.chat.id
  const telegramUserId = message.from?.id

  // No interrumpir una edición en curso (decisión #6).
  if (await pendienteEnEdicion(telegramUserId)) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '✏️ Estás en modo edición de un registro pendiente. Terminá o enviá /cancelar.',
    })
    return
  }

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('rol, modo_admin, empresa_id')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  if (!usuario?.empresa_id) {
    await tg('sendMessage', { chat_id: chatId, text: '⛔ Tu cuenta de Telegram no está registrada en el sistema.' })
    return
  }
  if (usuario.rol === 'admin' && usuario.modo_admin === 'consulta') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '📊 Tu cuenta está en modo consulta. No registrás movimientos.\nReenviá /start con tu token para cambiar de modo.',
    })
    return
  }

  // Decisión #4: NO se llama a Vision todavía. Guardamos solo el file_id y
  // preguntamos el tipo; Vision corre recién al elegir Compra/Venta (no se gasta
  // en fotos canceladas).
  const photo = message.photo![message.photo!.length - 1]

  const { data: pend } = await supabase
    .from('movimiento_pendiente')
    .insert({
      empresa_id:  usuario.empresa_id,
      telegram_id: telegramUserId,
      channel:     'foto',
      tipo:        null,
      file_id:     photo.file_id,
      items:       [],
    })
    .select('id')
    .single()

  if (!pend) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No pude preparar la foto. Reenviála.' })
    return
  }

  const res = await tg('sendMessage', {
    chat_id: chatId,
    text: '📷 Foto recibida. ¿Es Compra o Venta?',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📦 Compra', callback_data: `fototipo:compra:${pend.id}` },
          { text: '💰 Venta',  callback_data: `fototipo:venta:${pend.id}` },
        ],
        [{ text: '❌ Cancelar', callback_data: `cancelar:${pend.id}` }],
      ],
    },
  })
  const mid = res?.result?.message_id
  if (mid) await supabase.from('movimiento_pendiente').update({ card_message_id: mid }).eq('id', pend.id)
}

// ─── NLU → tarjeta de revisión (voz/texto) ───────────────────────────────────

// Prompt del NLU con el contrato 018 (intent/tipo/tipo_explicito/confianza/items).
function construirSystemPrompt(rubro: string, listaProd: string, listaTienda: string): string {
  return `Eres el asistente de inventario de un negocio de ${rubro} en Perú.
Decidí la INTENCIÓN del mensaje y respondé SOLO con JSON válido.

A) CONSULTA / REPORTE — el mensaje PIDE información ("¿cuánto vendí hoy?",
   "reporte de la semana", "stock de cemento", "ventas de la sede Centro"):
   {
     "intent": "reporte",
     "periodo": "hoy"|"semana"|"mes",
     "tienda_nombre": <nombre de tienda mencionado, o null>,
     "producto": <nombre de producto si pide stock puntual, o null>
   }

B) REGISTRO — el mensaje DECLARA un movimiento ya hecho ("vendí 3 tubos",
   "entraron 10 bolsas"):
   {
     "intent": "registro",
     "tipo": "compra"|"venta"|"ingreso"|"traslado",
     "tipo_explicito": true|false,
     "confianza": 0.0-1.0,
     "items": [ { "nombre": <nombre limpio>, "cantidad": <entero>, "precio": <por unidad, 0 si no se dice> } ]
   }

Reglas:
- "vendí/vendimos/despaché/salió" → "venta". "compré/compramos" → "compra".
  "entró/llegó/recibí/ingresó" → "ingreso". "trasladé/mandé a" → "traslado".
- tipo_explicito = true SOLO si hay un VERBO claro (vendí, compré, ingresó, llegó,
  salió, despaché, recibí). false si el tipo se infiere por contexto débil
  (ej: "3 tubos a 2.50" sin verbo).
- confianza = qué tan seguro estás del TIPO (1.0 verbo clarísimo; <0.7 si dudás).
- precio es POR UNIDAD. Si dicen un total ("3 tubos por 30 en total"), dividí entre la cantidad.
- nombre normalizado (ej: "Bomba 2 pulgadas"). "Caño", "tubo", "codo", "llave",
  "válvula" son productos DISTINTOS entre sí.
- Generá un item por cada producto mencionado.
- Ante la duda entre consulta y registro, asumí REGISTRO.

CATÁLOGO DE PRODUCTOS (referencia de nombres):
${listaProd || '(vacío)'}
CATÁLOGO DE TIENDAS (id|nombre):
${listaTienda}`
}

// Flujo compartido voz/texto: NLU → reporte o tarjeta de revisión (con
// auto-confirmación si el tipo es explícito y la confianza es alta).
async function procesarRegistro(
  chatId: number,
  telegramUserId: number | undefined,
  channel: 'voz' | 'texto',
  transcript: string,
) {
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, empresa_id, tienda_id, rol, modo_admin, empresas(nlu_model, rubro)')
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

  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', empresaId).limit(200),
    supabase.from('tiendas').select('id, nombre').eq('empresa_id', empresaId).eq('activa', true),
  ])
  const listaProd   = (productos ?? []).map(p => `${p.id}|${p.nombre}`).join('\n')
  const listaTienda = (tiendas   ?? []).map(t => `${t.id}|${t.nombre}`).join('\n')

  const nlu = await callNLU(nluModel, construirSystemPrompt(rubro, listaProd, listaTienda), transcript)

  // ── Reporte (decisión #9: vendedor también, scoped a su sede) ──
  if (nlu.intent === 'reporte' && nlu.reporte) {
    logConsumo(empresaId, nluModel, nlu.tokensIn, nlu.tokensOut, 'reporte').catch(console.error)
    await handleReporte(chatId, usuario, nlu.reporte)
    return
  }

  logConsumo(empresaId, nluModel, nlu.tokensIn, nlu.tokensOut, 'nlu').catch(console.error)

  // ── Admin en modo consulta no registra (decisión #8) ──
  if (usuario.rol === 'admin' && usuario.modo_admin === 'consulta') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '📊 Tu cuenta está en modo consulta. No registrás movimientos.\nReenviá /start con tu token para cambiar de modo.',
    })
    return
  }

  if (nlu.items.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '❓ No entendí bien.\n\nIntentá decir: *"Vendí 5 tubos PVC a 2 soles"*',
      parse_mode: 'Markdown',
    })
    return
  }

  // Auto-confirmación (decisiones #2 y #3): solo voz/texto, con verbo explícito y
  // confianza alta. Sin eso, la tarjeta espera tap explícito.
  const autoConfirm = nlu.tipo_explicito && nlu.tipo !== null && nlu.confianza >= CONFIANZA_MINIMA_AUTO
  const autoConfirmAt = autoConfirm ? new Date(Date.now() + AUTO_CONFIRM_SEGUNDOS * 1000).toISOString() : null

  const total = nlu.items.reduce((s, it) => s + it.cantidad * it.precio, 0)
  const { data: pend } = await supabase
    .from('movimiento_pendiente')
    .insert({
      empresa_id:      empresaId,
      telegram_id:     telegramUserId,
      channel,
      tipo:            nlu.tipo,
      items:           nlu.items,
      total,
      transcripcion:   transcript,
      auto_confirm_at: autoConfirmAt,
    })
    .select('*')
    .single() as { data: MovPendiente | null }

  if (!pend) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No pude preparar la revisión. Reintentá.' })
    return
  }

  await enviarTarjeta(chatId, pend, autoConfirm ? { countdownSegundos: AUTO_CONFIRM_SEGUNDOS } : {})

  if (autoConfirm) {
    programarAutoConfirm(chatId, pend.id, telegramUserId)
  }
}

// ─── Insert de movimientos ────────────────────────────────────────────────────
// Inserción final, llamada por confirmarPendiente (voz/texto/foto) al confirmar
// la tarjeta. Auto-crea productos que no estén en el catálogo, inserta los
// movimientos y manda el mensaje con los botones de Deshacer (ventana 5 min).

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

  // Decisión #2: NO se ecoa la transcripción al chat (queda solo en backend).
  await tg('sendMessage', {
    chat_id: chatId,
    text:
      `${encabezado}\n\n` +
      lineas.join('\n\n') +
      (totalGeneral > 0 ? `\n\n💵 *Total: S/. ${totalGeneral.toFixed(2)}*` : '') +
      (omitidos > 0 ? `\n\n⚠️ _${omitidos} producto(s) no se registraron._` : '') +
      `\n\n_Tenés 5 minutos para deshacer._`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: keyboard,
    },
  })
}

// ─── Tarjeta de revisión unificada (018) ─────────────────────────────────────
// El pendiente vive en movimiento_pendiente hasta confirmar (manual o auto) o
// cancelar. Reemplaza por completo el flujo foto_pendiente (016/017).

function pendToTarjeta(pend: MovPendiente) {
  return { id: pend.id, channel: pend.channel, tipo: pend.tipo, items: pend.items ?? [] }
}

// Manda la tarjeta y guarda su message_id (para poder editarla luego).
async function enviarTarjeta(chatId: number, pend: MovPendiente, opciones: TarjetaOpciones) {
  const res = await tg('sendMessage', { chat_id: chatId, ...construirTarjeta(pendToTarjeta(pend), opciones) })
  const mid = res?.result?.message_id
  if (mid) await supabase.from('movimiento_pendiente').update({ card_message_id: mid }).eq('id', pend.id)
  return mid as number | undefined
}

// Re-renderiza la tarjeta sobre su mensaje (tras una edición de ítem).
async function refrescarTarjeta(chatId: number, pend: MovPendiente) {
  if (!pend.card_message_id) { await enviarTarjeta(chatId, pend, {}); return }
  await tg('editMessageText', {
    chat_id: chatId, message_id: pend.card_message_id,
    ...construirTarjeta(pendToTarjeta(pend), {}),
  })
}

// Pendiente activo más reciente del operario (cancelled = false).
async function pendienteActivo(telegramId: number | undefined): Promise<MovPendiente | null> {
  if (!telegramId) return null
  const { data } = await supabase
    .from('movimiento_pendiente')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('cancelled', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as MovPendiente | null) ?? null
}

async function pendienteEnEdicion(telegramId: number | undefined): Promise<boolean> {
  const p = await pendienteActivo(telegramId)
  return !!p?.editing_state
}

function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// /cancelar exacto (texto o voz transcrita), con tolerancia a puntuación/ruido.
function esComandoCancelar(text: string): boolean {
  const n = normalizar(text).replace(/[.!¡¿?]+$/g, '').trim()
  return n === '/cancelar' || n === 'cancelar'
}

// Decisión #7: limpia TODOS los pendientes activos del operario.
async function handleCancelarUniversal(chatId: number, telegramId: number | undefined) {
  if (!telegramId) return
  await supabase
    .from('movimiento_pendiente')
    .update({ cancelled: true, editing_state: null, editing_item_number: null, auto_confirm_at: null })
    .eq('telegram_id', telegramId)
    .eq('cancelled', false)
  await tg('sendMessage', { chat_id: chatId, text: '✅ Cancelado. Estás en estado neutro.' })
}

// Router de texto entrante (no /comando): edición en curso → corrección; si no → registro.
async function handleTextoEntrante(msg: TelegramMessage) {
  const chatId = msg.chat.id
  const telegramId = msg.from?.id
  const texto = msg.text!.trim()

  const pend = await pendienteActivo(telegramId)
  if (pend?.editing_state) {
    await handleEdicionInput(chatId, pend, texto)
    return
  }
  await procesarRegistro(chatId, telegramId, 'texto', texto)
}

// ─── Modo edición por ítem (decisión #6) ──────────────────────────────────────
async function handleEdicionInput(chatId: number, pend: MovPendiente, texto: string) {
  const items = pend.items ?? []

  if (pend.editing_state === 'asking_item_number') {
    const n = parseInt(texto, 10)
    if (Number.isNaN(n) || n < 1 || n > items.length) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `Número fuera de rango. Enviá un número entre 1 y ${items.length} o /cancelar.`,
      })
      return
    }
    await supabase.from('movimiento_pendiente')
      .update({ editing_item_number: n, editing_state: 'asking_values' })
      .eq('id', pend.id)
    const it = items[n - 1]
    const actual = `${it.nombre} — ${it.cantidad} × S/${it.precio.toFixed(2)} = S/${(it.cantidad * it.precio).toFixed(2)}`
    if (pend.card_message_id) {
      await tg('editMessageText', {
        chat_id: chatId, message_id: pend.card_message_id,
        text:
          `Ítem ${n} actual: ${actual}\n\n` +
          `Envía los nuevos valores en formato:\nnombre, cantidad, precio\n\n` +
          `Ejemplo: Tee PVC 1", 6, 1.30\n\nO /cancelar para volver.`,
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `cancelar:${pend.id}` }]] },
      })
    }
    return
  }

  if (pend.editing_state === 'asking_values') {
    const parsed = parseValoresItem(texto)
    if (!parsed) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'No entendí. Enviá: nombre, cantidad, precio (ej: Tee PVC 1", 6, 1.30) o /cancelar.',
      })
      return
    }
    const idx = (pend.editing_item_number ?? 0) - 1
    if (idx < 0 || idx >= items.length) {
      await supabase.from('movimiento_pendiente')
        .update({ editing_state: null, editing_item_number: null }).eq('id', pend.id)
      return
    }
    items[idx] = parsed
    const total = items.reduce((s, it) => s + it.cantidad * it.precio, 0)
    await supabase.from('movimiento_pendiente')
      .update({ items, total, editing_state: null, editing_item_number: null })
      .eq('id', pend.id)
    // Volver a la tarjeta completa con el ítem actualizado.
    await refrescarTarjeta(chatId, { ...pend, items, total, editing_state: null })
    return
  }
}

// Parsea "nombre, cantidad, precio". El nombre puede tener comas: los dos últimos
// campos son cantidad y precio, el resto es el nombre.
function parseValoresItem(texto: string): TarjetaItem | null {
  const partes = texto.split(',').map(s => s.trim()).filter(s => s.length > 0)
  if (partes.length < 3) return null
  const precioStr   = partes.pop()!
  const cantidadStr = partes.pop()!
  const nombre      = partes.join(', ').trim()
  const precio      = parseFloat(precioStr.replace(/[^\d.,]/g, '').replace(',', '.'))
  const cantidad    = parseInt(cantidadStr.replace(/[^\d]/g, ''), 10)
  if (!nombre || !Number.isFinite(precio) || precio < 0 || !Number.isInteger(cantidad) || cantidad <= 0) return null
  return { nombre, cantidad, precio }
}

// ─── Confirmación (manual + auto) ─────────────────────────────────────────────
// 'compra' del UX mapea a 'ingreso' del ledger; el resto pasa directo.
function mapTipoLedger(tipo: MovPendiente['tipo']): 'venta' | 'ingreso' | 'traslado' {
  if (tipo === 'compra' || tipo === 'ingreso') return 'ingreso'
  if (tipo === 'traslado') return 'traslado'
  return 'venta'
}

// Reclama el pendiente de forma atómica (cancelled=true devuelve fila SOLO si
// seguía activo → evita doble registro entre auto-confirm y tap) y registra.
async function confirmarPendiente(chatId: number, pendId: string, telegramId: number | undefined): Promise<boolean> {
  const { data: claim } = await supabase
    .from('movimiento_pendiente')
    .update({ cancelled: true })
    .eq('id', pendId)
    .eq('telegram_id', telegramId ?? -1)
    .eq('cancelled', false)
    .select('*')
  const pend = claim?.[0] as MovPendiente | undefined
  if (!pend || !pend.tipo || (pend.items ?? []).length === 0) return false

  const { data: usuario } = await supabase
    .from('usuarios').select('id, tienda_id').eq('telegram_id', telegramId).maybeSingle()
  if (!usuario) return false

  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', pend.empresa_id).limit(200),
    supabase.from('tiendas').select('id, nombre').eq('empresa_id', pend.empresa_id).eq('activa', true),
  ])

  const ledgerTipo = mapTipoLedger(pend.tipo)
  const items: ParsedMovimiento[] = pend.items.map(it => ({
    producto_id:       null,
    producto_nombre:   it.nombre,
    tipo:              ledgerTipo,
    cantidad:          it.cantidad,
    tienda_origen_id:  null,
    tienda_destino_id: null,
    precio_unitario:   ledgerTipo === 'ingreso' ? 0 : it.precio,
    costo_unitario:    ledgerTipo === 'ingreso' ? it.precio : 0,
  }))

  await insertarMovimientos(
    chatId, pend.empresa_id,
    usuario as { id: string; tienda_id: number | null },
    items, tiendas, productos,
    pend.transcripcion ?? '',
  )
  return true
}

// Agenda la auto-confirmación a los 5s (decisión #2) con waitUntil. Antes de
// confirmar verifica que el pendiente siga vivo y sin edición.
function programarAutoConfirm(chatId: number, pendId: string, telegramId: number | undefined) {
  const tarea = (async () => {
    await new Promise(r => setTimeout(r, AUTO_CONFIRM_SEGUNDOS * 1000))
    const { data } = await supabase
      .from('movimiento_pendiente')
      .select('cancelled, editing_state')
      .eq('id', pendId)
      .maybeSingle()
    if (!data || data.cancelled || data.editing_state) return   // cancelado o en edición → abortar
    await confirmarPendiente(chatId, pendId, telegramId)
  })()
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(tarea)
  else tarea.catch(console.error)
}

async function handleConfirmarCb(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const pendId     = cb.data.split(':')[1]
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  const ok = await confirmarPendiente(chatId, pendId, telegramId)
  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text: ok ? '✅ Registrado.' : '⚠️ Esta revisión ya no está disponible.',
  })
}

async function handleCorregirCb(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const pendId     = cb.data.split(':')[1]
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  const { data: pend } = await supabase
    .from('movimiento_pendiente').select('*')
    .eq('id', pendId).eq('telegram_id', telegramId).eq('cancelled', false).maybeSingle()
  if (!pend || (pend as MovPendiente).items.length === 0) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '⚠️ Esta revisión ya no está disponible.' })
    return
  }

  // Entrar en edición cancela la auto-confirmación pendiente.
  await supabase.from('movimiento_pendiente')
    .update({ editing_state: 'asking_item_number', auto_confirm_at: null, card_message_id: msgId })
    .eq('id', pendId)

  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text: '¿Qué ítem querés corregir? Enviá el número del ítem (1, 2, 3…) o /cancelar para volver.',
    reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `cancelar:${pendId}` }]] },
  })
}

async function handleCancelarCb(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const pendId     = cb.data.split(':')[1]
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  await supabase.from('movimiento_pendiente')
    .update({ cancelled: true, editing_state: null, editing_item_number: null, auto_confirm_at: null })
    .eq('id', pendId).eq('telegram_id', telegramId)

  await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Cancelado. No se registró nada.' })
}

// ─── Foto: Vision recién al elegir tipo (decisión #4) ─────────────────────────
async function handleFotoTipo(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const [, tipoElegido, pendId] = cb.data.split(':')   // fototipo:<compra|venta>:<id>
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  const { data: pendRow } = await supabase
    .from('movimiento_pendiente').select('*')
    .eq('id', pendId).eq('telegram_id', telegramId).eq('cancelled', false).maybeSingle()
  const pend = pendRow as MovPendiente | null
  if (!pend || pend.channel !== 'foto' || !pend.file_id) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '⚠️ Esta foto ya no está disponible.' })
    return
  }
  if (pend.tipo) return   // idempotencia: doble tap, ya procesada

  await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '🔍 Analizando imagen...' })

  const { data: usuario } = await supabase
    .from('usuarios').select('empresa_id, empresas(nlu_model, rubro)')
    .eq('telegram_id', telegramId).maybeSingle() as { data: UsuarioConEmpresa | null }
  const rubro    = (usuario?.empresas?.rubro ?? '').trim() || 'ferretería'
  const nluModel = (usuario?.empresas as { nlu_model?: string } | null)?.nlu_model ?? 'groq-llama'

  const fileInfo = await tg('getFile', { file_id: pend.file_id })
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ No se pudo obtener la imagen. Reenviá la foto.' })
    return
  }
  const imgResp = await fetch(`${TG_FILE}/${fileInfo.result.file_path}`)
  if (!imgResp.ok) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Error descargando la imagen.' })
    return
  }
  const base64   = bufferToBase64(await imgResp.arrayBuffer())
  const mimeType = fileInfo.result.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg'
  const esCompra = tipoElegido === 'compra'

  const prose = await visionTranscribir(base64, mimeType, rubro, esCompra)
  if (!prose || prose === 'NO_INVENTARIO') {
    await supabase.from('movimiento_pendiente').update({ cancelled: true }).eq('id', pendId)
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❓ No encontré información de inventario en la imagen. Reenviá una foto más clara.' })
    return
  }

  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', pend.empresa_id).limit(200),
    supabase.from('tiendas').select('id, nombre').eq('empresa_id', pend.empresa_id).eq('activa', true),
  ])
  const listaProd   = (productos ?? []).map(p => `${p.id}|${p.nombre}`).join('\n')
  const listaTienda = (tiendas   ?? []).map(t => `${t.id}|${t.nombre}`).join('\n')
  const nlu = await callNLU(nluModel, construirSystemPrompt(rubro, listaProd, listaTienda), prose)
  logConsumo(pend.empresa_id, nluModel, nlu.tokensIn, nlu.tokensOut, 'foto').catch(console.error)

  if (nlu.items.length === 0) {
    await supabase.from('movimiento_pendiente').update({ cancelled: true }).eq('id', pendId)
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❓ No pude leer los productos. Reenviá una foto más clara.' })
    return
  }

  const tipo  = esCompra ? 'compra' : 'venta'
  const total = nlu.items.reduce((s, it) => s + it.cantidad * it.precio, 0)
  await supabase.from('movimiento_pendiente')
    .update({ tipo, items: nlu.items, total, transcripcion: prose })
    .eq('id', pendId)

  // Tarjeta unificada sobre el mismo mensaje. Sin countdown: espera tap (decisión #4).
  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    ...construirTarjeta({ id: pendId, channel: 'foto', tipo, items: nlu.items }, {}),
  })
}

// Vision con el tipo ya conocido (el prompt lo aprovecha, decisión #4 paso 5).
async function visionTranscribir(base64: string, mimeType: string, rubro: string, esCompra: boolean): Promise<string> {
  const hint = esCompra
    ? 'Es una COMPRA (factura/boleta de un proveedor).'
    : 'Es una VENTA (boleta/nota de venta a un cliente).'
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0, max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: 'text', text: `Eres un asistente de inventario de un negocio de ${rubro}. ${hint} La imagen puede ser una factura, boleta, remito, ticket o nota — muchas veces en papel AUTOCOPIADO o TÉRMICO: tenue o de bajo contraste. Leela con MUCHO cuidado, dígito por dígito.

Transcribí TODOS los renglones de productos, UNO POR LÍNEA:
- <cantidad> x <descripción tal cual figura> — <precio>

Reglas:
- Incluí CADA ítem, no resumas.
- <precio>: importe del renglón; si es por unidad "S/. X c/u", si es total del renglón "S/. X total".
- Respetá cantidades y montos EXACTOS; no inventes. Dígito ilegible → "?".
- Respondé SOLO las líneas, sin comentarios.

Si no hay info de inventario, respondé solo: NO_INVENTARIO.` },
      ]}],
    }),
  })
  const data = await resp.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

// ─── Admin: modo al registrarse (decisión #8) ─────────────────────────────────
async function handleAdminModo(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const [, modo, token] = cb.data.split(':')   // adminmodo:<consulta|sede>:<token>
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  const { data: empresa } = await supabase
    .from('empresas').select('id, nombre, telegram_token_admin')
    .eq('telegram_token_admin', token).eq('activa', true).maybeSingle()
  if (!empresa) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Token expirado. Pedí un link nuevo al administrador.' })
    return
  }

  if (modo === 'consulta') {
    await upsertAdmin(telegramId, cb.from, empresa.id, null, 'consulta')
    await tg('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: `✅ *Registrado en modo consulta.*\n\n🏢 Empresa: *${empresa.nombre}*\n📊 Ves reportes consolidados; no registrás movimientos.`,
      parse_mode: 'Markdown',
    })
    return
  }

  const { data: tiendas } = await supabase
    .from('tiendas').select('id, nombre').eq('empresa_id', empresa.id).eq('activa', true).order('id')
  if (!tiendas?.length) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ La empresa no tiene sedes configuradas.' })
    return
  }
  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text: '📍 ¿Qué sede vas a usar por defecto?',
    reply_markup: { inline_keyboard: tiendas.map(t => ([{ text: t.nombre, callback_data: `adminsede:${token}:${t.id}` }])) },
  })
}

async function handleAdminSede(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const partes     = cb.data.split(':')   // adminsede:<token>:<tiendaId>
  const token      = partes[1]
  const tiendaId   = parseInt(partes[2])
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  const { data: empresa } = await supabase
    .from('empresas').select('id, nombre, telegram_token_admin')
    .eq('telegram_token_admin', token).eq('activa', true).maybeSingle()
  if (!empresa) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Token expirado.' })
    return
  }
  const { data: tienda } = await supabase
    .from('tiendas').select('nombre').eq('id', tiendaId).eq('empresa_id', empresa.id).maybeSingle()
  if (!tienda) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Sede inválida. Reenviá /start con tu token.' })
    return
  }
  await upsertAdmin(telegramId, cb.from, empresa.id, tiendaId, 'con_sede')
  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text: `✅ *Registrado como admin con sede.*\n\n🏢 Empresa: *${empresa.nombre}*\n📍 Sede: *${tienda.nombre}*\n📦 Podés registrar movimientos y ver reportes.`,
    parse_mode: 'Markdown',
  })
}

// Alta/actualización de un admin (upsert por telegram_id). Re-vinculación soportada.
async function upsertAdmin(
  telegramId: number,
  from: { first_name?: string; last_name?: string },
  empresaId: string,
  tiendaId: number | null,
  modoAdmin: 'consulta' | 'con_sede',
) {
  const nombre = [from.first_name, from.last_name].filter(Boolean).join(' ')
  const datos  = { nombre, rol: 'admin', tienda_id: tiendaId, empresa_id: empresaId, modo_admin: modoAdmin }
  const { data: existente } = await supabase.from('usuarios').select('id').eq('telegram_id', telegramId).maybeSingle()
  if (existente) await supabase.from('usuarios').update(datos).eq('id', existente.id)
  else           await supabase.from('usuarios').insert({ telegram_id: telegramId, ...datos })
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

// Decisión #9: el vendedor ve reportes SCOPED a su sede (sin "permiso denegado");
// el admin consolida pero respeta filtros explícitos del NLU.
async function handleReporte(chatId: number, usuario: UsuarioConEmpresa, rep: ParsedReporte) {
  const empresaId  = usuario.empresa_id
  const esVendedor = usuario.rol === 'vendedor'
  const sedeForzada = esVendedor ? usuario.tienda_id : null   // null = consolidado (admin)

  // ── Modo A: stock actual de un producto puntual (ignora período) ──
  if (rep.producto) {
    const { data: prods } = await supabase
      .from('productos')
      .select('id, nombre')
      .eq('empresa_id', empresaId)
      .ilike('nombre', `%${rep.producto}%`)
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
    let sq = supabase
      .from('stock')
      .select('cantidad, producto_id, tienda_id, tiendas(nombre), productos!inner(empresa_id)')
      .in('producto_id', ids)
      .eq('productos.empresa_id', empresaId)
    if (sedeForzada) sq = sq.eq('tienda_id', sedeForzada)   // vendedor: solo su sede
    const { data: stockRows } = await sq

    const porProducto = new Map<number, Array<{ tienda: string; cantidad: number }>>()
    for (const s of (stockRows ?? []) as unknown as Array<{ cantidad: number; producto_id: number; tiendas: { nombre: string } | null }>) {
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
      text: `📊 *Stock actual*\n\n${bloques.join('\n\n')}` +
        construirDeepLink(rep.periodo, sedeForzada ? String(sedeForzada) : 'all'),
      parse_mode: 'Markdown',
    })
    return
  }

  // ── Modo B: reporte de ventas del período ──
  const { desdeIso, titulo } = inicioPeriodoPeru(rep.periodo)

  // Vendedor: sede forzada (sin anunciar la restricción, decisión #9).
  // Admin: resuelve la sede mencionada por el NLU si la hay; si no, consolida.
  let tiendaId: number | null = sedeForzada
  let tiendaNombre: string | null = null
  if (!esVendedor && rep.tienda_nombre) {
    const { data: t } = await supabase
      .from('tiendas')
      .select('id, nombre')
      .eq('empresa_id', empresaId)
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

  let q = supabase
    .from('movimientos')
    .select('cantidad, total, tienda_origen, productos!inner(nombre, empresa_id)')
    .eq('tipo', 'venta')
    .eq('productos.empresa_id', empresaId)
    .gte('created_at', desdeIso)
  if (tiendaId) q = q.eq('tienda_origen', tiendaId)
  const { data: ventas } = await q as { data: Array<{ cantidad: number; total: number; productos: { nombre: string } | null }> | null }

  const deepLink = construirDeepLink(rep.periodo, tiendaId ? String(tiendaId) : 'all')

  if (!ventas || ventas.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text:
        `📊 No hay ventas registradas para ese período ` +
        `(_${titulo.toLowerCase()}_${tiendaNombre ? `, sede ${mdSafe(tiendaNombre)}` : ''}).` + deepLink,
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
      `🏆 *Top productos:*\n${top}` + deepLink,
    parse_mode: 'Markdown',
  })
}

// Deep-link al dashboard (decisión #9). DORMIDO hasta tener DASHBOARD_BASE_URL:
// si está vacío, devuelve '' y el link no se incluye. Cuando se configure el
// dominio, falta firmar un JWT de 15 min {usuario_id, empresa_id, rol} con
// JWT_SECRET y anexarlo como &token=… (no incluir credenciales en la URL).
function construirDeepLink(periodo: string, sedeParam: string): string {
  if (!DASHBOARD_BASE_URL) return ''
  return `\n\n🔗 Ver gráfico completo: ${DASHBOARD_BASE_URL}/reportes?periodo=${periodo}&sede=${sedeParam}`
}

// ─── NLU multi-modelo ─────────────────────────────────────────────────────────

async function callNLU(
  nluModel: string,
  systemPrompt: string,
  transcript: string,
): Promise<NluResult> {

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
    return classifyNlu(data.choices?.[0]?.message?.content, tokensIn, tokensOut)
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
    return classifyNlu(data.content?.[0]?.text, tokensIn, tokensOut)
  }

  return { intent: 'registro', tipo: null, tipo_explicito: false, confianza: 0, items: [], reporte: null, tokensIn: 0, tokensOut: 0 }
}

// Parsea la respuesta del NLU al contrato 018. TOLERA respuestas viejas:
// - intent ausente → se infiere por tipo === 'reporte' o presencia de items/movimientos.
// - tipo_explicito ausente → false (no auto-confirma; restricción de compatibilidad).
// - items ausente pero "movimientos" presente → se mapea (nombre/cantidad/precio).
function classifyNlu(content: string | undefined, tokensIn: number, tokensOut: number): NluResult {
  const vacio: NluResult = { intent: 'registro', tipo: null, tipo_explicito: false, confianza: 0, items: [], reporte: null, tokensIn, tokensOut }
  if (!content) return vacio
  let obj: Record<string, unknown>
  try { obj = JSON.parse(content) } catch { return vacio }
  if (!obj || typeof obj !== 'object') return vacio

  const esReporte = obj.intent === 'reporte' || obj.tipo === 'reporte'
  if (esReporte) {
    const periodo = obj.periodo === 'semana' || obj.periodo === 'mes' ? obj.periodo : 'hoy'
    return {
      ...vacio,
      intent: 'reporte',
      reporte: {
        periodo,
        tienda_nombre: typeof obj.tienda_nombre === 'string' && obj.tienda_nombre.trim() ? obj.tienda_nombre.trim() : null,
        producto:      typeof obj.producto      === 'string' && obj.producto.trim()      ? obj.producto.trim()      : null,
      },
    }
  }

  // Registro. items nuevos {nombre,cantidad,precio}; fallback a "movimientos" viejos.
  const rawItems = Array.isArray(obj.items) ? obj.items
    : Array.isArray(obj.movimientos) ? obj.movimientos
    : []
  const items: TarjetaItem[] = rawItems
    .map((r: Record<string, unknown>) => ({
      nombre:   String(r.nombre ?? r.producto_nombre ?? '').trim(),
      cantidad: Math.trunc(Number(r.cantidad ?? 0)),
      precio:   Number(r.precio ?? r.precio_unitario ?? r.costo_unitario ?? 0),
    }))
    .filter((it: TarjetaItem) => it.nombre && it.cantidad > 0)

  // tipo a nivel tarjeta: el del objeto, o el del primer movimiento viejo.
  const tiposValidos = ['compra', 'venta', 'ingreso', 'traslado']
  let tipo = typeof obj.tipo === 'string' && tiposValidos.includes(obj.tipo) ? obj.tipo as NluResult['tipo'] : null
  if (!tipo && Array.isArray(obj.movimientos) && obj.movimientos[0]) {
    const t0 = (obj.movimientos[0] as Record<string, unknown>).tipo
    if (typeof t0 === 'string' && tiposValidos.includes(t0)) tipo = t0 as NluResult['tipo']
  }

  return {
    ...vacio,
    intent: 'registro',
    tipo,
    tipo_explicito: obj.tipo_explicito === true,
    confianza: typeof obj.confianza === 'number' ? obj.confianza : (obj.tipo_explicito === true ? 1 : 0),
    items,
  }
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
  modo_admin: 'consulta' | 'con_sede' | null
  empresas:   { nlu_model: string; rubro?: string | null } | null
}

interface ParsedReporte {
  periodo:       'hoy' | 'semana' | 'mes'
  tienda_nombre: string | null
  producto:      string | null
}

// 018 — fila de movimiento_pendiente (la tarjeta de revisión vive acá hasta confirmar).
interface MovPendiente {
  id:                  string
  empresa_id:          string
  telegram_id:         number
  channel:             'voz' | 'texto' | 'foto'
  tipo:                'compra' | 'venta' | 'ingreso' | 'traslado' | null
  items:               TarjetaItem[]
  total:               number | null
  card_message_id:     number | null
  editing_state:       'asking_item_number' | 'asking_values' | null
  editing_item_number: number | null
  auto_confirm_at:     string | null
  file_id:             string | null
  transcripcion:       string | null
  cancelled:           boolean
  created_at:          string
}

// 018 — contrato del NLU (decisión A): intent + tipo + tipo_explicito + confianza.
interface NluResult {
  intent:         'registro' | 'reporte'
  tipo:           'compra' | 'venta' | 'ingreso' | 'traslado' | null
  tipo_explicito: boolean
  confianza:      number
  items:          TarjetaItem[]
  reporte:        ParsedReporte | null
  tokensIn:       number
  tokensOut:      number
}
