-- migrations/011_stock_minimo.sql
-- Umbral de alerta de stock configurable por producto.
-- Antes las alertas usaban un hardcode en el frontend (cantidad < 5);
-- ahora cada producto define su propio mínimo y el frontend compara
-- contra productos.stock_minimo. El DEFAULT 5 preserva el comportamiento
-- actual para todos los productos existentes y los auto-creados por el bot.

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 5
  CONSTRAINT productos_stock_minimo_no_negativo CHECK (stock_minimo >= 0);
