-- migrations/006_fix_admin_rls.sql
-- Permite que usuarios admin (creados vía Supabase Auth con empresa_id en
-- user_metadata) pasen RLS sin necesitar una fila en la tabla `usuarios`.
-- Los operarios de Telegram siguen usando el flujo anterior (telegram_id lookup).

CREATE OR REPLACE FUNCTION get_my_empresa_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    -- Admin: empresa_id viene directo en el claim user_metadata del JWT
    (auth.jwt()->'user_metadata'->>'empresa_id')::uuid,
    -- Operario Telegram: buscar por telegram_id
    (SELECT empresa_id FROM usuarios WHERE telegram_id::text = auth.jwt()->>'sub')
  )
$$;
