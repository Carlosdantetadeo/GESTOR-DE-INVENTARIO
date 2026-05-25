-- ==============================================================================
-- MIGRACIÓN 002: RLS MULTI-EMPRESA
-- Propósito : cerrar las políticas USING (true) y restringir cada tabla
--             al empresa_id del usuario autenticado.
-- Idempotente: puede ejecutarse aunque la migración 001 ya esté aplicada.
-- Cómo usar : pegar íntegramente en el SQL Editor de Supabase → Run.
--
-- IMPORTANTE sobre auth:
--   auth.jwt()->>'sub' devuelve el claim "sub" del JWT del usuario autenticado.
--   En este sistema ese claim se mapea al telegram_id (BIGINT) del operador.
--   Las inserciones que vienen de n8n usan service_role_key → bypassean RLS,
--   por lo que estas políticas sólo aplican a lecturas del dashboard web.
-- ==============================================================================


-- ==============================================================================
-- PASO 1: SCHEMA MULTI-EMPRESA (idempotente — no falla si 001 ya se ejecutó)
-- ==============================================================================

-- 1a. Tabla raíz de tenants
CREATE TABLE IF NOT EXISTS public.empresas (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           TEXT    NOT NULL,
  logo_url         TEXT,
  color_primario   TEXT    DEFAULT '#0d9488',
  color_secundario TEXT    DEFAULT '#0f172a',
  activa           BOOLEAN DEFAULT true,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

-- Empresa demo para datos existentes (sin conflicto si ya existe)
INSERT INTO public.empresas (nombre, color_primario)
SELECT 'Empresa Demo GMS', '#0d9488'
WHERE NOT EXISTS (SELECT 1 FROM public.empresas LIMIT 1);

-- 1b. Agregar empresa_id a cada tabla (IF NOT EXISTS → seguro si 001 ya corrió)
ALTER TABLE public.tiendas    ADD COLUMN IF NOT EXISTS empresa_id UUID;
ALTER TABLE public.usuarios   ADD COLUMN IF NOT EXISTS empresa_id UUID;
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS empresa_id UUID;
ALTER TABLE public.productos  ADD COLUMN IF NOT EXISTS empresa_id UUID;

-- 1c. Foreign keys (se omiten si ya existen)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tiendas_empresa_id_fkey') THEN
    ALTER TABLE public.tiendas
      ADD CONSTRAINT tiendas_empresa_id_fkey
      FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'usuarios_empresa_id_fkey') THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_empresa_id_fkey
      FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'categorias_empresa_id_fkey') THEN
    ALTER TABLE public.categorias
      ADD CONSTRAINT categorias_empresa_id_fkey
      FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'productos_empresa_id_fkey') THEN
    ALTER TABLE public.productos
      ADD CONSTRAINT productos_empresa_id_fkey
      FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 1d. Asignar empresa demo a registros que quedaron sin empresa_id
DO $$
DECLARE v_eid UUID;
BEGIN
  SELECT id INTO v_eid FROM public.empresas LIMIT 1;
  UPDATE public.tiendas    SET empresa_id = v_eid WHERE empresa_id IS NULL;
  UPDATE public.usuarios   SET empresa_id = v_eid WHERE empresa_id IS NULL;
  UPDATE public.categorias SET empresa_id = v_eid WHERE empresa_id IS NULL;
  UPDATE public.productos  SET empresa_id = v_eid WHERE empresa_id IS NULL;
END $$;


-- ==============================================================================
-- PASO 2: FUNCIÓN HELPER — get_my_empresa_id()
--
-- Por qué existe esta función en lugar del inline subquery:
--   La tabla `usuarios` necesita una policy que consulte `usuarios` para
--   resolver el empresa_id del caller. Sin SECURITY DEFINER eso crea
--   recursión infinita (la policy se aplica a su propio subquery).
--   Con SECURITY DEFINER la función ejecuta como su creador (postgres/admin),
--   bypasseando RLS en esa lectura puntual, rompiendo el ciclo.
--
-- telegram_id es BIGINT; auth.jwt()->>'sub' devuelve TEXT.
-- Se castea telegram_id a TEXT para la comparación.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_my_empresa_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id
  FROM public.usuarios
  WHERE telegram_id::text = (auth.jwt() ->> 'sub')
  LIMIT 1;
$$;


-- ==============================================================================
-- PASO 3: POLÍTICAS RLS
-- Convención de nombres: "rls_empresa" en todas las tablas para uniformidad.
-- Se elimina primero cualquier política previa (incluyendo "Allow all operations"
-- de 001 y la "tenant_isolation" de un borrador anterior de 002).
-- ==============================================================================

