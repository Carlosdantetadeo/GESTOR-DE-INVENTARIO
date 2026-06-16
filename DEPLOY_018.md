# Deploy 018 a producción — runbook

Secuencia exacta para desplegar el sprint 018 (UX unificada del bot) a producción.
**Un paso por vez, en orden. No saltar ninguno.**

> El orden importa: la migración va **ANTES** del deploy de la función. El código
> 018 consulta `movimiento_pendiente`; si se deploya antes de crear la tabla, el
> bot se rompe para cualquier mensaje en esa ventana.

## Pre-requisitos (antes de empezar)

- [ ] Pasaste los **21 escenarios** en Telegram staging (ver PR / `agent-gms.txt`).
- [ ] El PR #1 está revisado y aprobado.
- [ ] El Supabase CLI apunta al proyecto de **producción**. Verificar:
  ```bash
  supabase projects list
  ```
  La fila con `●` es la linkeada. Si no es prod, linkear:
  ```bash
  supabase link --project-ref <PROD_PROJECT_REF>
  ```

---

## Pasos

### 1. Mergear el PR a `main`
```bash
gh pr merge 1 --squash --delete-branch
```

### 2. Pararte en `main`
```bash
git checkout main
```

### 3. Traer el `main` ya mergeado
```bash
git pull origin main
```

### 4. Aplicar la migración 018 en producción — ⚠️ PASO MANUAL
**No es un comando de terminal.** Este repo aplica migraciones por el **Supabase
SQL Editor** (no por `supabase db push`: las migraciones viven en `migrations/`,
fuera del flujo del CLI).

1. Abrir el SQL Editor del proyecto de **producción**.
2. Pegar el contenido completo de `migrations/018_ux_unificada.sql`.
3. Ejecutar y confirmar que termina sin errores.

Verificación rápida (correr en el SQL Editor):
```sql
SELECT to_regclass('public.movimiento_pendiente');   -- debe existir
SELECT to_regclass('public.auditoria_reversiones');  -- debe existir
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'usuarios' AND column_name = 'modo_admin';  -- 1 fila
```

### 5. Verificar los secrets de la función
018 **no** agrega secrets obligatorios (`DASHBOARD_BASE_URL` y `JWT_SECRET` son
opcionales: el deep-link queda dormido si faltan). Confirmar que no falte ninguno
de los existentes (`SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`):
```bash
supabase secrets list
```

### 6. Deployar la Edge Function
```bash
supabase functions deploy telegram-bot --no-verify-jwt
```

> **No** hace falta re-registrar el webhook: la URL no cambia.

---

## Validación post-deploy (obligatoria)

Probar con un operario real, en producción, antes de cerrar:

- [ ] Un registro por **voz** (tarjeta → tap `[✅ Confirmar]`; no auto-confirma).
- [ ] Un registro por **texto**.
- [ ] Un registro por **foto** (pregunta Compra/Venta → tarjeta → Confirmar).
- [ ] Un **Deshacer** dentro de los 5 min.

---

## Si algo falla → ROLLBACK

Ejecutar los **2 pasos juntos** (el SQL solo deja el bot roto):

**Paso 1 — Revertir el esquema** (Supabase SQL Editor): ejecutar
`migrations/018_ux_unificada_rollback.sql` (transaccional e idempotente).

**Paso 2 — Redeploy del bot previo (016)**:
```bash
git checkout main   # con el código previo a 018, si ya se mergeó habrá que usar el commit anterior
supabase functions deploy telegram-bot --no-verify-jwt
```

> Si 018 ya está en `main`, para el redeploy previo usar el commit anterior al
> merge: `git checkout <sha_pre_018> -- supabase/functions/telegram-bot` y deployar,
> o revertir el merge. Ver el header de `018_ux_unificada_rollback.sql` para las
> pérdidas de datos inherentes.
