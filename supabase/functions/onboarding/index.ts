// supabase/functions/onboarding/index.ts
// Registra una empresa nueva: crea la empresa, las sedes, el usuario admin en Supabase
// Auth, y envía el email de invitación vía el servicio de email integrado de Supabase.
//
// Variables de entorno requeridas (Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL              (disponible automáticamente)
//   SERVICE_ROLE_KEY          (disponible automáticamente)
//
// Deploy: supabase functions deploy onboarding --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Cliente global con service_role — bypasea RLS en todos los inserts ───────

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!,
)

// ─── CORS (la página de registro llama esta función desde el browser) ─────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: OnboardingRequest
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const { empresa_nombre, admin_email, sedes } = body

  // Validación básica
  if (!empresa_nombre?.trim()) return json({ error: 'Nombre de empresa requerido' }, 400)
  if (!admin_email?.trim())    return json({ error: 'Email del administrador requerido' }, 400)
  const sedesValidas = Array.isArray(sedes)
    ? sedes.map(s => (s ?? '').trim()).filter(Boolean)
    : []

  if (sedesValidas.length < 1) {
    return json({ error: 'Agregá al menos una sede con nombre' }, 400)
  }

  if (sedesValidas.length > 20) {
    return json({ error: 'Máximo 20 sedes por registro' }, 400)
  }

  // ── PASO 1: Crear empresa con telegram_token único ─────────────────────────

  const telegram_token = crypto.randomUUID()

  const { data: empresa, error: empErr } = await supabase
    .from('empresas')
    .insert({
      nombre:          empresa_nombre.trim(),
      telegram_token,  // columna agregada en migración 003
    })
    .select('id, nombre, telegram_token')
    .single()

  if (empErr || !empresa) {
    console.error('[onboarding] crear empresa:', empErr)
    return json({ error: 'No se pudo crear la empresa. ' + empErr?.message }, 500)
  }

  // ── PASO 2: Crear las sedes vinculadas a la empresa ───────────────────────

  const tiendasPayload = sedesValidas.map(nombre => ({
    nombre,
    empresa_id: empresa.id,
  }))

  const { error: tiendasErr } = await supabase
    .from('tiendas')
    .insert(tiendasPayload)

  if (tiendasErr) {
    console.error('[onboarding] crear tiendas:', tiendasErr)
    return json({ error: 'No se pudieron crear las sedes. ' + tiendasErr.message }, 500)
  }

  // ── PASO 3: Crear usuario admin en Supabase Auth ──────────────────────────
  // email_confirm: true  → auto-confirma el email, no envía el correo de Supabase.
  // user_metadata        → queda en raw_user_meta_data y se incluye en el JWT
  //                        como claim "user_metadata". El dashboard puede leerlo
  //                        vía supabase.auth.getSession().data.session.user.user_metadata

  const tempPassword = `GMS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  const { error: authErr } = await supabase.auth.admin.createUser({
    email:         admin_email.trim(),
    password:      tempPassword,
    email_confirm: true,
    user_metadata: {
      empresa_id: empresa.id,
      rol:        'admin',
    },
  })

  if (authErr) {
    console.error('[onboarding] crear usuario auth:', authErr)
    return json({ error: 'No se pudo crear el usuario. ' + authErr.message }, 500)
  }

  // ── PASO 4: Enviar email de bienvenida via Resend ─────────────────────────

  try {
    const emailSent = await sendOnboardingEmail({
      to:              admin_email.trim(),
      empresa_nombre:  empresa.nombre,
      telegram_token:  empresa.telegram_token,
      temp_password:   tempPassword,
      sedes:           sedesValidas,
    })
    if (!emailSent) {
      console.error('[onboarding] email no enviado — verificar RESEND_API_KEY y dominio')
    }
  } catch (emailErr) {
    // El email falló pero empresa y usuario ya fueron creados — no fallamos el request.
    console.error('[onboarding] excepción al enviar email:', emailErr)
  }

  return json({ ok: true, empresa_id: empresa.id, temp_password: tempPassword })
})

// ─── Email de bienvenida via Resend ───────────────────────────────────────────

async function sendOnboardingEmail(opts: {
  to:             string
  empresa_nombre: string
  telegram_token: string
  temp_password:  string
  sedes:          string[]
}): Promise<boolean> {
  const resendKey  = Deno.env.get('RESEND_API_KEY')
  const fromEmail  = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Agent GMS <onboarding@agentgms.com>'

  if (!resendKey) {
    console.warn('[onboarding] RESEND_API_KEY no configurada — email omitido')
    return false
  }

  const sedes_lista = opts.sedes.map((s, i) => `  ${i + 1}. ${s}`).join('\n')

  const texto = `Hola,

Tu empresa "${opts.empresa_nombre}" ya está registrada en Agent GMS.

SEDES CREADAS:
${sedes_lista}

ACCESO AL DASHBOARD:
  Email:      ${opts.to}
  Contraseña: ${opts.temp_password}
  (Cambiala la primera vez que ingreses)

CONECTAR EMPLEADOS AL BOT DE TELEGRAM:
  Tu empresa está lista. Para conectar cada empleado al bot de Telegram,
  cada uno debe enviar al bot el mensaje:

      /start ${opts.telegram_token}

  Luego el bot les pedirá que elijan su tienda.

  Guardá este token en un lugar seguro — es único para tu empresa.

---
Agent GMS · Sistema de inventario por voz
`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    fromEmail,
      to:      opts.to,
      subject: `Tu empresa "${opts.empresa_nombre}" está lista en Agent GMS`,
      text:    texto,
    }),
  })

  if (!res.ok) {
    console.error('[onboarding] Resend error:', await res.text())
    return false
  }

  return true
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface OnboardingRequest {
  empresa_nombre: string
  admin_email:    string
  sedes:          string[]
}
