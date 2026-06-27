// supabase/functions/telegram-bot/index.ts
// Bot de Telegram para Agent GMS.
//
// Soporta: voz (Groq Whisper STT) · texto · foto (Groq Vision)
// NLU multi-modelo dinámico (tabla modelos_nlu): proveedores groq · anthropic · openrouter.
// Consumo diferenciado por empresa en tabla consumo_ia.
// Suspensión de empresas (empresas.activa): el bot no procesa empresas dadas de baja.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { construirTarjeta, type TarjetaItem, type TarjetaOpciones } from './tarjeta.ts'

// ─── Constantes ───────────────────────────────────────────────────────────────

const BOT_TOKEN     = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const GROQ_KEY      = Deno.env.get('GROQ_API_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const TG_API        = `https://api.telegram.org/bot${BOT_TOKEN}`
const TG_FILE       = `https://api.telegram.org/file/bot${BOT_TOKEN}`

// Deep-link a reportes del dashboard (018, paso H). El link se incluye solo si
// AMBOS están seteados (URL + secret para firmar el token); si falta alguno,
// no se emite (no se manda un link sin auth).
const DASHBOARD_BASE_URL = Deno.env.get('DASHBOARD_BASE_URL') ?? ''
const JWT_SECRET         = Deno.env.get('JWT_SECRET') ?? ''

// Ventana de auto-reversión del vendedor (018, decisión #10).
const UNDO_VENTANA_MS = 5 * 60 * 1000

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!,
)

// Catálogo de modelos NLU: vive en la tabla `modelos_nlu` (sprint 021) y se
// resuelve en runtime con resolverModelo(). El bot ya no hardcodea los modelos;
// el superadmin los administra desde /superadmin/modelos.
type Proveedor = 'groq' | 'anthropic' | 'openrouter'
type ModeloResuelto = {
  id: string
  proveedor: Proveedor
  apiModelId: string
  costoIn: number
  costoOut: number
}

// Fallback de resiliencia: si la tabla falla o el id no está, el bot nunca se rompe.
const FALLBACK_MODELO: ModeloResuelto = {
  id: 'groq-llama',
  proveedor: 'groq',
  apiModelId: 'llama-3.3-70b-versatile',
  costoIn: 0.00000059,
  costoOut: 0.00000079,
}

