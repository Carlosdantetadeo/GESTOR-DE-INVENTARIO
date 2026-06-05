# Manual Técnico — Agent GMS

Sistema de inventario por voz para ferreterías. Versión de producción activa.

---

## 1. Infraestructura

| Capa | Servicio | URL / Referencia |
|------|----------|-----------------|
| Frontend | Vercel (Next.js 14) | https://gestor-de-inventario-one.vercel.app |
| Base de datos | Supabase (PostgreSQL) | https://sqsqyzqwysygoperjwsd.supabase.co |
| Edge Functions | Supabase Deno Runtime | https://sqsqyzqwysygoperjwsd.supabase.co/functions/v1/ |
| STT | Groq Whisper (`whisper-large-v3-turbo`) | https://api.groq.com |
| NLU | Groq Llama (`llama-3.3-70b-versatile`) | https://api.groq.com |
| NLU fallback | Anthropic Claude (`claude-haiku-4-5`, `claude-sonnet-4-6`) | https://api.anthropic.com |
| Email | Resend | https://api.resend.com |

---

## 2. Credenciales y Secretos

### 2.1 Supabase

| Variable | Valor |
|----------|-------|
| `SUPABASE_URL` | `https://sqsqyzqwysygoperjwsd.supabase.co` |
| `SUPABASE_ANON_KEY` | Ver Supabase Dashboard → Settings → API → `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Ver Supabase Dashboard → Settings → API → `service_role` ⚠️ |

Panel de administración: https://supabase.com/dashboard/project/sqsqyzqwysygoperjwsd

> ⚠️ `SERVICE_ROLE_KEY` bypasea toda RLS. Nunca exponerla en el frontend ni en repositorios públicos.

### 2.2 Secretos de Edge Functions

Configurados en Supabase Dashboard → Edge Functions → Manage secrets, o con:

```bash
supabase secrets set NOMBRE=valor
```

| Secreto | Descripción | Dónde obtenerlo |
|---------|-------------|-----------------|
| `GROQ_API_KEY` | API Key de Groq (STT + NLU) | https://console.groq.com → API Keys |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram | @BotFather en Telegram → `/mybots` |
| `RESEND_API_KEY` | API Key de Resend (emails) | https://resend.com/api-keys |
| `RESEND_FROM_EMAIL` | Sender verificado | `Agent GMS <onboarding@clarocomunica.com>` |
| `ANTHROPIC_API_KEY` | API Key de Anthropic (fallback NLU) | https://console.anthropic.com → API Keys |
| `SERVICE_ROLE_KEY` | Service role de Supabase | Supabase Dashboard → Settings → API |

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
- **Auth:** `--no-verify-jwt` (público)

**Flujo principal:**
```
Audio/Texto/Imagen recibido
  → Groq Whisper (si es audio)     → transcript
  → Groq Vision (si es imagen)     → descripción
  → Groq Llama NLU                 → JSON con array de movimientos
  → Auto-crear productos si no existen en catálogo
  → INSERT en movimientos (trigger actualiza stock)
  → Telegram: confirmación + botón Deshacer
```

**Flujo undo:**
```
Callback undo_<id1,id2,...>
  → DELETE FROM movimientos WHERE id IN (ids)
  → Trigger revierte stock automáticamente
  → Telegram: mensaje actualizado "Revertido"
```

**Flujo /start `<token>`:**
```
Usuario envía /start TOKEN
  → Buscar empresa por telegram_token
  → Mostrar sedes disponibles (botones inline)
  → Al seleccionar sede: INSERT en usuarios
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
  → supabase.auth.admin.createUser (email_confirm: true, user_metadata: { empresa_id, rol: 'admin' })
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
| `productos` | Catálogo. FK `empresa_id`, `categoria_id`. Se crean automáticamente desde el bot si no existen. |
| `categorias` | Categorías de productos. FK `empresa_id`. La categoría `General` se crea automáticamente. |
| `movimientos` | Log append-only. `tipo` ∈ {venta, ingreso, gasto, traslado}. `total` es columna generada (`cantidad × precio_unitario`). |
| `stock` | Mantenido 100% por trigger. Nunca escribir directo. FK `producto_id`, `tienda_id`. |
| `consumo_ia` | Log de tokens usados por empresa y modelo. |

