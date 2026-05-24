# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Agent GMS** is a zero-friction inventory management system for a hardware store ("ferretería") chain. Operators register sales and inventory movements by sending Telegram voice messages in ~2 seconds. The system uses AI to transcribe and interpret speech, auto-commits to the database, and offers a one-tap "Undo" button via Telegram.

## Development Commands

All commands run from the `frontend/` directory:

```bash
npm run dev      # Start Next.js dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # Run ESLint
```

## Environment Setup

Create `frontend/.env.local` with:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Architecture

### Data Flow (Core Loop)
```
Operator → Telegram voice message
  → n8n workflow (n8n_workflow_fixed.json)
    → Groq Whisper (speech-to-text, <500ms)
    → Groq Llama 3.3-70b (audio text → structured JSON with producto/cantidad/tipo/tienda)
    → Supabase INSERT into `movimientos`
      → Postgres trigger `tr_actualizar_stock` auto-updates `stock` table
    → Telegram bot sends confirmation + "↩️ Deshacer" inline button
  → If "Undo" pressed: n8n DELETE from `movimientos` → trigger reverses stock
```

### Frontend (Next.js 14 App Router)

The `frontend/` app is a **read-only dashboard** — no writes originate from the UI. All inventory mutations come exclusively from the n8n/Telegram pipeline.

- `lib/supabase.js` — Supabase client (env vars)
- `lib/queries.js` — Data fetching functions; multi-tenant filtering is done **in-memory** after fetching (not via SQL `WHERE empresa_id =`), because Supabase RLS is wide-open for MVP
- `lib/realtime.js` — `useRealtimeMovimientos` hook: subscribes to `postgres_changes` on `movimientos` INSERT, re-fetches the full row with joins, then filters by `empresa_id` before calling the callback
- `lib/export.js` — XLSX/PDF export utilities

**Important**: `app/page.js` (Dashboard) currently uses **static mock data** (`MOCK_MOVIMIENTOS`) for KPI cards and the chart — these are not wired to Supabase yet. Only the movements table at the bottom uses the realtime hook.

### Database (Supabase/PostgreSQL)

Schema defined in `CREAR_TABLAS_SUPABASE_FINAL.sql`. Apply via Supabase SQL Editor.

Key tables and relationships:
- `empresas` (UUID PK) — multi-tenant root; added via `migrations/001_multi_empresa.sql`
- `tiendas` → `empresa_id`
- `productos`, `categorias`, `usuarios` → `empresa_id`
- `movimientos` — append-only log; `tipo` ∈ `{venta, ingreso, gasto, traslado}`; `total` is a **generated stored column** (`cantidad * precio_unitario`)
- `stock (producto_id, tienda_id)` — maintained entirely by the Postgres trigger, never written directly

**Trigger**: `tr_actualizar_stock` fires `AFTER INSERT OR DELETE` on `movimientos`. On DELETE it uses `v_factor = -1` to invert the stock math, enabling the Undo feature without any additional application code.

**RLS**: All tables have `USING (true)` open policies — intentional for MVP. Must be tightened before production.

### n8n Automation

`n8n_workflow_fixed.json` — import this into n8n via `Ctrl+V` on the canvas. Requires three credentials:
- `"Postgres account"` — Supabase PostgreSQL URI
- `"Telegram account"` — bot token
- `"Groq Header Auth"` — Header Auth credential with `Authorization: Bearer <groq_key>`

### AI Strategy

- **STT**: Groq Whisper (`whisper-large-v3-turbo`) — primary, <500ms
- **NLU**: Groq `llama-3.3-70b-versatile` — converts transcript to structured JSON (producto, cantidad, tipo, tienda)
- **Fallback**: Claude 3.5 Haiku — switch in n8n if SKU match accuracy drops below 95%

## Security Notes

- `GUIA-DESPLIEGUE.md` contains a hardcoded Groq API key (line 149) — **rotate it immediately** at console.groq.com if it has not been invalidated already.
- `app/login/page.js` uses hardcoded credentials for demo purposes — not connected to Supabase Auth. Replace before any real deployment.
