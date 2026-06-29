-- migrations/023_modelos_base_url_openai_compat.sql
-- Sprint 021 (extensión) — Proveedor genérico OpenAI-compatible + base_url por modelo.
--
-- Permite registrar desde /superadmin/modelos cualquier endpoint OpenAI-compatible
-- (Huawei Cloud MaaS / ModelArts Studio, etc.) indicando su URL base y su API key
-- (esta última cifrada, ver 022). El bot reusa el branch OpenAI-compatible y apunta
-- la llamada a base_url en vez de a una URL hardcodeada.
--
-- 1) base_url: URL base del endpoint (ej. 'https://api.modelarts-maas.com/v1'); el bot
--    le agrega '/chat/completions' si no lo trae. Solo se usa para proveedor 'openai-compat'.
-- 2) Se amplía el CHECK de proveedor para aceptar 'openai-compat'.
--
-- Requiere 021 (tabla) y 022 (api_key_enc). Idempotente.

ALTER TABLE public.modelos_nlu
  ADD COLUMN IF NOT EXISTS base_url TEXT;

COMMENT ON COLUMN public.modelos_nlu.base_url IS
  'URL base del endpoint OpenAI-compatible (proveedor openai-compat). El bot le añade /chat/completions si falta. NULL para groq/anthropic/openrouter.';

-- Ampliar el CHECK de proveedor (creado inline en 021 como modelos_nlu_proveedor_check).
ALTER TABLE public.modelos_nlu DROP CONSTRAINT IF EXISTS modelos_nlu_proveedor_check;
ALTER TABLE public.modelos_nlu
  ADD CONSTRAINT modelos_nlu_proveedor_check
  CHECK (proveedor IN ('groq','anthropic','openrouter','openai-compat'));
