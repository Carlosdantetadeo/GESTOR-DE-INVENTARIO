-- ==============================================================================
-- MIGRACIÓN 034 — Secciones (ubicaciones dentro de una sede)
-- CONTEXTO: la tabla public.secciones YA EXISTE en producción con columnas
--   (id, nombre, tienda_id, created_at) pero SIN empresa_id ni RLS por empresa.
--   Esta migración la ADAPTA (no la recrea): agrega empresa_id, la rellena desde
--   la sede, activa RLS por empresa (patrón 029) y agrega movimientos.seccion_id.
--
-- La sección es SOLO ubicación: el stock se sigue contando por producto + tienda.
-- NO se toca el trigger de stock, ni el bot, ni policies existentes.
-- Idempotente: IF NOT EXISTS / DROP POLICY IF EXISTS / guardas.
-- ==============================================================================

-- 1) empresa_id + backfill desde la sede (tiendas.empresa_id) ───────────────────
ALTER TABLE public.secciones
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE;

UPDATE public.secciones s
   SET empresa_id = t.empresa_id
  FROM public.tiendas t
 WHERE s.tienda_id = t.id
   AND s.empresa_id IS NULL;

-- NOT NULL solo si el backfill cubrió todas las filas (evita fallar si hay huérfanas).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.secciones WHERE empresa_id IS NULL) THEN
    ALTER TABLE public.secciones ALTER COLUMN empresa_id SET NOT NULL;
  END IF;
END $$;

-- 2) RLS por empresa (patrón migración 029) ────────────────────────────────────
ALTER TABLE public.secciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_empresa" ON public.secciones;
CREATE POLICY "rls_empresa" ON public.secciones
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());

-- 3) Unicidad de nombre por sede + índice ──────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS secciones_tienda_nombre_uidx ON public.secciones (tienda_id, nombre);
CREATE INDEX        IF NOT EXISTS secciones_tienda_idx         ON public.secciones (tienda_id);

-- 4) movimientos.seccion_id (nullable: el bot y lo previo siguen igual) ─────────
ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS seccion_id BIGINT REFERENCES public.secciones(id);

-- ==============================================================================
-- FIN MIGRACIÓN 034
-- Verificación:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='secciones' ORDER BY ordinal_position;
--   SELECT policyname FROM pg_policies WHERE tablename='secciones';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='movimientos' AND column_name='seccion_id';
-- ==============================================================================
