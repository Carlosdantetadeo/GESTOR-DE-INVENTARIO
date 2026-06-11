-- migrations/007_empresa_id_app_metadata.sql
-- FIX SEGURIDAD (S1): get_my_empresa_id() leía empresa_id desde el claim
-- user_metadata del JWT. user_metadata es editable por el propio usuario via
-- supabase.auth.updateUser(), lo que permitía falsificar el empresa_id y
-- acceder a datos de cualquier otra empresa (lectura Y escritura, las
-- políticas son FOR ALL).
-- app_metadata solo puede modificarse con service_role → es la fuente segura.
-- También restaura SET search_path (S4), que la versión de 006 había perdido.

-- 1. Backfill: copiar empresa_id de user_metadata a app_metadata
--    en los usuarios admin ya existentes
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object(
           'empresa_id', raw_user_meta_data->>'empresa_id',
           'rol',        COALESCE(raw_user_meta_data->>'rol', 'admin')
         )
WHERE raw_user_meta_data->>'empresa_id' IS NOT NULL;

-- 2. Limpiar user_metadata: empresa_id y rol ya no viven ahí
UPDATE auth.users
SET raw_user_meta_data = (raw_user_meta_data - 'empresa_id') - 'rol'
WHERE raw_user_meta_data ? 'empresa_id';

-- 3. La función RLS lee SOLO app_metadata (nunca user_metadata),
--    con el fallback por telegram_id para operarios intacto
CREATE OR REPLACE FUNCTION public.get_my_empresa_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Admin: empresa_id viene de app_metadata (solo modificable con service role)
    (auth.jwt()->'app_metadata'->>'empresa_id')::uuid,
    -- Operario Telegram: buscar por telegram_id
    (SELECT empresa_id FROM public.usuarios WHERE telegram_id::text = auth.jwt()->>'sub')
  )
$$;
