-- ==============================================================================
-- MIGRACIÓN 029 — RLS de las tablas nuevas de AuditorIA
-- Propósito : aislar por empresa las tablas de auditoría, reutilizando el helper
--             public.get_my_empresa_id() (definido en 002/007, lee app_metadata).
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE.
--
-- IMPORTANTE (Constitución II): NO se modifica ninguna policy existente. Solo se
-- crean policies NUEVAS ("rls_empresa") para tablas NUEVAS. Todas las tablas de
-- auditoría tienen empresa_id propio, así que el filtro es directo.
-- ==============================================================================

-- ── SESIONES_AUDITORIA ────────────────────────────────────────────────────────
ALTER TABLE public.sesiones_auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_empresa" ON public.sesiones_auditoria;
CREATE POLICY "rls_empresa" ON public.sesiones_auditoria
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());

-- ── CONTEOS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.conteos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_empresa" ON public.conteos;
CREATE POLICY "rls_empresa" ON public.conteos
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());

-- ── EVIDENCIAS ────────────────────────────────────────────────────────────────
ALTER TABLE public.evidencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_empresa" ON public.evidencias;
CREATE POLICY "rls_empresa" ON public.evidencias
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());

-- ── PIEZAS_PENDIENTES ─────────────────────────────────────────────────────────
ALTER TABLE public.piezas_pendientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_empresa" ON public.piezas_pendientes;
CREATE POLICY "rls_empresa" ON public.piezas_pendientes
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());

-- ── STORAGE: bucket 'evidencias' ──────────────────────────────────────────────
-- El primer segmento del path es el empresa_id (ver storage_path en 027).
-- Requiere que el bucket 'evidencias' ya exista (creado a mano en el panel).
DROP POLICY IF EXISTS "rls_empresa_evidencias" ON storage.objects;
CREATE POLICY "rls_empresa_evidencias" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'evidencias'
    AND (storage.foldername(name))[1] = public.get_my_empresa_id()::text
  )
  WITH CHECK (
    bucket_id = 'evidencias'
    AND (storage.foldername(name))[1] = public.get_my_empresa_id()::text
  );

-- ==============================================================================
-- FIN MIGRACIÓN 029
-- Verificación:
--   SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('sesiones_auditoria','conteos','evidencias','piezas_pendientes')
--   ORDER BY tablename;
-- ==============================================================================
