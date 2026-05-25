# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Agent GMS** is a zero-friction inventory management system for a hardware store ("ferretería") chain. Operators register sales and inventory movements by sending Telegram voice messages in ~2 seconds. The system uses AI to transcribe and interpret speech, auto-commits to the database, and offers a one-tap "Undo" button via Telegram.

**n8n and Railway have been replaced.** The automation layer now runs entirely as Supabase Edge Functions (Deno). There is no external orchestration dependency.

## Development Commands

All commands run from the `frontend/` directory:

```bash
npm run dev      # Start Next.js dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # Run ESLint
```

Deploy Edge Functions (run from repo root, requires Supabase CLI):

```bash
supabase functions deploy telegram-bot   --no-verify-jwt
supabase functions deploy onboarding     --no-verify-jwt
```

## Architecture

### Data Flow (Core Loop)

```
Operator → Telegram voice message
  → Supabase Edge Function: telegram-bot
      → Groq Whisper whisper-large-v3-turbo  (STT, <500ms)
      → Groq llama-3.3-70b-versatile         (transcript → structured JSON)
      → Supabase INSERT into `movimientos`   (service_role_key, bypasses RLS)
        → Postgres trigger tr_actualizar_stock auto-updates `stock`
      → Telegram sendMessage: confirmation + "↩️ Deshacer" inline button
  → Operator taps Undo
      → Telegram callback_query (prefix: undo_<movimiento_id>)
      → Edge Function: DELETE FROM movimientos WHERE id = <id>
        → trigger reverses stock with factor -1
      → Telegram editMessageText: "↩️ Registro revertido"
```

### Registration & Onboarding Flow

```
New customer → /registro page
  → POST to Supabase Edge Function: onboarding
      → INSERT INTO empresas (nombre, telegram_token = crypto.randomUUID())
      → INSERT INTO tiendas × 3 (empresa_id)
      → supabase.auth.admin.createUser (email_confirm: true,
                                        user_metadata: { empresa_id, rol: 'admin' })
      → Resend API: email with temp password + /start <token> instructions
  → Admin logs in at /login → Supabase Auth JWT contains empresa_id in user_metadata
```

### Frontend (Next.js 14 App Router)

- `middleware.js` — protects all routes except `/login` and `/registro`; redirects to `/login?redirect=<path>` when no valid session. Uses `@supabase/ssr` `createServerClient` to read JWT from cookies.
- `lib/supabase.js` — `createBrowserClient` from `@supabase/ssr`; stores session in cookies so middleware can read it without extra network calls.
- `lib/queries.js` — all filters applied in SQL (no in-memory empresa filtering). empresa isolation is enforced by RLS on the authenticated session; tienda/tipo filters use `.eq()` and `.or()` directly on the query.
- `lib/realtime.js` — `useRealtimeMovimientos` hook: subscribes to `postgres_changes` INSERT on `movimientos`, re-fetches the full row with joins. RLS on the authenticated client automatically scopes results to the user's empresa.
- `lib/export.js` — XLSX/PDF export utilities.
- `app/registro/page.js` — public onboarding form (empresa name, admin email, 3 sede names).
- `app/login/page.js` — Supabase Auth (`signInWithPassword`); reads `empresa_id` from `user.user_metadata` after login.

**Note**: `app/page.js` (Dashboard) still uses static `MOCK_MOVIMIENTOS` for KPI cards and the chart. These need to be wired to `getDashboardKPIs()` from `lib/queries.js`.

### Database (Supabase/PostgreSQL)

Schema defined in `CREAR_TABLAS_SUPABASE_FINAL.sql`. Migrations in `migrations/` — apply in order via Supabase SQL Editor.

| Migration | What it does |
|-----------|-------------|
| `CREAR_TABLAS_SUPABASE_FINAL.sql` | Base schema: all tables, trigger `tr_actualizar_stock` (INSERT OR DELETE), open RLS policies |
| `migrations/001_multi_empresa.sql` | Adds `empresas` table; adds `empresa_id` FK to `tiendas`, `usuarios`, `categorias`, `productos` |
| `migrations/002_rls_multi_empresa.sql` | Replaces open RLS with tenant isolation via `get_my_empresa_id()` (SECURITY DEFINER function mapping `auth.jwt()->>'sub'` to `usuarios.telegram_id`) |
| `migrations/003_empresa_telegram_token.sql` | Adds `telegram_token TEXT UNIQUE` to `empresas` (used by the Telegram bot `/start` flow) |

