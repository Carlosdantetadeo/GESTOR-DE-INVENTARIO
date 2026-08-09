# SPECKIT — Almacenero Digital

Especificación del proyecto en formato Spec Kit (spec-driven development).
Fuente de verdad: código en este repo + `MANUAL_TECNICO.md`. Última actualización: 2026-08-09.

---

## 1. Constitución (principios no negociables)

1. **Aislamiento multi-tenant es sagrado.** Todo dato pertenece a una `empresa`. Ningún cambio puede permitir lectura o escritura cross-tenant. `empresa_id` / `tienda_id` son obligatorios en todo INSERT.
2. **RLS no se toca sin instrucción explícita.** Las policies existentes (migraciones 002/007) son el perímetro de seguridad del frontend. Las Edge Functions bypasean RLS con `SERVICE_ROLE_KEY`, por lo que todo chequeo de tenant dentro de ellas debe ser explícito.
3. **`app_metadata`, nunca `user_metadata`.** `user_metadata` es editable por el propio usuario y permitió escalación cross-tenant (bug corregido en migración 007).
4. **`stock` es una tabla derivada.** Solo la mantiene el trigger `tr_actualizar_stock` sobre `movimientos`. Nunca escribir en `stock` directamente. Ante discrepancias: `SELECT recalcular_stock();` (migración 010).
5. **`movimientos` es un ledger append-only.** El Undo se implementa con DELETE + reversión automática del trigger (factor -1), no con updates.
6. **Producción activa con clientes reales.** Un cambio a la vez, confirmado antes de continuar. Cambios en Edge Functions requieren redeploy manual.
7. **Simplicidad primero.** Sin abstracciones especulativas ni features no pedidas.

---

## 2. Especificación funcional (el QUÉ)

### 2.1 Producto

Sistema de inventario multi-tenant para ferreterías. Los operarios registran movimientos de stock por **voz, texto o foto** desde un bot de Telegram; los administradores gestionan y analizan desde un dashboard web.

### 2.2 Actores

| Actor | Canal | Capacidades |
|-------|-------|-------------|
| Operario (vendedor) | Bot de Telegram | Registrar ventas/ingresos/gastos/traslados por voz, texto o imagen; deshacer movimientos propios |
| Admin de empresa | Dashboard web | KPIs, movimientos, inventario, reportes, usuarios, ajustes, configuración |
| Superadmin | Dashboard `/superadmin` | Gestión de empresas y catálogo de modelos NLU |

### 2.3 Historias de usuario principales

- **US-01 — Registro por voz:** Como operario, envío un audio ("vendí 3 martillos a 25 soles") y el sistema transcribe (Groq Whisper), interpreta (NLU), crea el/los movimientos y me confirma con eco de la transcripción y botones de deshacer.
- **US-02 — Registro por imagen:** Como operario, envío una foto (boleta, producto) y el sistema la describe con visión (Groq Llama Scout) y genera los movimientos.
- **US-03 — Deshacer:** Como operario, toco "↩️" y el movimiento se elimina; el stock se revierte automáticamente. Solo puedo deshacer movimientos de mi propia empresa.
- **US-04 — Alta de operario:** Como operario nuevo, envío `/start <token>` al bot, elijo mi sede y quedo vinculado a la empresa dueña del token. Una cuenta de Telegram pertenece a una sola empresa.
- **US-05 — Onboarding de empresa:** Como dueño de ferretería, me registro en `/registro` (empresa + sedes + email); recibo por email una contraseña temporal y el token de Telegram para mis operarios.
- **US-06 — Dashboard:** Como admin, veo KPIs, alertas de stock bajo el mínimo y últimos movimientos en tiempo real, con filtros por fecha exacta y tipo.
- **US-07 — Inventario y reportes:** Como admin, consulto stock por tienda con valorización y descargo reportes (Ventas, Valorización, Transacciones) en Excel/PDF.
- **US-08 — Modelo NLU por empresa:** Como superadmin, asigno a cada empresa su modelo NLU (Groq Llama, Claude Haiku/Sonnet u otro OpenAI-compatible) y monitoreo el consumo de tokens/costo en `consumo_ia`.

### 2.4 Criterios de aceptación transversales

- Un webhook reintentado por Telegram nunca duplica movimientos (dedupe por `update_id`).
- El bot responde 200 a Telegram de inmediato y procesa en background (STT + NLU pueden tardar >5s).
- Requests al webhook sin el header secreto correcto se rechazan con 401 (fail-closed).
- Productos inexistentes mencionados por el operario se auto-crean en la categoría "General"; unicidad por `(empresa_id, LOWER(nombre))`.
- Ningún usuario ve datos de otra empresa, ni por API ni por dashboard.

---

