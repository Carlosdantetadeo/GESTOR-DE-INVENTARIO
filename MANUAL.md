# Manual Técnico Extendido — Agent GMS

> Sistema de inventario por voz para ferreterías. Versión actual: producción activa.
> Última actualización: 2026-06-12
>
> Versión resumida con URLs y credenciales de producción: `MANUAL_TECNICO.md`.
> Manual para usuarios finales: `MANUAL_USUARIO.md`.

---

## Tabla de Contenidos

1. [¿Qué es Agent GMS?](#1-qué-es-agent-gms)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Estructura de directorios](#3-estructura-de-directorios)
4. [Arquitectura y flujo de datos](#4-arquitectura-y-flujo-de-datos)
5. [Base de datos](#5-base-de-datos)
6. [Edge Functions (backend)](#6-edge-functions-backend)
7. [Frontend (Next.js)](#7-frontend-nextjs)
8. [Variables de entorno y secretos](#8-variables-de-entorno-y-secretos)
9. [Despliegue paso a paso](#9-despliegue-paso-a-paso)
10. [Estado actual del proyecto](#10-estado-actual-del-proyecto)
11. [Decisiones de diseño importantes](#11-decisiones-de-diseño-importantes)

---

## 1. ¿Qué es Agent GMS?

Agent GMS es un sistema de gestión de inventario de **fricción cero** diseñado para ferreterías con múltiples sucursales. El operario registra ventas, ingresos, gastos y traslados **enviando un mensaje de voz de ~2 segundos por Telegram**. La IA transcribe, interpreta y guarda el movimiento automáticamente. Si la IA comete un error, el operario pulsa un botón "↩️ Deshacer" directamente en Telegram.

### Casos de uso principales

- Operario en caja dice: *"Venta de 5 tubos PVC media pulgada, tienda norte"* → sistema guarda el movimiento y actualiza el stock sin ninguna acción adicional.
- Operario comete error → pulsa **Deshacer** → stock regresa al estado anterior instantáneamente.
- Admin abre el dashboard web → ve KPIs en tiempo real, historial de movimientos, alertas de stock bajo.

### Tipo de sistema

- **Multi-tenant**: cada empresa (ferretería) tiene sus propios datos completamente aislados.
- **Multi-sede**: una empresa puede tener hasta 20 sucursales (tiendas).
- **Sin fricción de ingreso**: todo por voz, sin formularios manuales.

---

## 2. Stack tecnológico

### Servicios externos (SaaS)

| Servicio | Rol | Plan recomendado |
|----------|-----|------------------|
| **Supabase** | Base de datos PostgreSQL + Auth + Edge Functions + Realtime | Free tier / Pro |
| **Groq** | STT (Whisper), NLU (Llama) y Vision — el cerebro del bot | Free tier |
| **Telegram Bot API** | Canal de comunicación con el operario | Gratuito |
| **Resend** | Envío de emails de bienvenida al registrar empresa | Free tier |
| **Vercel** | Hosting del frontend Next.js | Free tier / Pro |
| **Anthropic (Claude)** | NLU alternativo por empresa (Haiku/Sonnet) | Pay-per-use |

### Frontend

| Herramienta | Versión | Rol |
|-------------|---------|-----|
| **Next.js** | 14.2.3 | Framework React con App Router |
| **React** | 18.3.1 | UI |
| **@supabase/ssr** | 0.10.3 | Cliente Supabase para SSR/cookies |
| **@supabase/supabase-js** | 2.43.4 | SDK Supabase general |
| **Recharts** | 2.12.7 | Gráficos (instalado, pendiente de conectar) |
| **lucide-react** | 0.395.0 | Iconos |
| **xlsx** | 0.18.5 | Exportación a Excel |
| **jspdf + jspdf-autotable** | 2.5.1 / 3.8.2 | Exportación a PDF |

### Backend (Edge Functions — Deno runtime)

| Herramienta | Rol |
|-------------|-----|
| **Deno** | Runtime para Edge Functions en Supabase |
| **@supabase/supabase-js** (ESM) | Acceso a base de datos con service_role_key |
| **Groq API** | Whisper STT + Llama NLU + Vision |
| **Anthropic API** | Claude Haiku/Sonnet como NLU alternativo |
| **Telegram Bot API** | Recepción de webhooks (autenticados por secret) y envío de mensajes |

### Base de datos

| Herramienta | Rol |
|-------------|-----|
| **PostgreSQL** (vía Supabase) | Base de datos principal |
| **Row Level Security (RLS)** | Aislamiento multi-tenant a nivel de BD |
| **Triggers PL/pgSQL** | Actualización automática de stock en INSERT/DELETE |
| **Supabase Realtime** | WebSocket para actualizaciones en tiempo real en el dashboard |

---

## 3. Estructura de directorios

```
AGENT GMS/
│
├── MANUAL.md                          ← Este archivo (manual técnico extendido)
├── MANUAL_TECNICO.md                  ← Manual técnico resumido (producción)
├── MANUAL_USUARIO.md                  ← Manual para usuarios finales
├── CLAUDE.md                          ← Instrucciones para Claude Code
├── PLAN-IMPLEMENTACION.md             ← (Histórico) Plan del MVP original
├── TAREAS.md                          ← (Histórico) Tareas del MVP original
├── GUIA-DESPLIEGUE.md                 ← Guía de despliegue paso a paso
├── GUIA-CREDENCIALES.md               ← Cómo obtener las credenciales
├── CREAR_TABLAS_SUPABASE_FINAL.sql    ← Schema base de la BD
│
├── migrations/                        ← Migraciones SQL en orden
│   ├── 001_multi_empresa.sql          ← Estructura multi-tenant
│   ├── 002_rls_multi_empresa.sql      ← Políticas RLS
│   ├── 003_empresa_telegram_token.sql ← Token para vincular bot
│   ├── 004_nlu_model_consumo.sql      ← Selector de modelo IA + tracking
│   ├── 005_trigger_null_guard.sql     ← Trigger con NULL guards + costo/precio
│   ├── 006_fix_admin_rls.sql          ← (Superseded por 007 — no usar)
│   ├── 007_empresa_id_app_metadata.sql← Fix seguridad: empresa_id en app_metadata
│   ├── 008_productos_unique_por_empresa.sql ← Unicidad (empresa_id, nombre)
│   ├── 009_telegram_updates_dedupe.sql← Dedupe de webhooks de Telegram
│   └── 010_recalcular_stock.sql       ← recalcular_stock() de mantenimiento
│
├── supabase/
│   └── functions/
│       ├── telegram-bot/
│       │   └── index.ts               ← Bot principal (voz/texto/foto → BD)
│       └── onboarding/
│           └── index.ts               ← Registro de nuevas empresas
│
└── frontend/                          ← App Next.js
    ├── .env.local                     ← Variables locales (no en git)
    ├── package.json
    ├── middleware.js                  ← Protección de rutas (Auth)
    │
    ├── app/
    │   ├── layout.js                  ← Layout raíz
    │   ├── globals.css                ← Estilos globales (CSS variables)
    │   ├── page.js                    ← Dashboard principal
    │   ├── login/page.js              ← Login + recuperación de contraseña
    │   ├── registro/page.js           ← Onboarding de nueva empresa
    │   ├── movimientos/page.js        ← Historial de transacciones
    │   ├── inventario/page.js         ← Stock por producto y tienda
    │   ├── reportes/page.js           ← Reportes descargables (Excel/PDF)
    │   └── admin/
    │       ├── config/page.js         ← Modelo IA por empresa + consumo
    │       └── usuarios/page.js       ← Token Telegram + operarios vinculados
    │
    ├── components/
    │   └── Sidebar.js                 ← Navegación lateral (responsive)
    │
    └── lib/
        ├── supabase.js                ← createBrowserClient (sesión en cookies)
        ├── queries.js                 ← Queries SQL vía PostgREST
        ├── realtime.js                ← Hook useRealtimeMovimientos (WebSocket)
        └── export.js                  ← Funciones de exportación XLSX y PDF
```

---

## 4. Arquitectura y flujo de datos

### Recepción del webhook (antes de cualquier handler)

```
Telegram → POST webhook
  │
  ├── 1. Verificación de seguridad (fail-closed):
  │       header X-Telegram-Bot-Api-Secret-Token == TELEGRAM_WEBHOOK_SECRET
  │       Si no coincide (o el secret no está configurado) → 401
  │
  ├── 2. Dedupe: INSERT update_id en telegram_updates (PRIMARY KEY)
  │       Si ya existe → 200 y se descarta (Telegram reintentó el update)
  │
  └── 3. Responde 200 INMEDIATAMENTE y procesa en background
          (EdgeRuntime.waitUntil — STT + NLU pueden tardar >5s y
           Telegram reintenta si no recibe 200 a tiempo)
```

### Flujo principal: registro de movimientos por voz

```
Operario
  │
  │  [Mensaje de voz por Telegram]
  ▼
Supabase Edge Function: telegram-bot
  │
  ├── 1. Descarga el archivo de audio de Telegram
  │
  ├── 2. Groq Whisper (whisper-large-v3-turbo)
  │       → Transcribe el audio a texto en español (<500ms)
  │
  ├── 3. NLU (según empresas.nlu_model):
  │       → Groq Llama-3.3-70b-versatile  [default]
  │       → Claude Haiku 4.5              [mayor precisión]
  │       → Claude Sonnet 4.6             [máxima precisión]
  │       Resultado: JSON con ARRAY de movimientos (un audio puede
  │       contener varios productos)
  │
  ├── 4. Por cada movimiento:
  │       → Si el producto no existe en el catálogo, se crea
  │         automáticamente (categoría "General")
  │       → INSERT INTO movimientos (service_role_key, bypasa RLS)
  │       → Trigger tr_actualizar_stock actualiza la tabla stock
  │
  ├── 5. INSERT INTO consumo_ia
  │       → Registra tokens usados y costo estimado en USD
  │
  └── 6. Telegram sendMessage — confirmación con:
          • Eco de la transcripción: 🎤 "vendí 3 bombas a 5 soles"
          • Una línea por movimiento (tipo, producto, cantidad,
            precio/costo unitario, sede)
          • Total general
          • Un botón "↩️ <producto>" por movimiento
          • Botón "↩️ Deshacer todo" si hay varios (se omite solo si
            los ids no entran en los 64 bytes del callback_data)
```

Los mensajes de **texto** siguen el mismo flujo desde el paso 3. Las **fotos**
(facturas, pizarras, etiquetas) pasan primero por Groq Vision
(`llama-4-scout-17b`), que extrae una descripción de inventario, y luego
siguen el mismo flujo NLU.

### Flujo Deshacer (Undo)

```
Operario pulsa "↩️ <producto>" o "↩️ Deshacer todo"
  │
  ▼
Telegram → callback_query con data: "undo_<id>" o "undo_<id1>,<id2>,..."
  │
  ▼
Edge Function: telegram-bot → handleUndo()
  │
  ├── Verifica que los movimientos pertenecen a la empresa del operario
  │     (vía productos.empresa_id — el service role bypasea RLS, el
  │      chequeo de tenant es explícito)
  │
  ├── DELETE FROM movimientos WHERE id IN (ids)
  │       → Trigger tr_actualizar_stock se dispara con factor = -1
  │       → Stock regresa exactamente al valor anterior
  │
  └── Telegram editMessageText: "↩️ Registro(s) revertido(s)"
```

### Flujo de vinculación de operarios (/start)

```
Operario envía: /start <telegram_token>
  │
  ▼
handleStart()
  ├── Busca la empresa por telegram_token
  ├── Si el telegram_id ya está registrado → lo informa (una cuenta
  │     de Telegram pertenece a una sola empresa)
  └── Muestra botones inline con las sedes (callback join_<token>_<tiendaId>)

Operario toca una sede
  │
  ▼
handleJoin()
  ├── Verifica que la tienda pertenece a la empresa del token
  └── INSERT INTO usuarios (rol 'vendedor', tienda_id, empresa_id)
      → El operario ya puede enviar voz/texto/fotos
```

### Flujo de registro de nueva empresa

```
Admin visita /registro
  │  [Formulario: nombre empresa, email, lista de sedes]
  ▼
POST → Supabase Edge Function: onboarding
  │
  ├── INSERT INTO empresas (genera telegram_token único UUID)
  ├── INSERT INTO tiendas × N (1 fila por sede indicada)
  ├── supabase.auth.admin.createUser
  │       (email_confirm: true,
  │        app_metadata: { empresa_id, rol: 'admin' })
  │       ⚠️ app_metadata, NUNCA user_metadata — ver sección 5 (RLS)
  │
  └── Resend API → email al admin con:
        - Contraseña temporal (también se muestra en pantalla)
        - Lista de sedes creadas
        - Instrucción: /start <telegram_token> en el bot
```

### Flujo de autenticación web

```
Usuario visita cualquier ruta protegida
  │
  ▼
middleware.js (Next.js edge middleware)
  │
  ├── Lee JWT desde cookies (vía @supabase/ssr createServerClient)
  ├── Si no hay sesión → redirect /login?redirect=<ruta original>
  └── Si hay sesión → deja pasar

Login exitoso:
  ├── supabase.auth.signInWithPassword(email, password)
  ├── JWT almacenado en cookies (no localStorage)
  │       → empresa_id viaja en app_metadata del JWT
  └── Redirect al dashboard o a ?redirect=<ruta>
```

### Tiempo real en el dashboard

```
Browser abre Dashboard
  │
  ▼
useRealtimeMovimientos hook (lib/realtime.js)
  │
  ├── supabase.channel('movimientos')
  │     .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'movimientos' })
  │     → RLS del cliente autenticado filtra solo los de su empresa
  │
  └── Al recibir INSERT:
        → Re-fetch fila completa con JOINs (producto, tiendas)
        → Actualiza estado React → UI se actualiza sin recargar
```

---

## 5. Base de datos

### Aplicación del schema

Ejecutar en orden en el **SQL Editor de Supabase**:

1. `CREAR_TABLAS_SUPABASE_FINAL.sql` — schema base
2. `migrations/001_multi_empresa.sql`
3. `migrations/002_rls_multi_empresa.sql`
4. `migrations/003_empresa_telegram_token.sql`
5. `migrations/004_nlu_model_consumo.sql`
6. `migrations/005_trigger_null_guard.sql`
7. `migrations/007_empresa_id_app_metadata.sql` *(la 006 quedó superseded — saltarla)*
8. `migrations/008_productos_unique_por_empresa.sql` *(correr primero el precheck de duplicados comentado al inicio)*
9. `migrations/009_telegram_updates_dedupe.sql`
10. `migrations/010_recalcular_stock.sql`

### Tablas principales

#### `empresas` — raíz multi-tenant
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
nombre           TEXT NOT NULL
telegram_token   TEXT UNIQUE        -- UUID que el operario usa con /start
nlu_model        TEXT DEFAULT 'groq-llama'  -- modelo NLU activo
logo_url         TEXT
color_primario   TEXT
color_secundario TEXT
activa           BOOLEAN DEFAULT true
created_at       TIMESTAMPTZ DEFAULT now()
```

#### `tiendas` — sucursales
```sql
id          BIGINT PRIMARY KEY
nombre      TEXT NOT NULL
empresa_id  UUID REFERENCES empresas(id)
activa      BOOLEAN DEFAULT true
created_at  TIMESTAMPTZ
```

#### `productos` — catálogo
```sql
id                     BIGINT PRIMARY KEY
nombre                 TEXT
categoria_id           BIGINT REFERENCES categorias(id)
empresa_id             UUID REFERENCES empresas(id)
ultimo_costo           NUMERIC
precio_venta_sugerido  NUMERIC
-- Unicidad por empresa (migración 008):
-- UNIQUE INDEX (empresa_id, LOWER(nombre))
```

#### `movimientos` — log append-only (NUNCA se modifica, solo INSERT/DELETE)
```sql
id               BIGINT PRIMARY KEY
tipo             TEXT CHECK (tipo IN ('venta','ingreso','gasto','traslado'))
producto_id      BIGINT REFERENCES productos(id)
tienda_origen_id BIGINT REFERENCES tiendas(id)
tienda_destino_id BIGINT REFERENCES tiendas(id)
cantidad         INTEGER
precio_unitario  NUMERIC
costo_unitario   NUMERIC
total            NUMERIC GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
usuario_id       BIGINT REFERENCES usuarios(id)
transcripcion    TEXT   -- texto original del audio
created_at       TIMESTAMPTZ DEFAULT now()
```

#### `stock` — cantidades actuales (NUNCA se escribe directamente)
```sql
id          BIGINT PRIMARY KEY
producto_id BIGINT REFERENCES productos(id)
tienda_id   BIGINT REFERENCES tiendas(id)
cantidad    INTEGER DEFAULT 0
updated_at  TIMESTAMPTZ
UNIQUE(producto_id, tienda_id)
```

#### `consumo_ia` — tracking de uso de IA por empresa
```sql
id             UUID PRIMARY KEY
empresa_id     UUID REFERENCES empresas(id)
modelo         TEXT   -- 'groq-llama', 'anthropic-haiku', etc.
tipo           TEXT   -- 'nlu', 'vision', 'stt'
tokens_entrada INTEGER
tokens_salida  INTEGER
costo_usd      NUMERIC
created_at     TIMESTAMPTZ
```

#### `telegram_updates` — dedupe de webhooks (migración 009)
```sql
update_id   BIGINT PRIMARY KEY   -- update_id de Telegram
created_at  TIMESTAMPTZ DEFAULT now()
-- Telegram reenvía el mismo update si no recibe 200 a tiempo.
-- El PK convierte el reintento en error 23505 y se descarta sin
-- duplicar movimientos. El bot purga registros de >2 días.
```

### Trigger crítico: `tr_actualizar_stock`

Se dispara `AFTER INSERT OR DELETE` en `movimientos`. Es el único mecanismo que modifica `stock`. Versión vigente: `migrations/005_trigger_null_guard.sql` (NULL guards en tienda; en ingreso también actualiza `ultimo_costo` y `precio_venta_sugerido` del producto).

| Evento | Tipo de movimiento | Efecto en stock |
|--------|-------------------|-----------------|
| INSERT | `venta` | `tienda_origen.cantidad -= cantidad` |
| INSERT | `ingreso` | `tienda_destino.cantidad += cantidad` |
| INSERT | `gasto` | `tienda_origen.cantidad -= cantidad` |
| INSERT | `traslado` | `tienda_origen -= cantidad`, `tienda_destino += cantidad` |
| DELETE | cualquiera | Misma lógica pero × (-1) → revierte el stock |

El factor `-1` en DELETE es lo que implementa el **Undo** sin ningún código adicional.

> ⚠️ **Incidente conocido (2026-06):** producción llegó a correr una variante
> editada a mano del trigger cuyo `ON CONFLICT` usaba
> `cantidad - EXCLUDED.cantidad` para ventas (doble negación → las ventas
> SUMABAN stock). Si el stock vuelve a discrepar del ledger:
> 1. Comparar `pg_proc.prosrc` de `actualizar_stock_trigger` contra `migrations/005`
> 2. Re-aplicar la migración 005
> 3. Ejecutar `SELECT recalcular_stock();` (migración 010) para reconstruir
>    `stock` desde el ledger `movimientos`

### Row Level Security (RLS)

Función central `get_my_empresa_id()` (SECURITY DEFINER, `SET search_path = public`), versión vigente de la migración 007:

```sql
SELECT COALESCE(
  -- Admin: empresa_id viene de app_metadata (solo modificable con service role)
  (auth.jwt()->'app_metadata'->>'empresa_id')::uuid,
  -- Operario Telegram: buscar por telegram_id
  (SELECT empresa_id FROM public.usuarios WHERE telegram_id::text = auth.jwt()->>'sub')
)
```

Todas las tablas tienen política: `empresa_id = get_my_empresa_id()`.

> ⚠️ **Nunca leer `user_metadata` en esta función.** Es editable por el propio
> usuario vía `supabase.auth.updateUser()`, lo que permitía falsificar el
> `empresa_id` y acceder a datos de otra empresa (bug de la migración 006,
> corregido en la 007).

Las Edge Functions usan `SERVICE_ROLE_KEY`, que **bypasea RLS** — por eso todo chequeo de tenant dentro de ellas es explícito (`handleUndo`, `handleJoin`).

---

## 6. Edge Functions (backend)

### `supabase/functions/telegram-bot/index.ts`

Endpoint público (`--no-verify-jwt`), pero **autenticado**: rechaza con 401 cualquier request cuyo header `X-Telegram-Bot-Api-Secret-Token` no coincida con `TELEGRAM_WEBHOOK_SECRET` (fail-closed: sin secret configurado rechaza todo). Responde 200 de inmediato y procesa en background (`EdgeRuntime.waitUntil`), con dedupe por `update_id`.

**Handlers:**

| Tipo de mensaje | Handler | Qué hace |
|----------------|---------|----------|
| `/start <token>` | `handleStart()` | Busca empresa por token → muestra sedes (botones inline) |
| `callback_query` con `join_` | `handleJoin()` | Verifica tienda ∈ empresa del token → INSERT usuario |
| `voice` | `handleVoice()` | Descarga OGG → Groq Whisper → NLU → INSERT movimientos |
| `text` (no comando) | `handleTranscript()` | Texto directo → NLU → INSERT movimientos |
| `photo` | `handlePhoto()` | Imagen → Groq Vision (llama-4-scout) → NLU → INSERT |
| `callback_query` con `undo_` | `handleUndo()` | Verifica tenant → DELETE movimientos → trigger revierte stock |

**Modelos NLU disponibles:**

| Clave en BD | Modelo API | Proveedor | Costo relativo |
|-------------|-----------|-----------|----------------|
| `groq-llama` | `llama-3.3-70b-versatile` | Groq | Gratuito |
| `anthropic-haiku` | `claude-haiku-4-5-20251001` | Anthropic | Bajo |
| `anthropic-sonnet` | `claude-sonnet-4-6` | Anthropic | Medio |

El modelo se lee de `empresas.nlu_model` para cada empresa. El admin lo cambia desde `/admin/config` en el dashboard. Cada llamada queda registrada en `consumo_ia` con tokens y costo.

### `supabase/functions/onboarding/index.ts`

Endpoint público (sin JWT). Llamado desde el formulario `/registro`.

**Acciones en orden:**
1. `INSERT INTO empresas` → genera `telegram_token` (UUID)
2. `INSERT INTO tiendas` × N (una por sede indicada)
3. `supabase.auth.admin.createUser` con `email_confirm: true` y **`app_metadata: { empresa_id, rol: 'admin' }`** (nunca `user_metadata`)
4. Envía email via Resend con contraseña temporal y token de Telegram (la contraseña también se muestra en pantalla por si el email falla)

---

## 7. Frontend (Next.js)

### Páginas y su estado

| Ruta | Archivo | Estado | Descripción |
|------|---------|--------|-------------|
| `/login` | `app/login/page.js` | ✅ Completo | Email + password, recuperación por email |
| `/registro` | `app/registro/page.js` | ✅ Completo | Onboarding: empresa + sedes + email admin |
| `/` | `app/page.js` | ✅ Completo* | Dashboard: KPIs, movimientos recientes, alertas de stock |
| `/movimientos` | `app/movimientos/page.js` | ✅ Completo | Historial filtrable + Deshacer + exportar |
| `/inventario` | `app/inventario/page.js` | ✅ Completo | Matriz stock: productos × tiendas + exportar |
| `/reportes` | `app/reportes/page.js` | ✅ Completo | Reportes de Ventas, Valorización y Transacciones en Excel/PDF |
| `/admin/usuarios` | `app/admin/usuarios/page.js` | ✅ Completo | Token Telegram (con copiado) + operarios vinculados |
| `/admin/config` | `app/admin/config/page.js` | ✅ Completo | Selector modelo NLU + consumo IA |

*El gráfico de ventas del Dashboard es un SVG estático — pendiente de conectar con Recharts.

### Utilidades clave (`lib/`)

**`lib/supabase.js`**
```js
// Crea el cliente browser con sesión en cookies (no localStorage)
// Esto permite que middleware.js lo lea en el servidor
import { createBrowserClient } from '@supabase/ssr'
```

**`lib/queries.js`** — todas las queries. Funciones principales:

| Función | Qué retorna |
|---------|-------------|
| `getEmpresaId()` | UUID de la empresa del usuario autenticado |
| `getTiendas(empresaId)` | Lista de tiendas de la empresa |
| `getDashboardKPIs(empresaId, tiendaId, range)` | `{ ventas, ingresos, gastos, totalMovimientos }` |
| `getMovimientos(empresaId, filters)` | Array de movimientos con JOINs a producto y tiendas |
| `getStock(empresaId, tiendaId)` | Stock actual con nombre de producto y tienda |
| `deleteMovimiento(id)` | Elimina movimiento → trigger revierte stock |

**`lib/realtime.js`** — hook `useRealtimeMovimientos(empresaId, onNew)`
- Suscripción WebSocket a `postgres_changes` en tabla `movimientos`
- RLS filtra automáticamente solo los de la empresa autenticada
- Retorna `isConnected` (boolean para el indicador de estado en el dashboard)

**`lib/export.js`**
- `exportToExcel(...)` — genera `.xlsx` con SheetJS
- `exportToPDF(...)` — genera `.pdf` con jsPDF + autotable

### Middleware de autenticación (`middleware.js`)

Protege todas las rutas excepto `/login` y `/registro`. Usa `createServerClient` de `@supabase/ssr` para leer el JWT desde cookies sin llamadas extra a red. Si no hay sesión válida → redirect a `/login?redirect=<ruta>`.

### Sidebar (`components/Sidebar.js`)

Navegación lateral con 6 secciones: Dashboard, Movimientos, Inventario, Reportes, Usuarios (`/admin/usuarios`) y Configuración (`/admin/config`). Responsive: hamburger menu en mobile. Muestra iniciales del email del usuario y botón de logout.

---

## 8. Variables de entorno y secretos

### Frontend — `frontend/.env.local` (desarrollo local)

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

Las mismas variables se configuran en **Vercel Dashboard → Settings → Environment Variables** para producción.

### Edge Functions — Supabase Secrets

Configurar en **Supabase Dashboard → Edge Functions → Manage secrets** o con CLI:
```bash
supabase secrets set GROQ_API_KEY=...
```

| Secret | Requerido por | Descripción |
|--------|---------------|-------------|
| `GROQ_API_KEY` | `telegram-bot` | Clave Groq (Whisper + Llama + Vision) |
| `TELEGRAM_BOT_TOKEN` | `telegram-bot` | Token del bot de @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | `telegram-bot` | **Obligatorio.** String aleatorio (1-256 chars de `A-Za-z0-9_-`). Debe ser idéntico al `secret_token` registrado en setWebhook. **Fail-closed:** si falta, el bot rechaza todos los mensajes. |
| `ANTHROPIC_API_KEY` | `telegram-bot` | Clave Anthropic (solo si alguna empresa usa NLU `anthropic-*`) |
| `RESEND_API_KEY` | `onboarding` | Clave Resend para emails de bienvenida |
| `RESEND_FROM_EMAIL` | `onboarding` | Remitente verificado, ej: `Agent GMS <no-reply@tudominio.com>` |
| `SUPABASE_URL` | ambos | **Auto-inyectado** por Supabase — no configurar manualmente |
| `SERVICE_ROLE_KEY` | `telegram-bot` | ⚠️ **NO se auto-inyecta con este nombre** — configurarlo manualmente. El código lee `Deno.env.get('SERVICE_ROLE_KEY')`, no `SUPABASE_SERVICE_ROLE_KEY`. |

---

## 9. Despliegue paso a paso

### Paso 1 — Base de datos en Supabase

Ir a **Supabase → SQL Editor** y ejecutar en este orden:
```
1. CREAR_TABLAS_SUPABASE_FINAL.sql
2. migrations/001_multi_empresa.sql
3. migrations/002_rls_multi_empresa.sql
4. migrations/003_empresa_telegram_token.sql
5. migrations/004_nlu_model_consumo.sql
6. migrations/005_trigger_null_guard.sql
7. migrations/007_empresa_id_app_metadata.sql   (saltar la 006)
8. migrations/008_productos_unique_por_empresa.sql  (correr el precheck primero)
9. migrations/009_telegram_updates_dedupe.sql
10. migrations/010_recalcular_stock.sql
```

### Paso 2 — Configurar secretos en Supabase

```bash
supabase secrets set GROQ_API_KEY=gsk_...
supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC...
supabase secrets set TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
supabase secrets set SERVICE_ROLE_KEY=eyJ...   # Settings → API → service_role
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set RESEND_FROM_EMAIL="Agent GMS <no-reply@tudominio.com>"
# Anthropic es opcional (solo para NLU anthropic-*):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

> Guardar el valor de `TELEGRAM_WEBHOOK_SECRET`: se necesita de nuevo en el paso 4.

### Paso 3 — Desplegar Edge Functions

Desde la raíz del repositorio (requiere Supabase CLI instalado y `supabase login`):
```bash
supabase functions deploy telegram-bot --no-verify-jwt
supabase functions deploy onboarding   --no-verify-jwt
```

### Paso 4 — Registrar webhook de Telegram

El `secret_token` **debe ser el mismo** valor que el secreto `TELEGRAM_WEBHOOK_SECRET` del paso 2:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<project-ref>.supabase.co/functions/v1/telegram-bot","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'
```

Verificar que quedó registrado:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

### Paso 5 — Desplegar frontend en Vercel

```bash
cd frontend
npx vercel --prod
```

O conectar el repositorio en **Vercel Dashboard → Import Project** y configurar:
- **Root Directory:** `frontend`
- **Environment Variables:** `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Paso 6 — Prueba de humo

1. Abrir el dashboard web → debe cargar sin errores
2. Ir a `/registro` → registrar una empresa de prueba → verificar que llega el email
3. Ir a `/login` → entrar con las credenciales del email
4. En Telegram, enviar al bot `/start <token>` y elegir una sede
5. Enviar al bot: **"Venta de 3 codos PVC a 5 soles"**
6. Verificar que el bot responde con la transcripción (🎤), confirmación y botones Deshacer
7. Verificar que aparece en el dashboard en tiempo real
8. Pulsar Deshacer → verificar que el stock se revierte

> Si el bot no responde nada en el paso 5, revisar que `TELEGRAM_WEBHOOK_SECRET`
> esté configurado y coincida con el `secret_token` del webhook (fail-closed).

---

## 10. Estado actual del proyecto

### Componentes 100% implementados

| Componente | Notas |
|-----------|-------|
| Autenticación (login/logout/middleware) | Supabase Auth + JWT en cookies |
| Onboarding de empresa | Email verificado, sedes, token Telegram |
| Vinculación de operarios (`/start <token>`) | Selección de sede por botones |
| Bot Telegram — voz | Groq Whisper + NLU → INSERT |
| Bot Telegram — texto | Texto directo → NLU → INSERT |
| Bot Telegram — imagen | Groq Vision → NLU → INSERT |
| Multi-producto por mensaje | Un audio puede generar varios movimientos |
| Auto-creación de productos | Categoría "General", unicidad por empresa |
| Undo / Deshacer | Individual por producto + "Deshacer todo" |
| Seguridad del webhook | Secret token fail-closed + dedupe de updates |
| Dashboard con KPIs | Datos reales + tiempo real vía WebSocket |
| Alertas de stock bajo | Productos con menos de 5 unidades |
| Vista de inventario | Matriz productos × tiendas con filtros |
| Historial de movimientos | Filtros + búsqueda + exportar + Undo por fila |
| Exportación Excel/PDF | Movimientos, inventario y reportes |
| Página `/reportes` | Ventas, Valorización y Transacciones descargables |
| Página `/admin/usuarios` | Token Telegram + operarios vinculados |
| Selector de modelo NLU | Por empresa, desde `/admin/config` |
| Tracking de consumo IA | Tabla `consumo_ia` por empresa |
| Multi-tenant RLS | Aislamiento vía `app_metadata` (migración 007) |
| Mantenimiento de stock | `recalcular_stock()` reconstruye desde el ledger |

### Componentes pendientes / parciales

| Componente | Estado | Esfuerzo estimado |
|-----------|--------|-------------------|
| Gráfico de ventas (Dashboard) | SVG estático — Recharts ya instalado, falta conectar datos | 2-4 horas |
| Edición de productos desde el dashboard | No implementada (nombre, categoría, precios) | 3-5 horas |
| Rate limiting / captcha en `/registro` | La Edge Function `onboarding` no tiene protección anti-abuso | 2-4 horas |

---

## 11. Decisiones de diseño importantes

### ¿Por qué Auto-Commit + Undo en vez de confirmación previa?

Confirmar antes de guardar añade 1 interacción extra en cada registro. En un mostrador de ferretería con cola de clientes, eso es inaceptable. La solución adoptada es **optimismo operativo**: guardar inmediatamente y ofrecer un Undo de 1 clic. El 95%+ de los casos la IA acierta y el operario no hace nada extra. Además, la confirmación hace eco de la transcripción (🎤) para que el operario detecte de un vistazo si el bot escuchó mal.

### ¿Por qué el trigger DELETE con factor -1 para el Undo?

El Undo podría implementarse como un segundo INSERT con cantidades negativas, o como un UPDATE directo a `stock`. Elegimos DELETE sobre `movimientos` porque:
1. Mantiene el log de movimientos limpio (sin entradas "reversales" artificiales)
2. La lógica del trigger ya existía para INSERT — extenderla a DELETE es trivial
3. El Undo es atómico: si falla el DELETE, el stock no cambia

### ¿Por qué responder 200 inmediato y procesar en background?

Telegram reintenta el webhook si no recibe 200 en pocos segundos. STT + NLU pueden tardar más que eso, y cada reintento duplicaba movimientos. La solución tiene dos partes: responder 200 al instante y procesar con `EdgeRuntime.waitUntil`, más una tabla `telegram_updates` con PK en `update_id` que convierte cualquier reintento en un no-op.

### ¿Por qué empresa_id en app_metadata y no en user_metadata?

`user_metadata` es editable por el propio usuario vía `supabase.auth.updateUser()`: leerla en RLS permitía falsificar el `empresa_id` y acceder a datos de otra empresa. `app_metadata` solo puede modificarse con service role, por eso es la única fuente confiable para tenant isolation (migración 007).

### ¿Por qué Supabase Edge Functions en vez de n8n/Railway?

El sistema original usaba n8n. Se migró a Edge Functions porque:
1. **Cero dependencias externas** — todo vive en Supabase
2. **Cold start mínimo** — las funciones Deno de Supabase arrancan en ~200ms
3. **Secretos centralizados** — un solo lugar para credenciales
4. **Sin costo adicional** — incluido en el plan de Supabase

### ¿Por qué RLS en vez de filtros en la aplicación?

Filtrar por `empresa_id` en el código de la aplicación es frágil — un bug puede exponer datos de otra empresa. RLS garantiza el aislamiento **a nivel de base de datos**: aunque el código tenga un bug, la BD rechaza la consulta.

### ¿Por qué JWT en cookies y no en localStorage?

El middleware de Next.js corre en el servidor (Edge runtime) y no puede leer localStorage. Las cookies sí están disponibles en el servidor, lo que permite verificar la sesión antes de servir cualquier página protegida, sin roundtrip adicional.

### ¿Por qué Groq para STT y no Whisper propio?

Groq ofrece Whisper como API con latencia <500ms usando su hardware ASIC. Correr Whisper propio requiere GPU y añade complejidad operativa. Para el volumen de una ferretería, el costo en Groq es prácticamente cero.

---

*Última revisión: 2026-06-12. Para cambios en la arquitectura, actualizar también `CLAUDE.md` y `MANUAL_TECNICO.md`.*