async function resolverModelo(nluModelId: string | undefined | null): Promise<ModeloResuelto> {
  if (!nluModelId) return FALLBACK_MODELO
  try {
    const { data } = await supabase
      .from('modelos_nlu')
      .select('id, proveedor, api_model_id, costo_in, costo_out')
      .eq('id', nluModelId)
      .maybeSingle()
    if (!data) return FALLBACK_MODELO
    return {
      id: data.id,
      proveedor: data.proveedor as Proveedor,
      apiModelId: data.api_model_id,
      costoIn: Number(data.costo_in) || 0,
      costoOut: Number(data.costo_out) || 0,
    }
  } catch {
    return FALLBACK_MODELO
  }
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
      if (cb.data.startsWith('confirmar:'))  { await handleConfirmarCb(cb);  return }
      if (cb.data.startsWith('corregir:'))   { await handleCorregirCb(cb);   return }
      if (cb.data.startsWith('editfield:'))  { await handleEditFieldCb(cb);  return }
      if (cb.data.startsWith('editcancel:')) { await handleEditCancelCb(cb); return }
      if (cb.data.startsWith('cancelar:'))   { await handleCancelarCb(cb);   return }
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

    // /deshacer (texto): revierte la última registración (reemplaza al botón).
    if (msg.text && esComandoDeshacer(msg.text)) {
      await handleDeshacerCmd(msg.chat.id, msg.from?.id)
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
    .select('rol, modo_admin, empresa_id, empresas(activa)')
    .eq('telegram_id', telegramUserId)
    .maybeSingle()

  if (!usuario?.empresa_id) {
    await tg('sendMessage', { chat_id: chatId, text: '⛔ Tu cuenta de Telegram no está registrada en el sistema.' })
    return
  }
  // Suspensión (sprint 021): empresa dada de baja → no procesa.
  if ((usuario.empresas as { activa?: boolean } | null)?.activa === false) {
    await tg('sendMessage', { chat_id: chatId, text: '⛔ Tu empresa está suspendida. Contactá al proveedor.' })
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
    .select('id, empresa_id, tienda_id, rol, modo_admin, empresas(nlu_model, rubro, activa)')
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

  // Suspensión (sprint 021): empresa dada de baja → no procesa.
  if ((usuario.empresas as { activa?: boolean } | null)?.activa === false) {
    await tg('sendMessage', { chat_id: chatId, text: '⛔ Tu empresa está suspendida. Contactá al proveedor.' })
    return
  }

  const empresaId = usuario.empresa_id
  const modelo    = await resolverModelo((usuario.empresas as { nlu_model?: string } | null)?.nlu_model)
  const rubro     = (usuario.empresas?.rubro ?? '').trim() || 'ferretería'

  const [{ data: productos }, { data: tiendas }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', empresaId).limit(200),
    supabase.from('tiendas').select('id, nombre').eq('empresa_id', empresaId).eq('activa', true),
  ])
  const listaProd   = (productos ?? []).map(p => `${p.id}|${p.nombre}`).join('\n')
  const listaTienda = (tiendas   ?? []).map(t => `${t.id}|${t.nombre}`).join('\n')

  const nlu = await callNLU(modelo, construirSystemPrompt(rubro, listaProd, listaTienda), transcript)

  // ── Reporte (decisión #9: vendedor también, scoped a su sede) ──
  if (nlu.intent === 'reporte' && nlu.reporte) {
    logConsumo(empresaId, modelo, nlu.tokensIn, nlu.tokensOut, 'reporte').catch(console.error)
    await handleReporte(chatId, usuario, nlu.reporte)
    return
  }

  logConsumo(empresaId, modelo, nlu.tokensIn, nlu.tokensOut, 'nlu').catch(console.error)

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

  // La tarjeta SIEMPRE espera tap explícito en [✅ Confirmar] (voz, texto y foto).
  // No hay auto-confirmación.
  const total = nlu.items.reduce((s, it) => s + it.cantidad * it.precio, 0)
  const { data: pend } = await supabase
    .from('movimiento_pendiente')
    .insert({
      empresa_id:    empresaId,
      telegram_id:   telegramUserId,
      channel,
      tipo:          nlu.tipo,
      items:         nlu.items,
      total,
      transcripcion: transcript,
    })
    .select('*')
    .single() as { data: MovPendiente | null }

  if (!pend) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No pude preparar la revisión. Reintentá.' })
    return
  }

  await enviarTarjeta(chatId, pend, {})
}

