-- =============================================================================
-- MIGRACIÓN 013 — Rubro de la empresa
-- =============================================================================
-- Agrega empresas.rubro: el giro del negocio ("ferretería", "abarrotes",
-- "plásticos", ...). Se interpola en los prompts de IA del bot de Telegram
-- (visión y NLU) y aparece en el encabezado de los PDF exportados.
--
-- DEFAULT 'ferretería' mantiene el comportamiento actual para las empresas
-- existentes; las nuevas lo capturan en /registro y se edita en /admin/config.
-- =============================================================================

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS rubro TEXT NOT NULL DEFAULT 'ferretería';