Key tables:
- `empresas` (UUID PK) — multi-tenant root; `telegram_token` used to link Telegram employees via `/start <token>`
- `tiendas` → `empresa_id`
- `productos`, `categorias`, `usuarios` → `empresa_id`
- `movimientos` — append-only log; `tipo` ∈ `{venta, ingreso, gasto, traslado}`; `total` is a generated stored column (`cantidad * precio_unitario`); no direct `empresa_id` — empresa isolation via RLS through `productos.empresa_id`
- `stock (producto_id, tienda_id)` — maintained entirely by the Postgres trigger, never written directly; empresa isolation via RLS through `tiendas.empresa_id`

**Trigger**: `tr_actualizar_stock` fires `AFTER INSERT OR DELETE` on `movimientos`. DELETE uses `v_factor = -1` to invert stock math — this is the entire Undo implementation.

**RLS**: All tables use `get_my_empresa_id()` SECURITY DEFINER function. The function maps `auth.jwt()->>'sub'` (Supabase Auth user UUID as text) to `usuarios.telegram_id::text` to retrieve `empresa_id`. Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS entirely.

### Edge Functions (Supabase / Deno)

Located in `supabase/functions/`:

| Function | Trigger | What it does |
|----------|---------|-------------|
| `telegram-bot` | Telegram webhook POST | Receives voice messages → Groq STT → Groq NLU → INSERT movimiento → confirm with Undo button. Also handles `undo_<id>` callbacks → DELETE movimiento |
| `onboarding` | POST from `/registro` page | Creates empresa + tiendas + Supabase Auth user + sends welcome email via Resend |

Both deployed with `--no-verify-jwt` (public endpoints).

### AI Strategy

- **STT**: Groq Whisper (`whisper-large-v3-turbo`) — primary, <500ms
- **NLU**: Groq `llama-3.3-70b-versatile` — converts transcript to structured JSON (`producto_id`, `tipo`, `cantidad`, `tienda_origen_id`, `tienda_destino_id`, `precio_unitario`)
- **Fallback**: Claude 3.5 Haiku — switch in `telegram-bot/index.ts` if SKU match accuracy drops below 95%

## Environment Variables

### Supabase Edge Functions — Secrets

Set via Supabase Dashboard → Edge Functions → Manage secrets, or with:
```bash
supabase secrets set KEY=value
```

| Secret | Required by | Description |
|--------|-------------|-------------|
| `GROQ_API_KEY` | `telegram-bot` | Groq API key for Whisper + Llama |
| `TELEGRAM_BOT_TOKEN` | `telegram-bot` | Token from @BotFather |
| `RESEND_API_KEY` | `onboarding` | Resend API key for welcome emails |
| `RESEND_FROM_EMAIL` | `onboarding` | Verified sender, e.g. `Agent GMS <onboarding@yourdomain.com>` |
| `SUPABASE_URL` | both | Auto-injected by Supabase — no manual setup needed |
| `SUPABASE_SERVICE_ROLE_KEY` | both | Auto-injected by Supabase — no manual setup needed |

### Vercel — Environment Variables

Set via Vercel Dashboard → Project → Settings → Environment Variables.

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public, safe to expose) |

Also add these to `frontend/.env.local` for local development.

### Register the Telegram Webhook

Run once after deploying `telegram-bot`:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<project-ref>.supabase.co/functions/v1/telegram-bot"}'
```

Verify:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## Security Notes

- `GUIA-DESPLIEGUE.md` contains a hardcoded Groq API key (line 149) — rotate it at console.groq.com if not already done.
- RLS policies use `auth.jwt()->>'sub'` mapped to `usuarios.telegram_id::text`. This assumes the Supabase Auth user's UUID (as text) matches the Telegram ID stored in `usuarios`. Adjust `get_my_empresa_id()` in `migrations/002_rls_multi_empresa.sql` if the auth mechanism changes.
- The `onboarding` Edge Function creates Supabase Auth users with `email_confirm: true` and a temporary password sent via email. Ensure Resend is configured with a verified domain before going to production.
- `SUPABASE_SERVICE_ROLE_KEY` is auto-injected into Edge Functions and never exposed to the browser. The frontend only uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
