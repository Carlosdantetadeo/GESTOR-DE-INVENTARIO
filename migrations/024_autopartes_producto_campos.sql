-- ==============================================================================
-- MIGRACIÓN 024 — Campos de autopartes en productos (AuditorIA)
-- Propósito : agregar los datos que el semáforo sectorial de autopartes necesita.
--             Columnas ADITIVAS; no altera filas existentes ni el trigger de stock.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS y CREATE INDEX IF NOT EXISTS.
-- Cómo usar : pegar íntegramente en el SQL Editor de Supabase → Run.
--
-- Contexto: productos.stock_minimo ya existe (migración 011, DEFAULT 5) y es el
-- umbral ROJO. punto_reorden (nuevo) es el umbral AMARILLO. ultima_salida_at se
-- precalcula/sincroniza para evaluar rotación (stock muerto) sin consultar el
-- ledger en vivo desde el dispositivo offline.
-- ==============================================================================

-- Referencia / código (SKU) de la pieza. Desempata el matching por voz.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS referencia TEXT;

-- Unidad de conteo.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS unidad_medida TEXT NOT NULL DEFAULT 'unidad';

-- Punto de reorden (umbral amarillo). stock_minimo (011) es el umbral rojo.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS punto_reorden INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'productos_punto_reorden_no_negativo') THEN
    ALTER TABLE public.productos
      ADD CONSTRAINT productos_punto_reorden_no_negativo CHECK (punto_reorden >= 0);
  END IF;
END $$;

-- Stock máximo (umbral de sobrestock / capital inmovilizado). NULL = sin control
-- de sobrestock para esa pieza. Cuando está definido y la cantidad lo supera,
-- el semáforo marca amarillo.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS stock_maximo INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'productos_stock_maximo_no_negativo') THEN
    ALTER TABLE public.productos
      ADD CONSTRAINT productos_stock_maximo_no_negativo CHECK (stock_maximo IS NULL OR stock_maximo >= 0);
  END IF;
END $$;

-- Última salida registrada (para rotación / stock muerto). Se refresca en cada sync.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS ultima_salida_at TIMESTAMP WITH TIME ZONE;

-- Referencia única por empresa cuando está presente (índice parcial).
CREATE UNIQUE INDEX IF NOT EXISTS productos_empresa_referencia_uidx
  ON public.productos (empresa_id, referencia)
  WHERE referencia IS NOT NULL;

-- ==============================================================================
-- FIN MIGRACIÓN 024
-- ==============================================================================
