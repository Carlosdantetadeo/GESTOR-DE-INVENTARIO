# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Agent GMS** is a zero-friction inventory management system for a hardware store ("ferretería") chain. Operators register sales and inventory movements by sending Telegram voice messages in ~2 seconds. The system uses AI to transcribe and interpret speech, auto-commits to the database, and offers a one-tap "Undo" button via Telegram.

**n8n and Railway have been replaced.** The automation layer runs entirely as Supabase Edge Functions (Deno). There is no external orchestration dependency.

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
Operator → Telegram voice/text/photo message
  → Supabase Edge Function: telegram-bot
      → (voice)  Groq Whisper whisper-large-v3-turbo  (STT, <500ms)
      → (photo)  Groq llama-4-scout-17b vision         (image → description)
      → Groq llama-3.3-70b or Anthropic Claude          (transcript → structured JSON)
        model selected per-empresa via empresas.nlu_model
      → Auto-create product if not found in catalog
      → Supabase INSERT into `movimientos`   (SERVICE_ROLE_KEY, bypasses RLS)
        → Postgres trigger actualizar_stock_trigger auto-updates `stock`
      → Telegram sendMessage: confirmation + individual "↩️ Deshacer" buttons per product
        + "↩️ Deshacer todo" button when multiple products
  → Operator taps Undo
      → Telegram callback_query (prefix: undo_<id> or undo_<id1>,<id2>...)
      → Edge Function: verifies the movimientos belong to the operator's empresa
        (via productos.empresa_id), then DELETE FROM movimientos WHERE id IN (ids)
        → trigger reverses stock with factor -1
      → Telegram editMessageText: "↩️ Registro(s) revertido(s)"
```

### Operator Onboarding via Telegram

```
Operator sends /start <token> in Telegram
  → handleStart: looks up empresa by telegram_token, shows sede buttons
  → Operator taps a sede button (callback_data: join_<token>_<tiendaId>)
  → handleJoin: INSERTs usuario (rol: 'vendedor', tienda_id, empresa_id)
  → Operator can now send voice/text/photo messages
```

### Registration & Onboarding Flow (Admin)

```
New customer → /registro page
  → POST to Supabase Edge Function: onboarding
      → INSERT INTO empresas (nombre, telegram_token = crypto.randomUUID())
      → INSERT INTO tiendas × N (empresa_id)
      → supabase.auth.admin.createUser (email_confirm: true,
                                        app_metadata: { empresa_id, rol: 'admin' })
      → Resend API: email with temp password + /start <token> instructions
  → Admin logs in at /login → Supabase Auth JWT contains empresa_id in app_metadata
    (app_metadata, NOT user_metadata: user_metadata is editable by the user
     via auth.updateUser() and must never be trusted for tenant isolation)
