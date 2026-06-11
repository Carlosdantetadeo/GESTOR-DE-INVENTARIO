-- migrations/010_recalcular_stock.sql
-- Función de reconciliación: reconstruye la tabla stock desde el ledger de
-- movimientos (la fuente de verdad). Para corregir cualquier desvío entre
-- stock y movimientos (ej: operaciones masivas que interleavaron con el
-- trigger, o datos tocados a mano).
-- Ejecutar cuando haga falta:  SELECT public.recalcular_stock();

CREATE OR REPLACE FUNCTION public.recalcular_stock()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM stock;
  INSERT INTO stock (producto_id, tienda_id, cantidad)
  SELECT producto_id, tienda_id, SUM(delta)::int
  FROM (
    SELECT producto_id, tienda_origen  AS tienda_id, -cantidad AS delta
      FROM movimientos WHERE tipo IN ('venta', 'gasto') AND tienda_origen IS NOT NULL
    UNION ALL
    SELECT producto_id, tienda_destino,  cantidad
      FROM movimientos WHERE tipo = 'ingreso' AND tienda_destino IS NOT NULL
    UNION ALL
    SELECT producto_id, tienda_origen,  -cantidad
      FROM movimientos WHERE tipo = 'traslado' AND tienda_origen IS NOT NULL
    UNION ALL
    SELECT producto_id, tienda_destino,  cantidad
      FROM movimientos WHERE tipo = 'traslado' AND tienda_destino IS NOT NULL
  ) t
  GROUP BY producto_id, tienda_id;
$$;

-- Solo service_role / SQL Editor pueden ejecutarla (es una operación global)
REVOKE EXECUTE ON FUNCTION public.recalcular_stock() FROM PUBLIC, anon, authenticated;
