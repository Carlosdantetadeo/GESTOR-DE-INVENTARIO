# Guía de Obtención de Credenciales — Agent GMS

> Última actualización: 2026-06-12
>
> Las versiones anteriores de esta guía explicaban cómo conectar **n8n** por
> Postgres directo. n8n ya no existe en el proyecto: todas las credenciales se
> configuran como **secretos de Supabase Edge Functions** (ver
> `GUIA-DESPLIEGUE.md`, paso 2) o **variables de entorno de Vercel**.

---

## 1. Supabase

Panel: https://supabase.com/dashboard → tu proyecto.

| Credencial | Dónde está | Se usa en |
|------------|-----------|-----------|
| `SUPABASE_URL` (`https://<ref>.supabase.co`) | Settings → API → Project URL | Auto-inyectada en Edge Functions; `NEXT_PUBLIC_SUPABASE_URL` en Vercel |
| Anon key (`anon public`) | Settings → API → Project API keys | `NEXT_PUBLIC_SUPABASE_ANON_KEY` en Vercel / `.env.local` |
| Service role key (`service_role`) | Settings → API → Project API keys | Secret `SERVICE_ROLE_KEY` de Edge Functions (⚠️ setearlo a mano, no se auto-inyecta con ese nombre) |

> ⚠️ La **service role key bypasea toda RLS**. Nunca ponerla en el frontend, en
> `.env.local` del frontend, ni commitearla. Solo vive como secret de Edge
> Functions.

## 2. Groq (STT + NLU + Vision)

1. Entrar a https://console.groq.com y crear cuenta o iniciar sesión.
2. Menú **API Keys** → **Create API Key**.
3. Nombre identificable (ej. `agent-gms-prod`) → copiar la key (`gsk_...`) inmediatamente — no se vuelve a mostrar.
4. Setearla como secret: `supabase secrets set GROQ_API_KEY=gsk_...`

> ⚠️ Una key de Groq estuvo commiteada en este repo (removida en `ebfe6a3`,
> pero persiste en el historial de git). Si el repo se subió a algún remote,
> **rotarla** en console.groq.com.

## 3. Telegram

### Bot token

1. En Telegram, abrir **@BotFather**.
2. `/newbot` (o `/mybots` → tu bot → API Token si ya existe).
3. Copiar el token (`123456:ABC-...`).
4. `supabase secrets set TELEGRAM_BOT_TOKEN=...`

### Webhook secret

No lo provee Telegram — lo generás vos:

```bash
openssl rand -hex 32
```

Setearlo **dos veces con el mismo valor**: como secret `TELEGRAM_WEBHOOK_SECRET` en Supabase y como `secret_token` al registrar el webhook (`setWebhook`). Si difieren o falta, el bot rechaza todos los mensajes (fail-closed).

## 4. Resend (emails de bienvenida)

1. Entrar a https://resend.com → **API Keys** → crear key (`re_...`).
2. Verificar tu dominio en **Domains** (requerido para producción).
3. Setear:
   ```bash
   supabase secrets set RESEND_API_KEY=re_...
   supabase secrets set RESEND_FROM_EMAIL="Agent GMS <no-reply@tudominio.com>"
   ```
   El remitente debe pertenecer al dominio verificado.

## 5. Anthropic (opcional — NLU Claude)

Solo necesaria si alguna empresa configura `nlu_model` = `anthropic-haiku` o `anthropic-sonnet` en `/admin/config`:

1. https://console.anthropic.com → **API Keys** → crear key (`sk-ant-...`).
2. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`

## 6. Vercel (frontend)

En **Vercel Dashboard → Project → Settings → Environment Variables**:

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key de Supabase |

Para desarrollo local, las mismas dos variables en `frontend/.env.local` (no se commitea).

---

## Resumen: dónde va cada credencial

```
Supabase Edge Functions (supabase secrets set):
  GROQ_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
  SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, [ANTHROPIC_API_KEY]

Vercel / frontend/.env.local:
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
```
