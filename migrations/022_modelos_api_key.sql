-- migrations/022_modelos_api_key.sql
-- Sprint 021 (extensión) — API key POR MODELO, cifrada at rest.
--
-- Permite que el superadmin registre un modelo CON su propia API key desde
-- /superadmin/modelos, sin depender de un secret por proveedor en el bot.
-- La key se guarda CIFRADA (AES-GCM, clave maestra MODELOS_ENC_KEY) por la app:
-- la DB nunca ve el texto plano. El bot la descifra en runtime; si un modelo no
-- tiene key propia, cae al secret del proveedor (GROQ/ANTHROPIC/OPENROUTER_API_KEY).
--
-- Requiere que 021 ya haya creado public.modelos_nlu. Idempotente.

ALTER TABLE public.modelos_nlu
  ADD COLUMN IF NOT EXISTS api_key_enc TEXT;

COMMENT ON COLUMN public.modelos_nlu.api_key_enc IS
  'API key del proveedor para este modelo, cifrada AES-GCM (formato v1.<iv_b64>.<ct_b64>). NULL = usar el secret del proveedor en el bot.';
