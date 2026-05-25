-- ==============================================================================
-- MIGRACIÓN 003: Agregar telegram_token a empresas
-- Ejecutar en Supabase SQL Editor antes de usar la Edge Function de onboarding.
-- ==============================================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS telegram_token TEXT UNIQUE DEFAULT gen_random_uuid()::text NOT NULL;

CREATE INDEX IF NOT EXISTS empresas_telegram_token_idx ON public.empresas(telegram_token);

-- El bot de Telegram usa este token para vincular a los empleados:
--   /start <telegram_token>  →  el bot asigna el telegram_id del empleado a esa empresa.
