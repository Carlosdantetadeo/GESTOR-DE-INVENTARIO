-- ==============================================================================
-- MIGRACIÓN 039 — Límite de usuarios por empresa (plan)
-- Propósito : cada empresa puede tener un tope de usuarios web según su plan.
--             NULL = ilimitado (comportamiento actual). El superadmin lo define
--             y la creación de usuarios lo valida (evita que paguen por 1 y usen 100).
-- Idempotente: ADD COLUMN IF NOT EXISTS. Aditiva, no toca RLS ni datos.
-- ==============================================================================

ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS max_usuarios integer;

-- ==============================================================================
-- FIN MIGRACIÓN 039
-- Verificación:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='empresas' AND column_name='max_usuarios';
-- ==============================================================================
