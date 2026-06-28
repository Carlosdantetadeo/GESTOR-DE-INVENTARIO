# AGENT GMS — Sprint 021: Suspensión de empresas + Catálogo dinámico de modelos NLU

## Contexto

Continúa sobre la rama del sprint 020 (`feat/020-dashboard-cliente-superadmin`, ya en preview).
Dos features nuevas, ambas viven en el **panel superadmin** (`/superadmin`) y **requieren tocar el bot de Telegram** (Edge Function `telegram-bot`), cosa que el sprint 020 no hacía.

**Antes de tocar código:**
1. Rama nueva: `feat/021-suspension-modelos` (a partir de `feat/020-...`).
2. Un commit por paso.
3. No deployar el bot ni el frontend a producción sin confirmación explícita.

**Lo que NO se toca:**
- Tablas `movimientos`, `stock`, triggers.
- El flujo de onboarding / registro.
- El dashboard cliente y el catálogo de productos (sprint 020).

---

## FEATURE A — Suspensión reversible de empresas

Decisión tomada: **suspensión reversible** (no borrado). Al suspender, la empresa queda bloqueada
para login de clientes Y para el bot; se puede reactivar cuando se quiera. No se borran datos.

### A.0 — Base de datos
- La columna `empresas.activa BOOLEAN DEFAULT true` **ya existe** (migración 001). No hace falta crearla.
- (Opcional, auditoría) En `migrations/021_*.sql` agregar:
  ```sql
  ALTER TABLE public.empresas
    ADD COLUMN IF NOT EXISTS suspendida_at TIMESTAMPTZ;
  ```

### A.1 — Backend (frontend, service role)
- `lib/superadmin/data.js`: nueva función
  ```js
  export async function setEmpresaActiva(empresaId, activa) {
    const supa = getAdminClient()
    const patch = { activa, suspendida_at: activa ? null : new Date().toISOString() }
    const { error } = await supa.from('empresas').update(patch).eq('id', empresaId)
    return error ? { ok:false, message:error.message } : { ok:true }
  }
  ```
- `app/api/superadmin/empresa/[id]/route.js` (PATCH): aceptar además del `modelo` actual un body
  `{ activa: boolean }`. Verificar la cookie superadmin (ya lo hace), validar tipo y llamar a `setEmpresaActiva`.

### A.2 — UI superadmin
- `app/superadmin/empresa/[id]/page.js`: nueva sección "Estado de la empresa" con un client component
  `EstadoEmpresa.js` (patrón calcado de `ModeloSelector.js`):
  - Si está activa → botón rojo "Suspender empresa" + modal de confirmación
    ("La empresa no podrá iniciar sesión ni registrar por el bot hasta reactivarla. ¿Confirmás?").
  - Si está suspendida → banner ámbar "⛔ Empresa suspendida" + botón "Reactivar empresa".
  - Tras togglear, refrescar (`router.refresh()`).
- `app/superadmin/page.js` (lista): mostrar un badge de estado (🟢 Activa / ⛔ Suspendida) por fila.
  Agregar `activa` al `select` de `getEmpresasResumen`.

### A.3 — Enforcement (lo que hace que la baja sirva)

**Login de clientes** — `app/login/page.js`, dentro de `handleLogin`, después de obtener `empresaId`:
```js
const { data: emp } = await supabase.from('empresas').select('activa').eq('id', empresaId).single()
if (emp && emp.activa === false) {
  setError('Tu empresa está suspendida. Contactá al proveedor.')
  await supabase.auth.signOut(); setLoading(false); return
}
```
(RLS permite leer la propia empresa.) **Limitación conocida:** una sesión ya iniciada sigue viva hasta
re-login. Hardening opcional: repetir el chequeo en un server component del layout del dashboard.

**Bot de Telegram** — `supabase/functions/telegram-bot/index.ts`:
- En los dos lookups de usuario (≈línea 639 y ≈1320) agregar `activa` al join:
  `.select('... empresas(nlu_model, rubro, activa)')`.
- Antes de procesar, si `empresa.activa === false`: enviar `sendMessage`
  "⛔ Tu empresa está suspendida. Contactá al proveedor." y `return` sin procesar.