// ─── Insert de movimientos ────────────────────────────────────────────────────
// Inserción final, llamada por confirmarPendiente al confirmar la tarjeta.
// Auto-crea productos que no estén en el catálogo, inserta los movimientos y
// DEVUELVE los ids insertados (señal de éxito; el caller arma/edita el mensaje).
// NO manda mensaje. Devuelve null si no se registró nada.
async function insertarMovimientos(
  empresaId: string,
  usuario: { id: string; tienda_id: number | null },
  items: ParsedMovimiento[],
  tiendas: Array<{ id: number; nombre: string }> | null,
  productos: Array<{ id: number; nombre: string }> | null,
  transcript: string,
): Promise<string[] | null> {
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

  if (movimientos.length === 0) return null
  return movimientos.map(m => m.id)
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

// /cancelar (decisión #7) edit-aware: si el operario está en medio de una EDICIÓN,
// /cancelar vuelve a la tarjeta SIN descartar el registro. En estado neutro (o con
// la tarjeta sin editar), descarta todos los pendientes activos.
async function handleCancelarUniversal(chatId: number, telegramId: number | undefined) {
  if (!telegramId) return

  const pend = await pendienteActivo(telegramId)
  if (pend?.editing_state) {
    await supabase.from('movimiento_pendiente')
      .update({ editing_state: null, editing_item_number: null, editing_field: null })
      .eq('id', pend.id)
    await refrescarTarjeta(chatId, { ...pend, editing_state: null })
    return
  }

  await supabase
    .from('movimiento_pendiente')
    .update({ cancelled: true, editing_state: null, editing_item_number: null, editing_field: null, auto_confirm_at: null })
    .eq('telegram_id', telegramId)
    .eq('cancelled', false)
  await tg('sendMessage', { chat_id: chatId, text: '✅ Cancelado. Estás en estado neutro.' })
}

// /deshacer (texto): reemplaza al botón de Deshacer. Revierte la ÚLTIMA
// registración del operario dentro de la ventana de 5 min (decisión #10).
function esComandoDeshacer(text: string): boolean {
  const n = normalizar(text).replace(/[.!¡¿?]+$/g, '').trim()
  return n === '/deshacer' || n === 'deshacer'
}

async function handleDeshacerCmd(chatId: number, telegramId: number | undefined) {
  if (!telegramId) return

  const { data: usuario } = await supabase
    .from('usuarios').select('id, empresa_id').eq('telegram_id', telegramId).maybeSingle()
  if (!usuario) {
    await tg('sendMessage', { chat_id: chatId, text: '⛔ Tu cuenta de Telegram no está registrada en el sistema.' })
    return
  }

  // Movimientos del operario (scoped a su empresa vía productos), más nuevos primero.
  const { data: movs } = await supabase
    .from('movimientos')
    .select('id, created_at, productos!inner(empresa_id)')
    .eq('usuario_id', usuario.id)
    .eq('productos.empresa_id', usuario.empresa_id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!movs || movs.length === 0) {
    await tg('sendMessage', { chat_id: chatId, text: 'No tenés registros para deshacer.' })
    return
  }

  // Decisión #10: ventana de 5 min. Si el último ya la excedió, lo revierte el admin.
  const latest = new Date(movs[0].created_at as string).getTime()
  if (Date.now() - latest > UNDO_VENTANA_MS) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '⏱ Ventana de reversión vencida (5 min). Pedile al admin que lo revierta desde el dashboard.',
    })
    return
  }

  // Lote = el cluster más reciente (creado dentro de 3s del más nuevo): exactamente
  // los movimientos de la última confirmación (se insertan juntos en <1s).
  const idsLote = movs
    .filter(m => latest - new Date(m.created_at as string).getTime() <= 3000)
    .map(m => m.id)

  const { error } = await supabase.from('movimientos').delete().in('id', idsLote)
  if (error) {
    await tg('sendMessage', { chat_id: chatId, text: '❌ No se pudo revertir el registro.' })
    return
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: `↩️ ${idsLote.length === 1 ? 'Registro revertido' : `${idsLote.length} registros revertidos`}. El stock fue restaurado.`,
  })
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

// ─── Modo edición por CAMPO (decisión #6, refinado) ───────────────────────────
// Flujo: [Corregir] → elegir ítem (número, salvo que haya uno solo) → elegir
// CAMPO (botón) → enviar SOLO el dato → recalcula y vuelve a la tarjeta. Todo
// editando el mismo mensaje (mínimo de mensajes en el chat).

const CAMPO_LABEL: Record<string, string> = { nombre: 'Nombre', cantidad: 'Cantidad', precio: 'Precio' }

function valorActualCampo(it: TarjetaItem, field: string): string {
  if (field === 'nombre')   return it.nombre
  if (field === 'cantidad') return String(it.cantidad)
  return `S/${it.precio.toFixed(2)}`
}

// Valida y aplica el nuevo valor de UN campo. Devuelve el ítem actualizado o null.
function aplicarCampo(it: TarjetaItem, field: string, texto: string): TarjetaItem | null {
  const t = texto.trim()
  if (field === 'nombre') {
    return t ? { ...it, nombre: t } : null
  }
  if (field === 'cantidad') {
    const cantidad = parseInt(t.replace(/[^\d]/g, ''), 10)
    return Number.isInteger(cantidad) && cantidad > 0 ? { ...it, cantidad } : null
  }
  if (field === 'precio') {
    const precio = parseFloat(t.replace(/[^\d.,]/g, '').replace(',', '.'))
    return Number.isFinite(precio) && precio >= 0 ? { ...it, precio } : null
  }
  return null
}

// Mensaje "¿Qué corregís?" con los 3 botones de campo + Cancelar.
function construirSelectorCampo(pendId: string, n: number, it: TarjetaItem) {
  return {
    text: `Ítem ${n}: ${it.nombre} — ${it.cantidad} × S/${it.precio.toFixed(2)}\n\n¿Qué corregís?`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 Nombre',   callback_data: `editfield:nombre:${pendId}` },
          { text: '🔢 Cantidad', callback_data: `editfield:cantidad:${pendId}` },
          { text: '💲 Precio',   callback_data: `editfield:precio:${pendId}` },
        ],
        [{ text: '❌ Cancelar', callback_data: `editcancel:${pendId}` }],
      ],
    },
  }
}

