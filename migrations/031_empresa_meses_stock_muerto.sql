-- ==============================================================================
-- MIGRACIÓN 031 — Umbral de stock muerto por empresa (AuditorIA)
-- Propósito : hacer configurable por tenant el plazo (en meses) sin salida a
--             partir del cual una pieza se considera "stock muerto" (semáforo
--             amarillo). DEFAULT 6 preserva el comportamiento actual.
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ==============================================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS meses_stock_muerto INTEGER NOT NULL DEFAULT 6;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'empresas_meses_stock_muerto_valido') THEN
    ALTER TABLE public.empresas
      ADD CONSTRAINT empresas_meses_stock_muerto_valido CHECK (meses_stock_muerto >= 1);
  END IF;
END $$;

-- ==============================================================================
-- FIN MIGRACIÓN 031
-- ==============================================================================
