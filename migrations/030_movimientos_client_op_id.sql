-- ==============================================================================
-- MIGRACIÓN 030 — Idempotencia del ledger (AuditorIA)
-- Propósito : permitir que AuditorIA registre salidas/recepciones offline sin
--             duplicar movimientos al reintentar la subida.
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- DDL ADITIVA. No altera filas existentes, no toca el trigger tr_actualizar_stock
-- ni la semántica append-only (Constitución IV/V): registrar = INSERT,
-- deshacer = DELETE. Los movimientos históricos (bot) tienen client_op_id NULL;
-- por eso el índice único es PARCIAL (solo aplica cuando client_op_id no es NULL).
-- ==============================================================================

ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS client_op_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS movimientos_client_op_id_uidx
  ON public.movimientos (client_op_id)
  WHERE client_op_id IS NOT NULL;

-- ==============================================================================
-- FIN MIGRACIÓN 030
-- ==============================================================================