// Mensaje "Campo actual: X — Enviá el nuevo valor:".
function construirPromptValor(pendId: string, it: TarjetaItem, field: string) {
  return {
    text: `${CAMPO_LABEL[field]} actual: ${valorActualCampo(it, field)}\n\nEnviá el nuevo valor:`,
    reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `editcancel:${pendId}` }]] },
  }
}

async function handleEdicionInput(chatId: number, pend: MovPendiente, texto: string) {
  const items = pend.items ?? []

  // Paso: eligió el ítem por número → mostrar el selector de campo.
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
      .update({ editing_item_number: n, editing_state: 'asking_field', editing_field: null })
      .eq('id', pend.id)
    if (pend.card_message_id) {
      await tg('editMessageText', { chat_id: chatId, message_id: pend.card_message_id, ...construirSelectorCampo(pend.id, n, items[n - 1]) })
    }
    return
  }

  // En 'asking_field' se espera un TAP de botón, no texto.
  if (pend.editing_state === 'asking_field') {
    await tg('sendMessage', { chat_id: chatId, text: 'Tocá un campo (Nombre, Cantidad o Precio) o /cancelar.' })
    return
  }

  // Paso final: recibió el nuevo valor del campo elegido.
  if (pend.editing_state === 'asking_value') {
    const idx   = (pend.editing_item_number ?? 0) - 1
    const field = pend.editing_field
    if (idx < 0 || idx >= items.length || !field) {
      await supabase.from('movimiento_pendiente')
        .update({ editing_state: null, editing_item_number: null, editing_field: null }).eq('id', pend.id)
      return
    }
    const actualizado = aplicarCampo(items[idx], field, texto)
    if (!actualizado) {
      await tg('sendMessage', { chat_id: chatId, text: `Valor inválido para ${CAMPO_LABEL[field]}. Enviá solo el dato o /cancelar.` })
      return
    }
    items[idx] = actualizado
    const total = items.reduce((s, it) => s + it.cantidad * it.precio, 0)
    await supabase.from('movimiento_pendiente')
      .update({ items, total, editing_state: null, editing_item_number: null, editing_field: null })
      .eq('id', pend.id)
    // Vuelve a la tarjeta completa con el campo actualizado.
    await refrescarTarjeta(chatId, { ...pend, items, total, editing_state: null })
    return
  }
}

// ─── Confirmación (manual + auto) ─────────────────────────────────────────────
// 'compra' del UX mapea a 'ingreso' del ledger; el resto pasa directo.
function mapTipoLedger(tipo: MovPendiente['tipo']): 'venta' | 'ingreso' | 'traslado' {
  if (tipo === 'compra' || tipo === 'ingreso') return 'ingreso'
  if (tipo === 'traslado') return 'traslado'
  return 'venta'
}

// Reclama el pendiente de forma atómica (cancelled=true devuelve fila SOLO si
// seguía activo → evita doble registro ante doble tap), registra, y EDITA la
// tarjeta (msgId) con el resultado — sin mandar mensaje nuevo (Fix 2).
async function confirmarPendiente(chatId: number, msgId: number, pendId: string, telegramId: number | undefined) {
  const { data: claim } = await supabase
    .from('movimiento_pendiente')
    .update({ cancelled: true })
    .eq('id', pendId)
    .eq('telegram_id', telegramId ?? -1)
    .eq('cancelled', false)
    .select('*')
  const pend = claim?.[0] as MovPendiente | undefined
  if (!pend || !pend.tipo || (pend.items ?? []).length === 0) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '⚠️ Esta revisión ya no está disponible.' })
    return
  }

  const { data: usuario } = await supabase
    .from('usuarios').select('id, tienda_id').eq('telegram_id', telegramId).maybeSingle()
  if (!usuario) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '⛔ Tu cuenta ya no está registrada en el sistema.' })
    return
  }

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

  const ids = await insertarMovimientos(
    pend.empresa_id,
    usuario as { id: string; tienda_id: number | null },
    items, tiendas, productos,
    pend.transcripcion ?? '',
  )

  if (!ids) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❓ No pude registrar los productos. Reintentá.' })
    return
  }

  // Editamos la MISMA tarjeta mostrando SOLO "✅ Registrado", sin teclado ni
  // mensaje nuevo. Para deshacer, el operario escribe /deshacer en el chat.
  await tg('editMessageText', {
    chat_id: chatId, message_id: pend.card_message_id ?? msgId,
    text: '✅ *Registrado*',
    parse_mode: 'Markdown',
  })
}

