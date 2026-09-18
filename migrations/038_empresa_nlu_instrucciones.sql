-- ==============================================================================
-- MIGRACIÓN 038 — Instrucciones de reconocimiento (NLU/visión) por empresa
-- Propósito : cada empresa (rubro distinto) puede tener sus propias reglas para
--             que el sistema entienda su voz/foto/texto y sus códigos de producto,
--             sin tocar el código. Texto libre que se inyecta al prompt base.
--             NULL → usa el prompt genérico (comportamiento actual).
-- Idempotente: ADD COLUMN IF NOT EXISTS. Aditiva, no toca RLS ni datos.
-- ==============================================================================

ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS nlu_instrucciones text;

-- ==============================================================================
-- FIN MIGRACIÓN 038
-- Verificación:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='empresas' AND column_name='nlu_instrucciones';
-- ==============================================================================
