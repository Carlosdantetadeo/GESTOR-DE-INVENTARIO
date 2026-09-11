-- migrations/027_nlu_model_pricing.sql
-- Fase 4 — Historial de precios de modelos NLU.
--
-- costo_in / costo_out en modelos_nlu se mantienen como cache del precio vigente.
-- Cada cambio de precio genera una fila nueva en nlu_model_pricing (no se sobrescribe).
-- El precio vigente es el registro con vigente_desde más reciente <= now().
--
-- Idempotente: pegar en el SQL Editor de Supabase → Run.

CREATE TABLE IF NOT EXISTS public.nlu_model_pricing (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id           TEXT          NOT NULL REFERENCES public.modelos_nlu(id) ON DELETE CASCADE,
  costo_in_por_token  NUMERIC(20,12) NOT NULL,
  costo_out_por_token NUMERIC(20,12) NOT NULL,
  vigente_desde       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  fuente              TEXT,          -- URL o nota de dónde salió el precio
  created_by          UUID
);

CREATE INDEX IF NOT EXISTS nlu_model_pricing_modelo_fecha_idx
  ON public.nlu_model_pricing (modelo_id, vigente_desde DESC);

COMMENT ON TABLE public.nlu_model_pricing IS
  'Historial de precios de modelos NLU. El precio vigente es el row con vigente_desde más reciente <= now().';

-- Migrar precios actuales. vigente_desde = 91 días atrás para que aparezca la
-- alerta "Precio sin verificar" e invite al admin a confirmar el valor.
INSERT INTO public.nlu_model_pricing
  (modelo_id, costo_in_por_token, costo_out_por_token, vigente_desde, fuente)
SELECT
  id,
  costo_in,
  costo_out,
  now() - interval '91 days',
  'migración inicial — verificar precio actual del proveedor'
FROM public.modelos_nlu
WHERE (costo_in > 0 OR costo_out > 0)
ON CONFLICT DO NOTHING;