- Centralizar en un helper `empresaSuspendida(usuario)` para no duplicar.
- **Requiere redeploy del bot.**

---

## FEATURE B — Catálogo dinámico de modelos NLU (con OpenRouter)

Decisión tomada: **catálogo gestionable desde el panel**. Hoy los modelos están hardcodeados en
`index.ts` (bot) y `data.js` (frontend). Se mueven a una tabla y el superadmin los administra.

### B.0 — Migración `migrations/021_catalogo_modelos_nlu.sql`
```sql
CREATE TABLE IF NOT EXISTS public.modelos_nlu (
  id            TEXT PRIMARY KEY,                 -- clave estable, ej 'openrouter-deepseek'
  label         TEXT NOT NULL,                    -- 'DeepSeek V3 (OpenRouter)'
  proveedor     TEXT NOT NULL CHECK (proveedor IN ('groq','anthropic','openrouter')),
  api_model_id  TEXT NOT NULL,                    -- id real para la API del proveedor
  costo_in      NUMERIC(14,12) NOT NULL DEFAULT 0,-- USD por token de entrada
  costo_out     NUMERIC(14,12) NOT NULL DEFAULT 0,-- USD por token de salida
  badge         TEXT,                             -- 'Recomendado' | 'Balanceado' | 'Premium' | null
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.modelos_nlu ENABLE ROW LEVEL SECURITY;
-- Sin políticas para anon/authenticated: solo service role (bot + superadmin) lo lee/escribe.

-- Seed de los 3 modelos actuales (mantiene resolviendo los empresas.nlu_model existentes)
INSERT INTO public.modelos_nlu (id, label, proveedor, api_model_id, costo_in, costo_out, badge) VALUES
  ('groq-llama',      'Groq Llama 3.3', 'groq',      'llama-3.3-70b-versatile',    0.00000059, 0.00000079, 'Recomendado'),
  ('anthropic-haiku', 'Claude Haiku',   'anthropic', 'claude-haiku-4-5-20251001',  0.0000008,  0.000004,   'Balanceado'),
  ('anthropic-sonnet','Claude Sonnet',  'anthropic', 'claude-sonnet-4-6',          0.000003,   0.000015,   'Premium')
ON CONFLICT (id) DO NOTHING;
```
- (Opcional, integridad) tras el seed, `ALTER TABLE empresas ADD CONSTRAINT fk_nlu_model
  FOREIGN KEY (nlu_model) REFERENCES modelos_nlu(id) ON UPDATE CASCADE;`
  Correr antes el precheck: que no haya `nlu_model` fuera del catálogo.

### B.1 — Frontend
- `lib/superadmin/data.js`:
  - Reemplazar el `const MODELOS_NLU` por `getModelosNlu({ soloActivos } = {})` que lee de `modelos_nlu`.
  - `modeloLabel(id, catalogo)` resuelve contra el catálogo recibido (las páginas son server components async, le pasan el catálogo ya cargado).
  - `updateEmpresaModelo`: validar contra el catálogo de la DB, no contra la constante.
  - Nuevas: `crearModelo`, `actualizarModelo`, `toggleModeloActivo`, `eliminarModelo`.
- Nueva ruta `/superadmin/modelos` (ABM):
  - Tabla de modelos (label, proveedor, api_model_id, costos, activo).
  - Form de alta: id (slug), label, proveedor (select groq/anthropic/openrouter), api_model_id,
    costo_in, costo_out, badge. Para OpenRouter el `api_model_id` es cualquier id de su catálogo
    (ej. `deepseek/deepseek-chat`, `google/gemini-2.0-flash-001`).
  - Editar inline, toggle activo, eliminar con confirmación (bloquear borrado si alguna empresa lo usa).
- Nueva API `app/api/superadmin/modelos/route.js` (+ `[id]` para PATCH/DELETE), todas verificando la cookie superadmin.
- `app/superadmin/layout.js`: agregar "Modelos" al sidebar.
- `ModeloSelector` (empresa detalle): listar solo modelos `activo = true` del catálogo.