async function handleConfirmarCb(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const pendId     = cb.data.split(':')[1]
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  await confirmarPendiente(chatId, msgId, pendId, telegramId)
}

async function handleCorregirCb(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const pendId     = cb.data.split(':')[1]
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  const { data: pendRow } = await supabase
    .from('movimiento_pendiente').select('*')
    .eq('id', pendId).eq('telegram_id', telegramId).eq('cancelled', false).maybeSingle()
  const pend = pendRow as MovPendiente | null
  const items = pend?.items ?? []
  if (!pend || items.length === 0) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '⚠️ Esta revisión ya no está disponible.' })
    return
  }

  // Con un solo ítem, saltamos la pregunta del número → directo al selector de campo
  // (mínimo de mensajes). Con varios, pedimos el número primero.
  if (items.length === 1) {
    await supabase.from('movimiento_pendiente')
      .update({ editing_state: 'asking_field', editing_item_number: 1, editing_field: null, auto_confirm_at: null, card_message_id: msgId })
      .eq('id', pendId)
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, ...construirSelectorCampo(pendId, 1, items[0]) })
    return
  }

  // Entrar en edición cancela la auto-confirmación pendiente.
  await supabase.from('movimiento_pendiente')
    .update({ editing_state: 'asking_item_number', editing_item_number: null, editing_field: null, auto_confirm_at: null, card_message_id: msgId })
    .eq('id', pendId)

  await tg('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text: '¿Qué ítem querés corregir? Enviá el número del ítem (1, 2, 3…) o /cancelar para volver.',
    reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: `editcancel:${pendId}` }]] },
  })
}

// El operario tocó un botón de campo (editfield:<nombre|cantidad|precio>:<id>).
// Fija el campo y pide el valor único.
async function handleEditFieldCb(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const [, field, pendId] = cb.data.split(':')
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  const { data: pendRow } = await supabase
    .from('movimiento_pendiente').select('*')
    .eq('id', pendId).eq('telegram_id', telegramId).eq('cancelled', false).maybeSingle()
  const pend = pendRow as MovPendiente | null
  const idx  = (pend?.editing_item_number ?? 0) - 1
  if (!pend || !pend.editing_state || idx < 0 || idx >= (pend.items?.length ?? 0)) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '⚠️ Esta edición ya no está disponible.' })
    return
  }

  await supabase.from('movimiento_pendiente')
    .update({ editing_state: 'asking_value', editing_field: field, card_message_id: msgId })
    .eq('id', pendId)

  await tg('editMessageText', { chat_id: chatId, message_id: msgId, ...construirPromptValor(pendId, pend.items[idx], field) })
}

