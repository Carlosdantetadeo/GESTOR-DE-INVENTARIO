# Manual Técnico — Agent GMS

Sistema de inventario por voz para ferreterías. Versión de producción activa.

> Última actualización: 2026-06-12

---

## 1. Infraestructura

| Capa | Servicio | URL / Referencia |
|------|----------|-----------------|
| Frontend | Vercel (Next.js 14) | https://gestor-de-inventario-one.vercel.app |
| Base de datos | Supabase (PostgreSQL) | https://sqsqyzqwysygoperjwsd.supabase.co |
| Edge Functions | Supabase Deno Runtime | https://sqsqyzqwysygoperjwsd.supabase.co/functions/v1/ |
| STT | Groq Whisper (`whisper-large-v3-turbo`) | https://api.groq.com |
| Vision | Groq (`meta-llama/llama-4-scout-17b-16e-instruct`) | https://api.groq.com |
| NLU | Groq Llama (`llama-3.3-70b-versatile`) | https://api.groq.com |
| NLU alternativo | Anthropic Claude (`claude-haiku-4-5`, `claude-sonnet-4-6`) | https://api.anthropic.com |
| Email | Resend | https://api.resend.com |

---

## 2. Credenciales y Secretos

### 2.1 Supabase

| Variable | Valor |
|----------|-------|
| `SUPABASE_URL` | `https://sqsqyzqwysygoperjwsd.supabase.co` |
| `SUPABASE_ANON_KEY` | Ver Supabase Dashboard → Settings → API → `anon public` |
| `SERVICE_ROLE_KEY` | Ver Supabase Dashboard → Settings → API → `service_role` ⚠️ |

Panel de administración: https://supabase.com/dashboard/project/sqsqyzqwysygoperjwsd

> ⚠️ `SERVICE_ROLE_KEY` bypasea toda RLS. Nunca exponerla en el frontend ni en repositorios públicos.

### 2.2 Secretos de Edge Functions

Configurados en Supabase Dashboard → Edge Functions → Manage secrets, o con:

```bash
supabase secrets set NOMBRE=valor
```

| Secreto | Descripción | Dónde obtenerlo |
|---------|-------------|-----------------|
| `GROQ_API_KEY` | API Key de Groq (STT + NLU + Vision) | https://console.groq.com → API Keys |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram | @BotFather en Telegram → `/mybots` |
| `TELEGRAM_WEBHOOK_SECRET` | **Obligatorio.** String aleatorio (1-256 chars de `A-Za-z0-9_-`). El bot rechaza todo request cuyo header `X-Telegram-Bot-Api-Secret-Token` no coincida. **Fail-closed:** si no está configurado, el bot rechaza todo. Debe ser igual al `secret_token` usado en setWebhook (sección 6). | Generarlo: `openssl rand -hex 32` |
| `RESEND_API_KEY` | API Key de Resend (emails) | https://resend.com/api-keys |
| `RESEND_FROM_EMAIL` | Sender verificado | `Agent GMS <onboarding@clarocomunica.com>` |
| `ANTHROPIC_API_KEY` | API Key de Anthropic (solo si alguna empresa usa NLU `anthropic-*`) | https://console.anthropic.com → API Keys |
| `SERVICE_ROLE_KEY` | Service role de Supabase. **No se auto-inyecta con este nombre** — hay que setearlo manualmente (el código lee `SERVICE_ROLE_KEY`, no `SUPABASE_SERVICE_ROLE_KEY`). | Supabase Dashboard → Settings → API |

`SUPABASE_URL` sí es auto-inyectado por Supabase.

### 2.3 Vercel — Variables de entorno

Configuradas en Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://sqsqyzqwysygoperjwsd.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key pública de Supabase |

Para desarrollo local crear `frontend/.env.local` con las mismas variables.

---

## 3. Edge Functions

### 3.1 `telegram-bot`

- **URL:** `https://sqsqyzqwysygoperjwsd.supabase.co/functions/v1/telegram-bot`
- **Método:** POST (webhook de Telegram)
- **Auth:** `--no-verify-jwt` (público), pero autenticado por el header `X-Telegram-Bot-Api-Secret-Token` contra `TELEGRAM_WEBHOOK_SECRET` (fail-closed).