### B.2 — Bot (`telegram-bot/index.ts`)
- Borrar los mapas hardcodeados `GROQ_MODEL_IDS` / `ANTHROPIC_MODEL_IDS` / `TOKEN_COSTS`.
- Resolver el modelo en runtime: con `empresas.nlu_model` (id) hacer
  `select * from modelos_nlu where id = ? and activo = true`. Obtener `proveedor`, `api_model_id`, `costo_in`, `costo_out`.
- `callNLU` despacha por `proveedor`:
  - `groq` → `https://api.groq.com/openai/v1/chat/completions` (igual que hoy).
  - `openrouter` → `https://openrouter.ai/api/v1/chat/completions`, header `Authorization: Bearer ${OPENROUTER_API_KEY}`,
    body OpenAI-compatible (`response_format: { type:'json_object' }`). Recomendado mandar headers
    `HTTP-Referer` y `X-Title`. Parseo de respuesta y `usage` = igual que Groq (formato OpenAI).
  - `anthropic` → `https://api.anthropic.com/v1/messages` (igual que hoy).
- Costo: usar `costo_in`/`costo_out` del row para `consumo_ia`.
- **Fallback de resiliencia:** si el id no está en el catálogo o la tabla falla, usar un default
  hardcodeado mínimo (`groq-llama` → `llama-3.3-70b-versatile`) para que el bot nunca se rompa.
- Nuevo secret Supabase: `OPENROUTER_API_KEY`.

---

## Variables de entorno nuevas

| Dónde | Variable | Para qué |
|-------|----------|----------|
| Supabase secret | `OPENROUTER_API_KEY` | `telegram-bot` — llamadas NLU vía OpenRouter |

(El frontend no necesita env nuevas; lee el catálogo con `SERVICE_ROLE_KEY` ya configurada.)

---

## Plan de pruebas (escenarios)

**Suspensión**
1. Panel: empresa activa → "Suspender" → modal → confirmar → estado pasa a ⛔ Suspendida.
2. Login de cliente de esa empresa → "Tu empresa está suspendida", no entra.
3. Bot: operario de esa empresa manda un mensaje → "⛔ Tu empresa está suspendida", no registra.
4. Panel: "Reactivar" → estado 🟢 Activa → cliente vuelve a entrar y el bot vuelve a registrar.
5. Lista de empresas muestra el badge de estado correcto.

**Catálogo de modelos**
6. `/superadmin/modelos` lista los 3 modelos seed.
7. Alta de un modelo OpenRouter (ej. `openrouter-deepseek` → `deepseek/deepseek-chat`) → aparece en la tabla.
8. En una empresa, el selector de modelo muestra el nuevo modelo OpenRouter (activo).
9. Asignar el modelo OpenRouter a una empresa → guardar → `empresas.nlu_model` cambia en Supabase.
10. Bot de esa empresa procesa un mensaje vía OpenRouter correctamente; `consumo_ia` registra el costo con `costo_in/out` del catálogo.
11. Togglear `activo=false` en un modelo → desaparece del selector de empresas (pero las que ya lo tenían siguen).
12. Intentar eliminar un modelo en uso → bloqueado con mensaje.
13. Borrar la tabla/catálogo o id inválido → el bot usa el fallback `groq-llama` y no se cae.

---

## Orden de implementación sugerido

1. Migración 021 (tabla `modelos_nlu` + seed + opcional `suspendida_at`).
2. Frontend: `data.js` lee catálogo de DB + `updateEmpresaModelo` valida contra DB.
3. Panel: ABM `/superadmin/modelos` + API + sidebar.
4. Panel: `EstadoEmpresa.js` (suspender/reactivar) + API PATCH `activa` + badge en lista.
5. Login cliente: chequeo `activa`.
6. Bot: resolución de modelo desde DB + branch OpenRouter + enforcement de suspensión + fallback.
7. Deploy: `supabase functions deploy telegram-bot --no-verify-jwt`, set `OPENROUTER_API_KEY`,
   redeploy frontend.

## Cuando termines
PR a `main` con el checklist de los 13 escenarios. No mergear sin confirmación humana.
Actualizar `CLAUDE.md` (tabla de migraciones + feature log + sección de modelos NLU).
