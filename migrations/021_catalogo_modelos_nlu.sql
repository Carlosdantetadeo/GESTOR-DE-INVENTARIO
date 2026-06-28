-- migrations/021_catalogo_modelos_nlu.sql
-- Sprint 021 — Catálogo dinámico de modelos NLU + auditoría de suspensión.
--
-- 1) `modelos_nlu`: mueve los modelos NLU (antes hardcodeados en el bot index.ts y
--    en lib/superadmin/data.js) a una tabla que el superadmin administra desde
--    /superadmin/modelos. Soporta proveedores groq / anthropic / openrouter.
--    El bot resuelve `empresas.nlu_model` (id) contra esta tabla en runtime.
-- 2) `empresas.suspendida_at`: timestamp de auditoría para la suspensión reversible
--    (el bloqueo en sí usa la columna `empresas.activa` que ya existe desde 001).
--
-- RLS de modelos_nlu: SIN políticas para anon/authenticated. Solo el service role
-- (bot + panel superadmin) lo lee/escribe. El cliente nunca ve el modelo ni su costo.
--
-- Idempotente: pegar en el SQL Editor de Supabase → Run.

-- ── 1) Catálogo de modelos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.modelos_nlu (
  id            TEXT PRIMARY KEY,                  -- clave estable, ej 'openrouter-deepseek'
  label         TEXT NOT NULL,                     -- 'DeepSeek V3 (OpenRouter)'
  proveedor     TEXT NOT NULL CHECK (proveedor IN ('groq','anthropic','openrouter')),
  api_model_id  TEXT NOT NULL,                     -- id real para la API del proveedor
  costo_in      NUMERIC(14,12) NOT NULL DEFAULT 0, -- USD por token de entrada
  costo_out     NUMERIC(14,12) NOT NULL DEFAULT 0, -- USD por token de salida
  badge         TEXT,                              -- 'Recomendado' | 'Balanceado' | 'Premium' | null
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.modelos_nlu ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo service role accede (bot + superadmin). Los clientes no.

-- Seed de los 3 modelos actuales — mantiene resolviendo los empresas.nlu_model
-- existentes (idéntico a lo que estaba hardcodeado en index.ts).
INSERT INTO public.modelos_nlu (id, label, proveedor, api_model_id, costo_in, costo_out, badge) VALUES
  ('groq-llama',       'Groq Llama 3.3', 'groq',      'llama-3.3-70b-versatile',   0.00000059, 0.00000079, 'Recomendado'),
  ('anthropic-haiku',  'Claude Haiku',   'anthropic', 'claude-haiku-4-5-20251001', 0.00000080, 0.00000400, 'Balanceado'),
  ('anthropic-sonnet', 'Claude Sonnet',  'anthropic', 'claude-sonnet-4-6',         0.00000300, 0.00001500, 'Premium')
ON CONFLICT (id) DO NOTHING;

-- ── 2) Auditoría de suspensión ───────────────────────────────────────────────
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS suspendida_at TIMESTAMPTZ;

-- ── (Opcional) Integridad referencial empresas.nlu_model → modelos_nlu.id ─────
-- Correr SOLO si el siguiente SELECT devuelve 0 filas (no hay empresas con un
-- nlu_model fuera del catálogo). Si devuelve filas, primero normalizá esos valores.
--
--   SELECT id, nombre, nlu_model FROM public.empresas e
--   WHERE nlu_model IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM public.modelos_nlu m WHERE m.id = e.nlu_model);
--
-- ALTER TABLE public.empresas
--   ADD CONSTRAINT fk_empresas_nlu_model
--   FOREIGN KEY (nlu_model) REFERENCES public.modelos_nlu(id) ON UPDATE CASCADE;