**Recepción del webhook (antes de cualquier handler):**
```
POST recibido
  → Verificar header X-Telegram-Bot-Api-Secret-Token == TELEGRAM_WEBHOOK_SECRET
      (si no coincide o el secret no está configurado → 401)
  → Dedupe por update_id: INSERT en telegram_updates (PK update_id)
      → si ya existe (23505) → 200 y se descarta (Telegram reintentó)
  → Responder 200 INMEDIATAMENTE y procesar en background
      (EdgeRuntime.waitUntil — STT + NLU pueden tardar >5s y Telegram
       reintenta si no recibe 200 a tiempo)
```

**Flujo principal:**
```
Audio/Texto/Imagen recibido
  → Groq Whisper (si es audio)     → transcript
  → Groq Vision (si es imagen)     → descripción
  → NLU según empresas.nlu_model   → JSON con array de movimientos
      (groq-llama | anthropic-haiku | anthropic-sonnet)
  → Auto-crear productos si no existen en catálogo (categoría "General")
  → INSERT en movimientos (trigger actualiza stock)
  → INSERT en consumo_ia (tokens + costo)
  → Telegram: confirmación con eco de la transcripción (🎤 "..."),
    un botón "↩️ <producto>" por movimiento, y "↩️ Deshacer todo"
    si hay varios (omitido si los ids no entran en los 64 bytes
    del callback_data — los individuales siempre caben)
```

**Flujo undo:**
```
Callback undo_<id> o undo_<id1>,<id2>,...
  → Verificar que los movimientos pertenecen a la empresa del operario
    (vía productos.empresa_id — las Edge Functions bypasean RLS,
     el chequeo de tenant es explícito)
  → DELETE FROM movimientos WHERE id IN (ids)
  → Trigger revierte stock automáticamente (factor -1)
  → Telegram: mensaje actualizado "Revertido"
```

**Flujo /start `<token>`:**
```
Usuario envía /start TOKEN
  → Buscar empresa por telegram_token
  → Mostrar sedes disponibles (botones inline, callback join_<token>_<tiendaId>)
  → handleJoin: verifica que la tienda pertenece a la empresa del token
    → INSERT en usuarios (rol 'vendedor', tienda_id, empresa_id)
  → Si el telegram_id ya estaba registrado, el bot lo informa
    (una cuenta de Telegram pertenece a una sola empresa)
```

### 3.2 `onboarding`

- **URL:** `https://sqsqyzqwysygoperjwsd.supabase.co/functions/v1/onboarding`
- **Método:** POST (llamado desde `/registro`)
- **Auth:** `--no-verify-jwt` (público)

**Flujo:**
```
POST { empresa_nombre, admin_email, sedes[] }
  → INSERT empresas (con telegram_token = UUID aleatorio)
  → INSERT tiendas × N
  → supabase.auth.admin.createUser (email_confirm: true,
        app_metadata: { empresa_id, rol: 'admin' })
        ⚠️ app_metadata, NUNCA user_metadata: user_metadata es editable
        por el propio usuario y permitiría escalación cross-tenant
  → Resend: email con contraseña temporal + token de Telegram
  → Response: { ok: true, empresa_id, temp_password }
```

> La contraseña temporal también se muestra en pantalla en `/registro` por si el email falla.

**Deploy:**
```bash
supabase functions deploy telegram-bot --no-verify-jwt
supabase functions deploy onboarding   --no-verify-jwt
```

---

## 4. Base de Datos

### 4.1 Tablas principales

| Tabla | Descripción |
|-------|-------------|
| `empresas` | Raíz multi-tenant. Campo `telegram_token` (UUID) para vincular operarios. Campo `nlu_model` para elegir modelo IA por empresa. |
| `tiendas` | Sucursales. FK `empresa_id`. |
| `usuarios` | Operarios de Telegram. FK `empresa_id`, `tienda_id`. `telegram_id` = ID numérico de Telegram. |
| `productos` | Catálogo. FK `empresa_id`, `categoria_id`. Se crean automáticamente desde el bot si no existen. Unicidad por `(empresa_id, LOWER(nombre))` — migración 008. |
| `categorias` | Categorías de productos. FK `empresa_id`. La categoría `General` se crea automáticamente. |
| `movimientos` | Log append-only. `tipo` ∈ {venta, ingreso, gasto, traslado}. `total` es columna generada (`cantidad × precio_unitario`). |
| `stock` | Mantenido 100% por trigger. Nunca escribir directo. FK `producto_id`, `tienda_id`. |
| `consumo_ia` | Log de tokens usados por empresa y modelo. |
| `telegram_updates` | Dedupe de webhooks (PK `update_id`). Evita movimientos duplicados cuando Telegram reintenta. Se purga automáticamente (>2 días). |

