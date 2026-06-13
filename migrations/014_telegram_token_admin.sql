-- =============================================================================
-- MIGRACIÓN 014 — Token admin para Telegram
-- =============================================================================
-- Agrega empresas.telegram_token_admin: un segundo token de vinculación.
-- Mientras telegram_token registra al operario con rol 'vendedor',
-- telegram_token_admin lo registra con rol 'admin' (mismo flujo /start +
-- selección de sede; el rol se deriva de qué token coincidió).
--
-- Backfill: cada empresa existente recibe un token admin único para que el
-- botón de /admin/usuarios siempre tenga uno que mostrar. gen_random_uuid()
-- viene de pgcrypto, habilitado por defecto en Supabase.
-- =============================================================================

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS telegram_token_admin TEXT UNIQUE;

UPDATE empresas
  SET telegram_token_admin = gen_random_uuid()
  WHERE telegram_token_admin IS NULL;
