# Guía de Despliegue — Agent GMS

> Última actualización: 2026-06-12
>
> ⚠️ Las versiones anteriores de esta guía describían un despliegue basado en
> **n8n**, que ya no existe en el proyecto, e incluían una copia inline del
> trigger de stock con un bug de doble negación (las ventas sumaban stock).
> **Nunca copiar SQL de documentos**: la única fuente de verdad del schema son
> `CREAR_TABLAS_SUPABASE_FINAL.sql` y los archivos de `migrations/`.

El sistema corre completamente en **Supabase** (base de datos + Edge Functions) y **Vercel** (frontend). No hay orquestadores externos.

---

## Paso 1 — Base de datos en Supabase

Ir a **Supabase → SQL Editor** y ejecutar **los archivos del repositorio** en este orden:

```
1. CREAR_TABLAS_SUPABASE_FINAL.sql
2. migrations/001_multi_empresa.sql
3. migrations/002_rls_multi_empresa.sql
4. migrations/003_empresa_telegram_token.sql
5. migrations/004_nlu_model_consumo.sql
6. migrations/005_trigger_null_guard.sql
7. migrations/007_empresa_id_app_metadata.sql    ← saltar la 006 (superseded, insegura)
8. migrations/008_productos_unique_por_empresa.sql  ← correr primero el precheck comentado al inicio
9. migrations/009_telegram_updates_dedupe.sql
10. migrations/010_recalcular_stock.sql
```

## Paso 2 — Secretos de las Edge Functions

Con la Supabase CLI (`supabase login` previo) o desde Dashboard → Edge Functions → Manage secrets:

```bash
supabase secrets set GROQ_API_KEY=gsk_...
supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC...
supabase secrets set TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
supabase secrets set SERVICE_ROLE_KEY=eyJ...    # Dashboard → Settings → API → service_role
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set RESEND_FROM_EMAIL="Agent GMS <no-reply@tudominio.com>"
# Solo si alguna empresa usará NLU de Anthropic:
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Notas importantes:

- `TELEGRAM_WEBHOOK_SECRET` es **obligatorio** (el bot es fail-closed: sin secret rechaza todo). Guardar el valor — se vuelve a usar en el paso 4.
- `SERVICE_ROLE_KEY` **no** se auto-inyecta con ese nombre — hay que setearlo a mano. `SUPABASE_URL` sí es automático.
- Cómo obtener cada credencial: ver `GUIA-CREDENCIALES.md`.

## Paso 3 — Desplegar las Edge Functions

Desde la raíz del repositorio:

```bash
supabase functions deploy telegram-bot --no-verify-jwt
supabase functions deploy onboarding   --no-verify-jwt
```

## Paso 4 — Registrar el webhook de Telegram

El `secret_token` debe ser **idéntico** al `TELEGRAM_WEBHOOK_SECRET` del paso 2:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<project-ref>.supabase.co/functions/v1/telegram-bot","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'
```

Verificar:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## Paso 5 — Frontend en Vercel

```bash
cd frontend
npx vercel --prod
```

O conectar el repo en **Vercel Dashboard → Import Project**:

- **Root Directory:** `frontend`
- **Environment Variables:** `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Después, en **Supabase → Authentication → URL Configuration**, configurar Site URL y Redirect URLs con el dominio de Vercel.

## Paso 6 — Prueba de humo

1. Abrir el dashboard web → debe cargar sin errores.
2. `/registro` → crear una empresa de prueba → verificar que llega el email (y que la contraseña temporal se muestra en pantalla).
3. `/login` → entrar con esas credenciales.
4. En Telegram: `/start <token>` → elegir sede.
5. Enviar: *"Venta de 3 codos PVC a 5 soles"* → el bot debe responder con la transcripción (🎤), el resumen y botones **Deshacer**.
6. Verificar el movimiento en el dashboard (tiempo real) y que `stock` bajó.
7. Pulsar **Deshacer** → verificar que el movimiento desaparece y el stock se restaura.

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El bot no responde nada | `TELEGRAM_WEBHOOK_SECRET` no configurado o distinto del `secret_token` del webhook (fail-closed) | Re-setear el secret y re-registrar el webhook con el mismo valor |
| El bot responde error interno | `SERVICE_ROLE_KEY` no seteado como secret | Setearlo manualmente (paso 2) |
| Movimientos duplicados | Falta la migración 009 (dedupe) | Aplicar `009_telegram_updates_dedupe.sql` |
| El stock no cuadra con los movimientos | Trigger alterado a mano en producción | Comparar `pg_proc.prosrc` de `actualizar_stock_trigger` contra `migrations/005`, re-aplicar la 005 y ejecutar `SELECT recalcular_stock();` |
| Un admin ve datos de otra empresa | RLS leyendo `user_metadata` (migración 006 vieja) | Aplicar `007_empresa_id_app_metadata.sql` de inmediato |
