-- migrations/025_modelos_ultima_prueba.sql
-- Fase 2 — Probar conexión: registra cuándo se probó el modelo y con qué latencia.
-- Idempotente: pegar en el SQL Editor de Supabase → Run.

ALTER TABLE public.modelos_nlu
  ADD COLUMN IF NOT EXISTS ultima_prueba_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultima_prueba_latencia_ms INTEGER;

COMMENT ON COLUMN public.modelos_nlu.ultima_prueba_at IS
  'Timestamp de la última prueba de conexión exitosa desde /api/superadmin/modelos/test.';
COMMENT ON COLUMN public.modelos_nlu.ultima_prueba_latencia_ms IS
  'Latencia en ms de la última prueba de conexión exitosa.';