### 4.2 Trigger de stock

```sql
-- Se ejecuta AFTER INSERT OR DELETE en movimientos
-- INSERT: suma o resta stock según tipo
-- DELETE: aplica factor -1 (esto implementa el Undo completo)
-- En ingreso INSERT también actualiza ultimo_costo y
-- precio_venta_sugerido del producto
tr_actualizar_stock → actualizar_stock_trigger()
```

> ⚠️ **Incidente conocido:** producción llegó a correr una variante editada a
> mano del trigger cuyo `ON CONFLICT` usaba `cantidad - EXCLUDED.cantidad`
> para ventas (doble negación → las ventas SUMABAN stock). Si el stock vuelve
> a discrepar del ledger: comparar `pg_proc.prosrc` de
> `actualizar_stock_trigger` contra `migrations/005_trigger_null_guard.sql`,
> re-aplicar la 005 y ejecutar `SELECT recalcular_stock();` (migración 010).

### 4.3 RLS — Aislamiento multi-tenant

Función SECURITY DEFINER que resuelve el `empresa_id` del usuario autenticado (versión vigente, migración 007):

```sql
CREATE OR REPLACE FUNCTION public.get_my_empresa_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Admin: empresa_id viene de app_metadata (solo modificable con service role)
    (auth.jwt()->'app_metadata'->>'empresa_id')::uuid,
    -- Operario Telegram: buscar por telegram_id
    (SELECT empresa_id FROM public.usuarios WHERE telegram_id::text = auth.jwt()->>'sub')
  )
$$;
```

> ⚠️ **Nunca leer `user_metadata` aquí.** Es editable por el propio usuario vía
> `supabase.auth.updateUser()` y permitía falsificar el `empresa_id` (escalación
> cross-tenant, lectura y escritura). Ese era el bug de la migración 006,
> corregido en la 007.

> Las Edge Functions usan `SERVICE_ROLE_KEY` y bypasean RLS completamente —
> todo chequeo de tenant dentro de ellas es explícito (ver `handleUndo` /
> `handleJoin`).

### 4.4 Migraciones

Aplicar en orden en Supabase SQL Editor:

| Archivo | Descripción |
|---------|-------------|
| `CREAR_TABLAS_SUPABASE_FINAL.sql` | Schema base completo |
| `migrations/001_multi_empresa.sql` | Tabla `empresas`, FKs |
| `migrations/002_rls_multi_empresa.sql` | RLS con `get_my_empresa_id()` |
| `migrations/003_empresa_telegram_token.sql` | Campo `telegram_token` en empresas |
| `migrations/004_nlu_model_consumo.sql` | Campo `nlu_model`, tabla `consumo_ia` |
| `migrations/005_trigger_null_guard.sql` | Trigger con NULL guards; actualiza `ultimo_costo`/`precio_venta_sugerido` en ingreso |
| `migrations/006_fix_admin_rls.sql` | **Superseded por 007** — leía `user_metadata` (inseguro). Se conserva solo como historia. |
| `migrations/007_empresa_id_app_metadata.sql` | **Fix de seguridad:** mueve `empresa_id`/`rol` a `app_metadata`, backfill de usuarios existentes, restaura `SET search_path` |
| `migrations/008_productos_unique_por_empresa.sql` | Unicidad de producto por `(empresa_id, LOWER(nombre))`. Correr primero el precheck de duplicados comentado al inicio del archivo. |
| `migrations/009_telegram_updates_dedupe.sql` | Tabla `telegram_updates` para dedupe de webhooks |
| `migrations/010_recalcular_stock.sql` | Función de mantenimiento `recalcular_stock()`: reconstruye `stock` desde el ledger `movimientos` (EXECUTE revocado a anon/authenticated) |

---

## 5. Frontend (Next.js 14)

### 5.1 Rutas