-- ── TIENDAS ──────────────────────────────────────────────────────────────────
-- empresa_id está en la tabla directamente (agregado en 001).

ALTER TABLE public.tiendas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations" ON public.tiendas;
DROP POLICY IF EXISTS "tenant_isolation"     ON public.tiendas;
DROP POLICY IF EXISTS "rls_empresa"          ON public.tiendas;

CREATE POLICY "rls_empresa" ON public.tiendas
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());


-- ── CATEGORIAS ───────────────────────────────────────────────────────────────
-- empresa_id está en la tabla directamente (agregado en 001).

ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations" ON public.categorias;
DROP POLICY IF EXISTS "tenant_isolation"     ON public.categorias;
DROP POLICY IF EXISTS "rls_empresa"          ON public.categorias;

CREATE POLICY "rls_empresa" ON public.categorias
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());


-- ── PRODUCTOS ─────────────────────────────────────────────────────────────────
-- empresa_id está en la tabla directamente (agregado en 001).

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations" ON public.productos;
DROP POLICY IF EXISTS "tenant_isolation"     ON public.productos;
DROP POLICY IF EXISTS "rls_empresa"          ON public.productos;

CREATE POLICY "rls_empresa" ON public.productos
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());


-- ── USUARIOS ─────────────────────────────────────────────────────────────────
-- empresa_id está en la tabla directamente.
-- La policy NO usa subquery inline en usuarios — usa get_my_empresa_id()
-- (SECURITY DEFINER) para evitar recursión infinita.

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations" ON public.usuarios;
DROP POLICY IF EXISTS "tenant_isolation"     ON public.usuarios;
DROP POLICY IF EXISTS "rls_empresa"          ON public.usuarios;

CREATE POLICY "rls_empresa" ON public.usuarios
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());


-- ── STOCK ─────────────────────────────────────────────────────────────────────
-- No tiene empresa_id propio.
-- Se filtra vía tienda_id → tiendas.empresa_id.
-- (El trigger actualizar_stock_trigger opera con privilegios del owner y no
--  está afectado por RLS; las políticas aquí sólo bloquean SELECT del dashboard.)

ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations" ON public.stock;
DROP POLICY IF EXISTS "tenant_isolation"     ON public.stock;
DROP POLICY IF EXISTS "rls_empresa"          ON public.stock;

CREATE POLICY "rls_empresa" ON public.stock
  FOR ALL
  USING (
    tienda_id IN (
      SELECT id FROM public.tiendas
      WHERE empresa_id = public.get_my_empresa_id()
    )
  )
  WITH CHECK (
    tienda_id IN (
      SELECT id FROM public.tiendas
      WHERE empresa_id = public.get_my_empresa_id()
    )
  );


-- ── MOVIMIENTOS ──────────────────────────────────────────────────────────────
-- No tiene empresa_id propio.
-- Se filtra vía producto_id → productos.empresa_id.
-- producto_id es NOT NULL en el schema, por lo que el IN es seguro.
-- Las inserciones de n8n usan service_role_key → bypassean esta policy.

ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations" ON public.movimientos;
DROP POLICY IF EXISTS "tenant_isolation"     ON public.movimientos;
DROP POLICY IF EXISTS "rls_empresa"          ON public.movimientos;

CREATE POLICY "rls_empresa" ON public.movimientos
  FOR ALL
  USING (
    producto_id IN (
      SELECT id FROM public.productos
      WHERE empresa_id = public.get_my_empresa_id()
    )
  )
  WITH CHECK (
    producto_id IN (
      SELECT id FROM public.productos
      WHERE empresa_id = public.get_my_empresa_id()
    )
  );


-- ── EMPRESAS ─────────────────────────────────────────────────────────────────
-- Cada usuario sólo ve su propia empresa.
-- get_my_empresa_id() devuelve el UUID → comparamos con id.

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations" ON public.empresas;
DROP POLICY IF EXISTS "tenant_isolation"     ON public.empresas;
DROP POLICY IF EXISTS "rls_empresa"          ON public.empresas;

CREATE POLICY "rls_empresa" ON public.empresas
  FOR ALL
  USING      (id = public.get_my_empresa_id())
  WITH CHECK (id = public.get_my_empresa_id());


-- ==============================================================================
-- FIN DE MIGRACIÓN 002
-- Para verificar que las políticas quedaron aplicadas:
--   SELECT schemaname, tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename;
-- ==============================================================================
