CREATE TABLE IF NOT EXISTS public.tiendas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL,
  activa BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.tiendas (nombre) 
VALUES 
  ('Tienda 1'),
  ('Tienda 2'),
  ('Tienda 3'),
  ('Tienda 4'),
  ('Tienda 5'),
  ('Tienda 6')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.usuarios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  nombre TEXT,
  rol TEXT CHECK (rol IN ('admin', 'vendedor')) DEFAULT 'vendedor',
  tienda_id BIGINT REFERENCES public.tiendas(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS usuarios_telegram_id_idx ON public.usuarios(telegram_id);

CREATE TABLE IF NOT EXISTS public.categorias (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL,
  ruta TEXT UNIQUE,
  padre_id BIGINT REFERENCES public.categorias(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'categorias' 
    AND column_name = 'ruta'
  ) THEN
    ALTER TABLE public.categorias ADD COLUMN ruta TEXT UNIQUE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS categorias_nombre_idx ON public.categorias(LOWER(nombre));
CREATE INDEX IF NOT EXISTS categorias_ruta_idx ON public.categorias(ruta);

INSERT INTO public.categorias (nombre, ruta, padre_id) 
VALUES 
  ('PRODUCTOS', 'productos', NULL),
  ('TUBOS Y CONEXIONES', 'tubos_conexiones', NULL),
  ('GRIFERÍA Y VALVULAS', 'griferia_valvulas', NULL),
  ('HERRAMIENTAS Y ACCESORIOS', 'herramientas_accesorios', NULL),
  ('REPUESTOS Y EMPAQUES', 'repuestos_empaques', NULL),
  ('OTROS', 'otros', NULL)
ON CONFLICT (ruta) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.productos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria_id BIGINT REFERENCES public.categorias(id),
  ultimo_costo NUMERIC(10,2) DEFAULT 0,
  precio_venta_sugerido NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'productos_nombre_key'
  ) THEN
    ALTER TABLE public.productos ADD CONSTRAINT productos_nombre_key UNIQUE (nombre);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS productos_nombre_idx ON public.productos(LOWER(nombre));

CREATE TABLE IF NOT EXISTS public.stock (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  producto_id BIGINT REFERENCES public.productos(id) NOT NULL,
  tienda_id BIGINT REFERENCES public.tiendas(id) NOT NULL,
  cantidad INTEGER DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(producto_id, tienda_id)
);

CREATE INDEX IF NOT EXISTS stock_producto_idx ON public.stock(producto_id);
CREATE INDEX IF NOT EXISTS stock_tienda_idx ON public.stock(tienda_id);

CREATE TABLE IF NOT EXISTS public.movimientos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo TEXT CHECK (tipo IN ('venta', 'ingreso', 'gasto', 'traslado')) NOT NULL,
  producto_id BIGINT REFERENCES public.productos(id) NOT NULL,
  tienda_origen BIGINT REFERENCES public.tiendas(id),
  tienda_destino BIGINT REFERENCES public.tiendas(id),
  cantidad INTEGER NOT NULL,
  precio_unitario NUMERIC(10,2) DEFAULT 0,
  costo_unitario NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  usuario_id BIGINT REFERENCES public.usuarios(id),
  transcripcion TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS movimientos_tipo_idx ON public.movimientos(tipo);
CREATE INDEX IF NOT EXISTS movimientos_producto_idx ON public.movimientos(producto_id);
CREATE INDEX IF NOT EXISTS movimientos_fecha_idx ON public.movimientos(created_at);

CREATE OR REPLACE FUNCTION public.actualizar_stock_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_tipo TEXT;
  v_prod_id BIGINT;
  v_tienda_orig BIGINT;
  v_tienda_dest BIGINT;
  v_cant INTEGER;
  v_factor INTEGER;
BEGIN
  -- Determinar si es una inserción (INSERT) o una eliminación (DELETE)
  IF TG_OP = 'INSERT' THEN
    v_tipo := NEW.tipo;
    v_prod_id := NEW.producto_id;
    v_tienda_orig := NEW.tienda_origen;
    v_tienda_dest := NEW.tienda_destino;
    v_cant := NEW.cantidad;
    v_factor := 1;
  ELSIF TG_OP = 'DELETE' THEN
    v_tipo := OLD.tipo;
    v_prod_id := OLD.producto_id;
    v_tienda_orig := OLD.tienda_origen;
    v_tienda_dest := OLD.tienda_destino;
    v_cant := OLD.cantidad;
    v_factor := -1; -- Invierte la operación matemática al eliminar
  END IF;

  -- Lógica de actualización de stock
  IF v_tipo = 'venta' OR v_tipo = 'gasto' THEN
    INSERT INTO public.stock (producto_id, tienda_id, cantidad)
    VALUES (v_prod_id, v_tienda_orig, -v_cant * v_factor)
    ON CONFLICT (producto_id, tienda_id) 
    DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad, updated_at = NOW();
    
  ELSIF v_tipo = 'ingreso' THEN
    INSERT INTO public.stock (producto_id, tienda_id, cantidad)
    VALUES (v_prod_id, v_tienda_dest, v_cant * v_factor)
    ON CONFLICT (producto_id, tienda_id) 
    DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad, updated_at = NOW();
    
    -- Solo actualizar precios de productos en inserciones reales con costo mayor a 0
    IF TG_OP = 'INSERT' AND NEW.costo_unitario > 0 THEN
      UPDATE public.productos 
      SET ultimo_costo = NEW.costo_unitario, precio_venta_sugerido = NEW.precio_unitario
      WHERE id = NEW.producto_id;
    END IF;

  ELSIF v_tipo = 'traslado' THEN
    -- Quitar/Restaurar en origen
    INSERT INTO public.stock (producto_id, tienda_id, cantidad)
    VALUES (v_prod_id, v_tienda_orig, -v_cant * v_factor)
    ON CONFLICT (producto_id, tienda_id) 
    DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad, updated_at = NOW();
    
    -- Agregar/Restaurar en destino
    INSERT INTO public.stock (producto_id, tienda_id, cantidad)
    VALUES (v_prod_id, v_tienda_dest, v_cant * v_factor)
    ON CONFLICT (producto_id, tienda_id) 
    DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad, updated_at = NOW();
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  ELSE
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_actualizar_stock ON public.movimientos;
CREATE TRIGGER tr_actualizar_stock
AFTER INSERT OR DELETE ON public.movimientos
FOR EACH ROW EXECUTE FUNCTION public.actualizar_stock_trigger();

ALTER TABLE public.tiendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- ADVERTENCIA DE SEGURIDAD (RLS)
-- Las siguientes políticas están completamente abiertas ("Allow all operations" con USING (true))
-- EXCLUSIVAMENTE para propósitos de MVP, desarrollo y depuración rápida.
-- IMPORTANTE: Para un entorno de producción real, estas políticas DEBEN cerrarse,
-- auditarse y restringirse estrictamente según el rol o usuario (por ejemplo,
-- comparando con auth.uid() o roles definidos en la tabla de usuarios).
-- ==============================================================================

DROP POLICY IF EXISTS "Allow all operations" ON public.tiendas;
CREATE POLICY "Allow all operations" ON public.tiendas FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all operations" ON public.usuarios;
CREATE POLICY "Allow all operations" ON public.usuarios FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all operations" ON public.categorias;
CREATE POLICY "Allow all operations" ON public.categorias FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all operations" ON public.productos;
CREATE POLICY "Allow all operations" ON public.productos FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all operations" ON public.stock;
CREATE POLICY "Allow all operations" ON public.stock FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all operations" ON public.movimientos;
CREATE POLICY "Allow all operations" ON public.movimientos FOR ALL USING (true);