| Ruta | Descripción | Acceso |
|------|-------------|--------|
| `/` | Dashboard con KPIs, alertas de stock bajo y últimos movimientos en tiempo real | Autenticado |
| `/movimientos` | Tabla completa + filtros + exportar + Undo por fila | Autenticado |
| `/inventario` | Stock por tienda + valorización + exportar | Autenticado |
| `/reportes` | Reportes descargables (Ventas, Valorización, Transacciones) en Excel/PDF | Autenticado |
| `/admin/usuarios` | Token de Telegram de la empresa + lista de operarios vinculados | Autenticado |
| `/admin/config` | Selector de modelo NLU por empresa + consumo de IA acumulado | Autenticado |
| `/login` | Login con Supabase Auth + recuperación de contraseña | Público |
| `/registro` | Onboarding de nueva empresa | Público |

### 5.2 Archivos clave

| Archivo | Función |
|---------|---------|
| `middleware.js` | Protege todas las rutas excepto `/login` y `/registro` |
| `lib/supabase.js` | Cliente Supabase (browser, cookies) |
| `lib/queries.js` | Todas las queries SQL vía PostgREST |
| `lib/realtime.js` | Hook `useRealtimeMovimientos` (websocket) |
| `lib/export.js` | Exportar XLSX y PDF |
| `components/Sidebar.js` | Navegación: Dashboard, Movimientos, Inventario, Reportes, Usuarios, Configuración |

### 5.3 Comandos de desarrollo

```bash
cd frontend
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

---

## 6. Configuración del Webhook de Telegram

Ejecutar una vez después de deployar `telegram-bot`. El `secret_token` **debe ser idéntico** al secreto `TELEGRAM_WEBHOOK_SECRET` configurado en Supabase (sección 2.2) — si difieren o falta, el bot rechaza todos los mensajes:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://sqsqyzqwysygoperjwsd.supabase.co/functions/v1/telegram-bot","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'
```

Verificar:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

> Si el bot deja de responder de golpe, lo primero a revisar es que
> `TELEGRAM_WEBHOOK_SECRET` esté configurado en Supabase y coincida con el
> `secret_token` del webhook registrado.

---

## 7. Configuración de Supabase Auth

En Supabase Dashboard → Authentication → URL Configuration:

| Campo | Valor |
|-------|-------|
| Site URL | `https://gestor-de-inventario-one.vercel.app` |
| Redirect URLs | `https://gestor-de-inventario-one.vercel.app/**` |

---

## 8. Modelos de IA por empresa

El campo `empresas.nlu_model` define qué modelo usa cada empresa para NLU:

| Valor | Modelo | Costo (aprox.) |
|-------|--------|----------------|
| `groq-llama` (default) | `llama-3.3-70b-versatile` | $0.00059/$0.00079 por 1K tokens |
| `anthropic-haiku` | `claude-haiku-4-5-20251001` | $0.0008/$0.004 por 1K tokens |
| `anthropic-sonnet` | `claude-sonnet-4-6` | $0.003/$0.015 por 1K tokens |

El admin lo cambia desde el dashboard en `/admin/config` (también se puede vía SQL):

```sql
UPDATE empresas SET nlu_model = 'anthropic-haiku' WHERE id = '<empresa_id>';
```

El consumo (llamadas, tokens, costo USD) queda registrado por empresa en `consumo_ia` y se visualiza en la misma página.

---

## 9. Seguridad

- **Tenant isolation vive en `app_metadata`** (migración 007). Nunca poner `empresa_id` ni `rol` en `user_metadata`: es editable por el usuario final y leerla en RLS permite escalación cross-tenant.
- **El webhook de Telegram está autenticado** vía header `X-Telegram-Bot-Api-Secret-Token` contra `TELEGRAM_WEBHOOK_SECRET` (fail-closed).
- **Las Edge Functions bypasean RLS** (service role); los chequeos de tenant dentro de ellas son explícitos: `handleUndo` verifica que los movimientos pertenezcan a la empresa del operario, `handleJoin` que la tienda pertenezca a la empresa del token.
- `SERVICE_ROLE_KEY` nunca se expone al frontend. Solo se usa en Edge Functions server-side.
- El frontend solo usa `NEXT_PUBLIC_SUPABASE_ANON_KEY` (segura para exponer).
- RLS activo en todas las tablas. Aislamiento completo entre empresas.
- Una API key de Groq estuvo commiteada históricamente (removida en `ebfe6a3`, pero sigue en el historial de git) — debe rotarse en console.groq.com si el repo se subió a algún remote.
- La Edge Function `onboarding` no tiene rate limiting ni captcha todavía.
- Resend configurado con dominio verificado `clarocomunica.com`.