// [❌ Cancelar] durante la edición o /cancelar en edición: vuelve a la tarjeta
// SIN descartar el registro (a diferencia del Cancelar de la tarjeta misma).
async function handleEditCancelCb(cb: CallbackQuery) {
  const chatId     = cb.message.chat.id
  const msgId      = cb.message.message_id
  const telegramId = cb.from.id
  const pendId     = cb.data.split(':')[1]
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  const { data: pendRow } = await supabase
    .from('movimiento_pendiente').select('*')
    .eq('id', pendId).eq('telegram_id', telegramId).eq('cancelled', false).maybeSingle()
  const pend = pendRow as MovPendiente | null
  if (!pend) {
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '⚠️ Esta revisión ya no está disponible.' })
    return
  }

  await supabase.from('movimiento_pendiente')
    .update({ editing_state: null, editing_item_number: null, editing_field: null })
    .eq('id', pendId)

  await tg('editMessageText', { chat_id: chatId, message_id: msgId, ...construirTarjeta(pendToTarjeta(pend), {}) })
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
  const rubro  = (usuario?.empresas?.rubro ?? '').trim() || 'ferretería'
  const modelo = await resolverModelo((usuario?.empresas as { nlu_model?: string } | null)?.nlu_model)

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
  const nlu = await callNLU(modelo, construirSystemPrompt(rubro, listaProd, listaTienda), prose)
  logConsumo(pend.empresa_id, modelo, nlu.tokensIn, nlu.tokensOut, 'foto').catch(console.error)

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

    const deepLinkStock = await construirDeepLink(usuario, rep.periodo, sedeForzada ? String(sedeForzada) : 'all')
    await tg('sendMessage', {
      chat_id: chatId,
      text: `📊 *Stock actual*\n\n${bloques.join('\n\n')}` + deepLinkStock,
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

  const deepLink = await construirDeepLink(usuario, rep.periodo, tiendaId ? String(tiendaId) : 'all')

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

// Deep-link al dashboard (decisión #9). Se emite SOLO si están DASHBOARD_BASE_URL
// y JWT_SECRET; si falta alguno devuelve '' (no se manda un link sin token de
// auth). El token es un JWT HS256 de 15 min con {usuario_id, empresa_id, rol}.
async function construirDeepLink(usuario: UsuarioConEmpresa, periodo: string, sedeParam: string): Promise<string> {
  if (!DASHBOARD_BASE_URL || !JWT_SECRET) return ''
  const token = await firmarJwtDashboard(usuario.id, usuario.empresa_id, usuario.rol ?? '')
  return `\n\n🔗 Ver gráfico completo: ${DASHBOARD_BASE_URL}/reportes?periodo=${periodo}&sede=${sedeParam}&token=${token}`
}

// ─── NLU multi-modelo ─────────────────────────────────────────────────────────

async function callNLU(
  modelo: ModeloResuelto,
  systemPrompt: string,
  transcript: string,
): Promise<NluResult> {

  // ── Groq / OpenRouter (API compatible con OpenAI) ──
  if (modelo.proveedor === 'groq' || modelo.proveedor === 'openrouter') {
    const esOR = modelo.proveedor === 'openrouter'
    const url = esOR
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions'
    const headers: Record<string, string> = {
      Authorization: `Bearer ${esOR ? OPENROUTER_KEY : GROQ_KEY}`,
      'Content-Type': 'application/json',
    }
    if (esOR) {
      // Recomendados por OpenRouter para atribución (opcionales).
      headers['HTTP-Referer'] = DASHBOARD_BASE_URL || 'https://agent-gms'
      headers['X-Title'] = 'Agent GMS'
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelo.apiModelId,
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
  if (modelo.proveedor === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelo.apiModelId,
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
  modelo: ModeloResuelto,
  tokensIn: number,
  tokensOut: number,
  tipo: string,
) {
  if (!empresaId) return
  await supabase.from('consumo_ia').insert({
    empresa_id:     empresaId,
    modelo:         modelo.id,
    tipo,
    tokens_entrada: tokensIn,
    tokens_salida:  tokensOut,
    costo_usd:      tokensIn * modelo.costoIn + tokensOut * modelo.costoOut,
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

// ─── JWT del deep-link (HS256 con Web Crypto, sin librerías nuevas) ───────────
function base64urlBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function base64urlStr(s: string): string {
  return base64urlBytes(new TextEncoder().encode(s))
}

// Firma un JWT HS256 con claims {usuario_id, empresa_id, rol} y exp 15 min,
// usando JWT_SECRET. El dashboard valida la firma con el mismo secret.
async function firmarJwtDashboard(usuarioId: string | number, empresaId: string, rol: string): Promise<string> {
  const now     = Math.floor(Date.now() / 1000)
  const header  = base64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64urlStr(JSON.stringify({ usuario_id: usuarioId, empresa_id: empresaId, rol, iat: now, exp: now + 15 * 60 }))
  const data = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${base64urlBytes(new Uint8Array(sig))}`
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
  empresas:   { nlu_model: string; rubro?: string | null; activa?: boolean | null } | null
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
  editing_state:       'asking_item_number' | 'asking_field' | 'asking_value' | null
  editing_item_number: number | null
  editing_field:       'nombre' | 'cantidad' | 'precio' | null
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
