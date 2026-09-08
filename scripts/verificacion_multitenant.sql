-- ============================================================
-- VERIFICACIÓN DE AISLAMIENTO MULTI-TENANT (solo lectura)
-- Proyecto Supabase: nxhkzcuqnmqjtiltoztg
-- Pegar en el SQL Editor de Supabase y correr. No modifica nada.
-- ============================================================

-- 1) ¿get_my_empresa_id() lee de app_metadata (seguro) y NO de user_metadata?
--    Esperado: usa_app_metadata = true, usa_user_metadata_INSEGURO = false
SELECT
  proname,
  (prosrc LIKE '%app_metadata%')  AS usa_app_metadata,
  (prosrc LIKE '%user_metadata%') AS usa_user_metadata_INSEGURO,
  prosrc
FROM pg_proc
WHERE proname = 'get_my_empresa_id';

-- 2) ¿La función tiene SET search_path (fix S4)?
--    Esperado: proconfig contiene search_path=public
SELECT proname, proconfig
FROM pg_proc
WHERE proname = 'get_my_empresa_id';

-- 3) ¿Quedó algún admin con empresa_id todavía en user_metadata (residuo pre-007)?
--    Esperado: 0 filas
SELECT id, email, raw_user_meta_data->>'empresa_id' AS empresa_id_en_user_metadata
FROM auth.users
WHERE raw_user_meta_data ? 'empresa_id';

-- 4) ¿Todos los admins tienen empresa_id en app_metadata (fuente segura)?
SELECT id, email,
       raw_app_meta_data->>'empresa_id' AS empresa_id_en_app_metadata,
       raw_app_meta_data->>'rol'        AS rol
FROM auth.users
ORDER BY created_at;

-- 5) ¿RLS habilitado en todas las tablas del tenant?
--    Esperado: rowsecurity = true en las 7 tablas
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('empresas','tiendas','usuarios','categorias','productos','stock','movimientos')
ORDER BY tablename;

-- 6) ¿Existe la política rls_empresa en cada tabla? (qual = condición USING)
--    Esperado: una fila rls_empresa por tabla (7 en total)
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('empresas','tiendas','usuarios','categorias','productos','stock','movimientos')
ORDER BY tablename;