## 3. Plan técnico (el CÓMO)

### 3.1 Stack

| Capa | Tecnología | Ubicación |
|------|-----------|-----------|
| Frontend | Next.js 14 (App Router) en Vercel | `frontend/` |
| Backend | Supabase Edge Functions (Deno/TS) | `supabase/functions/` |
| DB | Supabase PostgreSQL + RLS | `migrations/`, `CREAR_TABLAS_SUPABASE_FINAL.sql` |
| STT | Groq Whisper `whisper-large-v3-turbo` | telegram-bot |
| Visión | Groq `llama-4-scout-17b-16e-instruct` | telegram-bot |
| NLU | Groq Llama 3.3 70B / Claude Haiku-Sonnet / OpenAI-compatible (por empresa) | telegram-bot |
| Email | Resend | onboarding |

### 3.2 Componentes y archivos clave

- `supabase/functions/telegram-bot/index.ts` — webhook del bot: auth por secreto, dedupe, STT/visión/NLU, creación de movimientos, undo, `/start <token>`.
- `supabase/functions/onboarding/index.ts` — alta de empresa: empresas + tiendas + admin (`app_metadata`) + email Resend.
- `frontend/lib/queries.js` — todas las queries a Supabase (un cambio aquí impacta varias páginas: listar impacto antes de tocar).
- `frontend/lib/supabase.js` — cliente Supabase (**no tocar salvo pedido explícito**).
- `frontend/app/` — rutas: `/` (dashboard), `/movimientos`, `/inventario`, `/reportes`, `/login`, `/registro`, `/admin/{usuarios,ajuste,config}`, `/superadmin/{,empresa/[id],modelos,login}`.

### 3.3 Modelo de datos

| Tabla | Rol |
|-------|-----|
| `empresas` | Raíz multi-tenant. `telegram_token` (vinculación de operarios), `nlu_model` |
| `tiendas` | Sedes. FK `empresa_id` |
| `usuarios` | Operarios Telegram. FK `empresa_id`, `tienda_id`; `telegram_id` |
| `productos` | Catálogo por empresa; auto-creación desde el bot |
| `categorias` | Por empresa; "General" se crea automáticamente |
| `movimientos` | Ledger append-only. `tipo` ∈ {venta, ingreso, gasto, traslado}; `total` generado |
| `stock` | Derivada, mantenida solo por trigger |
| `consumo_ia` | Tokens y costo por empresa/modelo |
| `telegram_updates` | Dedupe de webhooks (purga >2 días) |

Migraciones: aplicar en orden en el SQL Editor de Supabase (`migrations/001` → `023`). La 006 está superseded por la 007 (se conserva como historia).

### 3.4 Seguridad

- RLS activo en todas las tablas de tenant; `get_my_empresa_id()` (SECURITY DEFINER) resuelve la empresa desde `app_metadata` o `usuarios.telegram_id`.
- Webhook del bot: fail-closed contra `TELEGRAM_WEBHOOK_SECRET`.
- `SERVICE_ROLE_KEY` solo en Edge Functions; jamás en frontend ni en el repo.
- Secretos: ver `MANUAL_TECNICO.md` §2 (Groq, Telegram, Resend, Anthropic, service role).

### 3.5 Despliegue

```bash
# Edge Functions (manual, tras cada cambio)
supabase functions deploy telegram-bot --no-verify-jwt
supabase functions deploy onboarding   --no-verify-jwt

# Frontend: push a main → Vercel despliega automáticamente
```

### 3.6 Riesgos conocidos

- **Trigger de stock editado a mano en producción** (incidente histórico: ventas sumaban stock). Verificación: comparar `pg_proc.prosrc` de `actualizar_stock_trigger` contra `migrations/005_trigger_null_guard.sql`; remediar con la 005 + `recalcular_stock()`.
- **Callback_data de Telegram limitado a 64 bytes:** el botón "Deshacer todo" se omite si los ids no caben; los individuales siempre caben.
- **Nombres duales `tienda_id`/`empresa_id`:** el sistema nació single-tienda y migró a multi-empresa; ambos campos coexisten (usuario pertenece a una tienda dentro de una empresa).

---

## 4. Definición de "hecho" (checklist por cambio)

- [ ] `empresa_id`/`tienda_id` presentes en todo INSERT nuevo
- [ ] Sin cambios en RLS ni en `frontend/lib/supabase.js` (salvo pedido explícito)
- [ ] Si se tocó `queries.js`: páginas impactadas listadas y revisadas
- [ ] Si se tocó una Edge Function: redeploy manual ejecutado
- [ ] Probado el flujo end-to-end afectado (bot o dashboard)
- [ ] Un solo cambio por entrega, confirmado con el dueño antes de continuar
