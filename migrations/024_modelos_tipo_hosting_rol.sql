-- migrations/024_modelos_tipo_hosting_rol.sql
-- Fase 1-bis — Catálogo agnóstico de proveedor: tipo de alojamiento + rol del modelo.
--
-- Permite registrar cualquier modelo con API compatible OpenAI (Ollama, vLLM, etc.)
-- sin cambiar código. El tipo_hosting describe dónde corre el modelo; el rol
-- describe para qué tarea se recomienda usarlo (habilitará el router por tarea en Fase 8).
--
-- Idempotente: pegar en el SQL Editor de Supabase → Run.

ALTER TABLE public.modelos_nlu
  ADD COLUMN IF NOT EXISTS tipo_hosting TEXT NOT NULL DEFAULT 'cloud'
    CHECK (tipo_hosting IN ('cloud', 'local', 'self_hosted')),
  ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'conversacion'
    CHECK (rol IN ('clasificacion', 'extraccion', 'conversacion', 'razonamiento', 'embeddings'));

COMMENT ON COLUMN public.modelos_nlu.tipo_hosting IS
  'Dónde corre el modelo: cloud = proveedor SaaS, local = máquina del usuario (Ollama/LM Studio), self_hosted = infra propia del cliente.';

COMMENT ON COLUMN public.modelos_nlu.rol IS
  'Para qué tarea se recomienda este modelo. Habilita el router por tarea (Fase 8): clasificacion, extraccion, conversacion, razonamiento, embeddings.';
