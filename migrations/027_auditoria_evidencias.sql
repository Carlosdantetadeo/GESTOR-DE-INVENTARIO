-- ==============================================================================
-- MIGRACIÓN 027 — Evidencias fotográficas (AuditorIA)
-- Propósito : foto adjunta a un conteo. El binario vive en Supabase Storage
--             (bucket 'evidencias'); esta fila guarda solo la referencia.
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- RLS se habilita en la migración 029.
--
-- client_op_id: idempotencia de la subida offline (UNIQUE).
-- storage_path: {empresa_id}/{sesion_id}/{conteo_id}/{uuid}.jpg
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.evidencias (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_op_id UUID   NOT NULL UNIQUE,
  empresa_id   UUID   NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conteo_id    BIGINT NOT NULL REFERENCES public.conteos(id) ON DELETE CASCADE,
  storage_path TEXT   NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evidencias_conteo_idx
  ON public.evidencias (conteo_id);

-- ==============================================================================
-- FIN MIGRACIÓN 027
-- ==============================================================================
