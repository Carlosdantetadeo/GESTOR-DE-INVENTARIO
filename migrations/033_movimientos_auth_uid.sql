-- ==============================================================================
-- MIGRACIÓN 033 — Autor web en el ledger (Almacenero Digital)
-- Propósito : registrar QUIÉN hizo cada movimiento desde la web (auth.uid()),
--             para poder reportar ventas/ingresos por usuario. movimientos.usuario_id
--             apunta a la tabla de Telegram (BIGINT) y queda NULL para la web; por eso
--             se agrega auth_uid (UUID) en paralelo. Aditiva, no toca el trigger.
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- ==============================================================================

ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS auth_uid UUID;

CREATE INDEX IF NOT EXISTS movimientos_auth_uid_idx
  ON public.movimientos (auth_uid)
  WHERE auth_uid IS NOT NULL;

-- ==============================================================================
-- FIN MIGRACIÓN 033
-- ==============================================================================
