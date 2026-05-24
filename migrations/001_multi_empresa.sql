-- ==============================================================================
-- MIGRACIÓN: SOPORTE MULTI-EMPRESA (MULTI-TENANT) PARA AGENT GMS
-- ==============================================================================

-- 1. Crear la tabla de empresas
CREATE TABLE IF NOT EXISTS public.empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  logo_url TEXT,                      -- Almacenará la URL del logo en Supabase Storage
  color_primario TEXT DEFAULT '#0d9488', -- Color de acento personalizado (Teal Bsale por defecto)
  color_secundario TEXT DEFAULT '#0f172a',
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS en empresas
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations" ON public.empresas;
CREATE POLICY "Allow all operations" ON public.empresas FOR ALL USING (true);

-- 2. Crear una Empresa Default para no romper los datos existentes
INSERT INTO public.empresas (nombre, color_primario)
VALUES ('Empresa Demo GMS', '#0d9488')
ON CONFLICT DO NOTHING;

-- 3. Modificar las tablas existentes para vincularlas a una empresa
-- Nota: Usamos UUID para empresa_id

-- Agregar empresa_id a TIENDAS
ALTER TABLE public.tiendas ADD COLUMN IF NOT EXISTS empresa_id UUID;
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'tiendas_empresa_id_fkey'
  ) THEN
    ALTER TABLE public.tiendas ADD CONSTRAINT tiendas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Agregar empresa_id a USUARIOS
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS empresa_id UUID;
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'usuarios_empresa_id_fkey'
  ) THEN
    ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Agregar empresa_id a CATEGORIAS
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS empresa_id UUID;
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'categorias_empresa_id_fkey'
  ) THEN
    ALTER TABLE public.categorias ADD CONSTRAINT categorias_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Agregar empresa_id a PRODUCTOS
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS empresa_id UUID;
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'productos_empresa_id_fkey'
  ) THEN
    ALTER TABLE public.productos ADD CONSTRAINT productos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Asignar los registros existentes a la Empresa Default
DO $$
DECLARE
  v_default_empresa_id UUID;
BEGIN
  SELECT id INTO v_default_empresa_id FROM public.empresas LIMIT 1;
  
  IF v_default_empresa_id IS NOT NULL THEN
    UPDATE public.tiendas SET empresa_id = v_default_empresa_id WHERE empresa_id IS NULL;
    UPDATE public.usuarios SET empresa_id = v_default_empresa_id WHERE empresa_id IS NULL;
    UPDATE public.categorias SET empresa_id = v_default_empresa_id WHERE empresa_id IS NULL;
    UPDATE public.productos SET empresa_id = v_default_empresa_id WHERE empresa_id IS NULL;
  END IF;
END $$;