```

### Frontend (Next.js 14 App Router)

- `middleware.js` — protects all routes except `/login` and `/registro`; redirects to `/login?redirect=<path>`.
- `lib/supabase.js` — `createBrowserClient` from `@supabase/ssr`; stores session in cookies.
- `lib/queries.js` — all filters applied in SQL. empresa isolation enforced by RLS; tienda/tipo filters use `.eq()` and `.or()`. Note: product search by name is filtered in-memory (PostgREST limitation on joined columns).
- `lib/realtime.js` — `useRealtimeMovimientos` hook: subscribes to `postgres_changes` INSERT on `movimientos`, re-fetches full row with joins. RLS scopes to user's empresa automatically.
- `lib/export.js` — XLSX/PDF export utilities.
- `app/page.js` — Dashboard: KPI cards, stock alerts, and movements table all wired to real Supabase data via `getDashboardKPIs`, `getStock`, `getMovimientos`.
- `app/registro/page.js` — public onboarding form.
- `app/login/page.js` — Supabase Auth signInWithPassword.
- `app/admin/config/page.js` — admin page to select NLU model per empresa and view AI cost breakdown.

### Database (Supabase/PostgreSQL)

Schema defined in `CREAR_TABLAS_SUPABASE_FINAL.sql`. Apply migrations in order via Supabase SQL Editor.

| Migration | What it does |
|-----------|-------------|
| `CREAR_TABLAS_SUPABASE_FINAL.sql` | Base schema: all tables, trigger `tr_actualizar_stock` (INSERT OR DELETE), open RLS policies |
| `migrations/001_multi_empresa.sql` | Adds `empresas` table; adds `empresa_id` FK to `tiendas`, `usuarios`, `categorias`, `productos` |
| `migrations/002_rls_multi_empresa.sql` | Replaces open RLS with tenant isolation via `get_my_empresa_id()` SECURITY DEFINER function |
| `migrations/003_empresa_telegram_token.sql` | Adds `telegram_token TEXT UNIQUE` to `empresas` |
| `migrations/004_nlu_model_consumo.sql` | Adds `nlu_model TEXT DEFAULT 'groq-llama'` to `empresas`; creates `consumo_ia` table |
| `migrations/005_trigger_null_guard.sql` | Replaces trigger function with NULL guards on tienda_id; also updates `ultimo_costo`/`precio_venta_sugerido` on ingreso |
| `migrations/006_fix_admin_rls.sql` | (Superseded by 007) `get_my_empresa_id()` reading JWT `user_metadata.empresa_id` — **insecure**, kept only as history |
| `migrations/007_empresa_id_app_metadata.sql` | **Security fix**: moves `empresa_id`/`rol` to `app_metadata` (user-editable `user_metadata` allowed cross-tenant escalation); backfills existing auth users; `get_my_empresa_id()` reads `app_metadata` + restores `SET search_path` |
| `migrations/008_productos_unique_por_empresa.sql` | Drops global `productos_nombre_key`; adds unique index `(empresa_id, LOWER(nombre))` — run the duplicate precheck commented at the top first |
| `migrations/009_telegram_updates_dedupe.sql` | Creates `telegram_updates (update_id PK)` — webhook dedupe so Telegram retries don't duplicate movimientos; the bot responds 200 immediately and processes in background via `EdgeRuntime.waitUntil` |
| `migrations/010_recalcular_stock.sql` | `recalcular_stock()` maintenance function: rebuilds `stock` from the `movimientos` ledger (EXECUTE revoked from anon/authenticated). Run after any stock drift. |
| `migrations/012_tipo_ajuste.sql` | Adds `tipo = 'ajuste'` (signed `cantidad` = real count minus system stock, on `tienda_origen`) with mandatory `motivo`; adds `cantidad > 0` CHECK for classic types (run the cantidad precheck commented at the top first); trigger function canonical source moves from 005 to this file |

> ⚠️ Production once ran a hand-edited trigger variant whose `ON CONFLICT` used `cantidad - EXCLUDED.cantidad` for ventas (double negation → sales ADDED stock). If stock ever disagrees with the ledger again, first compare `pg_proc.prosrc` for `actualizar_stock_trigger` against `migrations/005`, re-apply 005, then `SELECT recalcular_stock();`.

Key tables:
- `empresas` — multi-tenant root; `telegram_token` links operators; `nlu_model` sets per-tenant AI model
- `tiendas` → `empresa_id`
- `productos`, `categorias`, `usuarios` → `empresa_id`
- `movimientos` — append-only log; `tipo` ∈ `{venta, ingreso, gasto, traslado}`; `total` is a generated stored column (`cantidad * precio_unitario`)
- `stock (producto_id, tienda_id)` — maintained entirely by `actualizar_stock_trigger`, never written directly
- `consumo_ia` — per-empresa AI usage log (model, tokens_in, tokens_out, cost_usd); RLS-scoped per empresa

**Trigger** `actualizar_stock_trigger`: fires `AFTER INSERT OR DELETE` on `movimientos`. NULL guards prevent errors when tienda fields are missing. DELETE uses `v_factor = -1` to invert stock math (the entire Undo implementation). On ingreso INSERT also updates `ultimo_costo` and `precio_venta_sugerido` on `productos`.

**RLS** — `get_my_empresa_id()` SECURITY DEFINER (`SET search_path = public`): checks `auth.jwt()->'app_metadata'->>'empresa_id'` first (admin JWT flow), then falls back to `SELECT empresa_id FROM usuarios WHERE telegram_id::text = auth.jwt()->>'sub'` (operator). Never read `user_metadata` here — it is user-editable. Edge Functions use `SERVICE_ROLE_KEY` which bypasses RLS, so any tenant scoping inside them must be explicit (see `handleUndo`/`handleJoin`).

### Edge Functions (Supabase / Deno)

Located in `supabase/functions/`:

| Function | Trigger | What it does |
|----------|---------|-------------|
| `telegram-bot` | Telegram webhook POST | Handles `/start <token>`, `join_` callbacks, voice (Groq Whisper STT), text, and photo (Groq Vision). NLU model is per-empresa. Auto-creates missing products in catalog. Inserts movimientos and logs AI usage to `consumo_ia`. |
| `onboarding` | POST from `/registro` page | Creates empresa + tiendas + Supabase Auth user + sends welcome email via Resend |

Both deployed with `--no-verify-jwt` (public endpoints).

### AI Strategy

- **STT**: Groq Whisper (`whisper-large-v3-turbo`) — voice transcription
- **Vision**: Groq `meta-llama/llama-4-scout-17b-16e-instruct` — photo → inventory description
- **NLU**: Per-empresa model selected in `empresas.nlu_model`, configurable via `app/admin/config/page.js`:
  - `groq-llama` → `llama-3.3-70b-versatile` (default, cheapest)
  - `anthropic-haiku` → `claude-haiku-4-5-20251001`
  - `anthropic-sonnet` → `claude-sonnet-4-6`

NLU receives a product + store catalog and returns a JSON array of movimientos. Products not found in the catalog are auto-created with `categoria = 'General'`.

## Environment Variables

### Supabase Edge Functions — Secrets

```bash
supabase secrets set KEY=value
```

| Secret | Required by | Description |
|--------|-------------|-------------|
| `GROQ_API_KEY` | `telegram-bot` | Groq API key for Whisper + Llama + Vision |
| `TELEGRAM_BOT_TOKEN` | `telegram-bot` | Token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | `telegram-bot` | **Required** — random string (1-256 chars of `A-Za-z0-9_-`). The function rejects any request whose `X-Telegram-Bot-Api-Secret-Token` header doesn't match (fail-closed: if unset, the bot rejects everything). Must equal the `secret_token` used in setWebhook. |
| `ANTHROPIC_API_KEY` | `telegram-bot` | Required only if using `anthropic-haiku` or `anthropic-sonnet` NLU |
| `RESEND_API_KEY` | `onboarding` | Resend API key for welcome emails |
| `RESEND_FROM_EMAIL` | `onboarding` | Verified sender, e.g. `Agent GMS <onboarding@yourdomain.com>` |
| `SUPABASE_URL` | both | Auto-injected by Supabase |
| `SERVICE_ROLE_KEY` | `telegram-bot` | **Not** auto-injected — must be set manually. The code reads `Deno.env.get('SERVICE_ROLE_KEY')`, not `SUPABASE_SERVICE_ROLE_KEY`. |

### Vercel — Environment Variables

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

Also add to `frontend/.env.local` for local development.

### Register the Telegram Webhook

Run once after deploying `telegram-bot`. The `secret_token` must match the `TELEGRAM_WEBHOOK_SECRET` Supabase secret:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<project-ref>.supabase.co/functions/v1/telegram-bot","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'
```

## Security Notes

- **Tenant isolation lives in `app_metadata`** (migration 007). Never put `empresa_id` or `rol` in `user_metadata` — it is editable by the end user via `supabase.auth.updateUser()` and reading it in RLS allows cross-tenant escalation.
- **The Telegram webhook is authenticated** via the `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET` (fail-closed). If the bot suddenly stops responding, check that the secret is set and matches the registered webhook.
- **Edge Functions bypass RLS** (service role), so tenant checks inside them are explicit: `handleUndo` verifies movimientos belong to the operator's empresa; `handleJoin` verifies the tienda belongs to the token's empresa.
- A Groq API key was committed historically (removed in `ebfe6a3`, but still present in git history) — it must be rotated at console.groq.com if the repo was ever pushed to a remote.
- The `onboarding` Edge Function creates Supabase Auth users with `email_confirm: true`. Ensure Resend is configured with a verified domain before production. It has no rate limiting/captcha yet.
- `SERVICE_ROLE_KEY` must be set manually as a Supabase secret for the `telegram-bot` function — it is **not** auto-injected under that name.