### 4.2 Trigger de stock

```sql
-- Se ejecuta AFTER INSERT OR DELETE en movimientos
-- INSERT: suma o resta stock según tipo
-- DELETE: aplica factor -1 (esto implementa el Undo completo)
tr_actualizar_stock
```

### 4.3 RLS — Aislamiento multi-tenant

Función SECURITY DEFINER que resuelve el `empresa_id` del usuario autenticado:

```sql
CREATE OR REPLACE FUNCTION get_my_empresa_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    -- Admins: empresa_id en JWT user_metadata (creados vía onboarding)
    (auth.jwt()->'user_metadata'->>'empresa_id')::uuid,
    -- Operarios Telegram: buscar por telegram_id en usuarios
    (SELECT empresa_id FROM usuarios WHERE telegram_id::text = auth.jwt()->>'sub')
  )
$$;
```

> Las Edge Functions usan `SERVICE_ROLE_KEY` y bypasean RLS completamente.

### 4.4 Migraciones

Aplicar en orden en Supabase SQL Editor:

| Archivo | Descripción |
|---------|-------------|
| `CREAR_TABLAS_SUPABASE_FINAL.sql` | Schema base completo |
| `migrations/001_multi_empresa.sql` | Tabla `empresas`, FKs |
| `migrations/002_rls_multi_empresa.sql` | RLS con `get_my_empresa_id()` |
| `migrations/003_empresa_telegram_token.sql` | Campo `telegram_token` en empresas |
| `migrations/004_nlu_model_consumo.sql` | Campo `nlu_model`, tabla `consumo_ia` |
| `migrations/005_trigger_null_guard.sql` | Guard para trigger con NULLs |
| `migrations/006_fix_admin_rls.sql` | RLS compatible con admins via user_metadata |

---

## 5. Frontend (Next.js 14)

### 5.1 Rutas

| Ruta | Descripción | Acceso |
|------|-------------|--------|
| `/` | Dashboard con KPIs y últimos movimientos | Autenticado |
| `/movimientos` | Tabla completa + filtros + exportar | Autenticado |
| `/inventario` | Stock por tienda | Autenticado |
| `/reportes` | Reportes y gráficos | Autenticado |
| `/admin` | Panel de administración | Autenticado |
| `/login` | Login con Supabase Auth | Público |
| `/registro` | Onboarding de nueva empresa | Público |

### 5.2 Archivos clave

| Archivo | Función |
|---------|---------|
| `middleware.js` | Protege todas las rutas excepto `/login` y `/registro` |
| `lib/supabase.js` | Cliente Supabase (browser, cookies) |
| `lib/queries.js` | Todas las queries SQL vía PostgREST |
| `lib/realtime.js` | Hook `useRealtimeMovimientos` (websocket) |
| `lib/export.js` | Exportar XLSX y PDF |

### 5.3 Comandos de desarrollo

```bash
cd frontend
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

---

## 6. Configuración del Webhook de Telegram

Ejecutar una vez después de deployar `telegram-bot`:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://sqsqyzqwysygoperjwsd.supabase.co/functions/v1/telegram-bot"}'
```

Verificar:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

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

Cambiar modelo de una empresa:
```sql
UPDATE empresas SET nlu_model = 'anthropic-haiku' WHERE id = '<empresa_id>';
```

---

## 9. Seguridad

- `SERVICE_ROLE_KEY` nunca se expone al frontend. Solo se usa en Edge Functions server-side.
- El frontend solo usa `NEXT_PUBLIC_SUPABASE_ANON_KEY` (segura para exponer).
- RLS activo en todas las tablas. Aislamiento completo entre empresas.
- Las Edge Functions son endpoints públicos (`--no-verify-jwt`) pero toda escritura requiere que el `telegram_id` o `empresa_id` exista en la base de datos.
- Resend configurado con dominio verificado `clarocomunica.com`.
