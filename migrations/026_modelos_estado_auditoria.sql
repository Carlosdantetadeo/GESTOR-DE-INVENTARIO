-- migrations/026_modelos_estado_auditoria.sql
-- Fase 3 — Estado del modelo (activo/inactivo/deprecado) + tabla de auditoría.
--
-- 1. Agrega columna `estado` y migra datos desde el booleano `activo`.
-- 2. Crea `nlu_model_audit` para registrar cada mutación del catálogo.
--
-- Idempotente: pegar en el SQL Editor de Supabase → Run.

-- ── 1) Columna estado ────────────────────────────────────────────────────────
ALTER TABLE public.modelos_nlu
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo', 'inactivo', 'deprecado'));

-- Migrar desde el booleano activo (solo afecta filas existentes).
UPDATE public.modelos_nlu
  SET estado = CASE WHEN activo THEN 'activo' ELSE 'inactivo' END
  WHERE estado = 'activo' AND activo = false;

COMMENT ON COLUMN public.modelos_nlu.estado IS
  'activo = disponible para asignar | inactivo = oculto en selectores | deprecado = en uso pero no asignable a clientes nuevos.';

-- ── 2) Tabla de auditoría ────────────────────────────────────────────────────
-- actor_id usa un UUID constante para el superadmin (único actor de este panel).
-- Valor de referencia: 00000000-0000-0000-0000-000000000001
CREATE TABLE IF NOT EXISTS public.nlu_model_audit (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  accion     TEXT        NOT NULL,  -- crear|editar|activar|desactivar|deprecar|eliminar|migrar
  modelo_id  TEXT,                  -- id del modelo afectado (TEXT, no UUID — la PK es TEXT)
  empresa_id UUID,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.nlu_model_audit ENABLE ROW LEVEL SECURITY;
-- Solo service role escribe y lee. Sin políticas = solo service role.

CREATE INDEX IF NOT EXISTS nlu_model_audit_created_idx
  ON public.nlu_model_audit (created_at DESC);
