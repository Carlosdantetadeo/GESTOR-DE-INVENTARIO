-- migrations/028_nlu_spend_limits.sql
-- Fase 5 — Límites de gasto mensual por empresa.
--
-- El enforcement ocurre ANTES de llamar al proveedor (ver bot checkSpendLimit).
-- accion_al_superar:
--   bloquear   → no llama al proveedor, responde mensaje de fallback
--   degradar   → usa modelo_degradado_id (modelo barato de respaldo)
--   solo_avisar → deja pasar, solo registra
--
-- Idempotente: pegar en el SQL Editor de Supabase → Run.

CREATE TABLE IF NOT EXISTS public.nlu_spend_limits (
  empresa_id          UUID        PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  limite_mensual_usd  NUMERIC(10,2) NOT NULL DEFAULT 10.00,
  accion_al_superar   TEXT        NOT NULL DEFAULT 'solo_avisar'
    CHECK (accion_al_superar IN ('degradar', 'bloquear', 'solo_avisar')),
  modelo_degradado_id TEXT        REFERENCES public.modelos_nlu(id),
  alerta_al_pct       INTEGER     NOT NULL DEFAULT 80,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nlu_spend_limits IS
  'Límites de gasto mensual de IA por empresa. El bot chequea antes de cada llamada al proveedor.';

-- Índice en consumo_ia para que el SUM mensual sea rápido.
-- (La tabla ya existe; el índice puede no existir todavía.)
CREATE INDEX IF NOT EXISTS consumo_ia_empresa_fecha_idx
  ON public.consumo_ia (empresa_id, created_at DESC);
