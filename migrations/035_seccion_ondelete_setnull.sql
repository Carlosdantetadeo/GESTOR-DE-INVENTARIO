-- ==============================================================================
-- MIGRACIÓN 035 — Borrado seguro de secciones
-- Propósito : permitir borrar una sección sin romper el historial. Al borrarla,
--             los movimientos que la referenciaban quedan con seccion_id = NULL
--             (la sección es solo ubicación; el movimiento y el stock se conservan).
-- Idempotente: DROP CONSTRAINT IF EXISTS antes de recrearla.
-- ==============================================================================

ALTER TABLE public.movimientos DROP CONSTRAINT IF EXISTS movimientos_seccion_id_fkey;
ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_seccion_id_fkey
  FOREIGN KEY (seccion_id) REFERENCES public.secciones(id) ON DELETE SET NULL;

-- ==============================================================================
-- FIN MIGRACIÓN 035
-- Verificación:
--   SELECT confdeltype FROM pg_constraint WHERE conname = 'movimientos_seccion_id_fkey';
--   -- 'n' = SET NULL (correcto)
-- ==============================================================================
