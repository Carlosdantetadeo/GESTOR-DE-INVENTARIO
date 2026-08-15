-- ==============================================================================
-- MIGRACIÓN 032 — Rotación: poblar productos.ultima_salida_at (AuditorIA)
-- Propósito : mantener actualizada la fecha de la última venta por pieza, para
--             que el semáforo detecte "stock muerto" offline (dimensión de
--             rotación). Alimenta el sync del catálogo.
-- Idempotente: backfill re-ejecutable + CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
--
-- NO toca el trigger de stock (tr_actualizar_stock). Es un trigger SEPARADO que
-- solo escribe productos.ultima_salida_at (patrón ya usado: el trigger de stock
-- también actualiza productos en los ingresos). Cuenta las salidas tipo 'venta'.
-- ==============================================================================

-- 1) Backfill con la última venta registrada de cada pieza.
UPDATE public.productos p
SET ultima_salida_at = sub.ult
FROM (
  SELECT producto_id, MAX(created_at) AS ult
  FROM public.movimientos
  WHERE tipo = 'venta'
  GROUP BY producto_id
) sub
WHERE p.id = sub.producto_id;

-- 2) Trigger: cada venta nueva actualiza la última salida (forward-only).
CREATE OR REPLACE FUNCTION public.actualizar_ultima_salida()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tipo = 'venta' THEN
    UPDATE public.productos
    SET ultima_salida_at = GREATEST(COALESCE(ultima_salida_at, NEW.created_at), NEW.created_at)
    WHERE id = NEW.producto_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_ultima_salida ON public.movimientos;
CREATE TRIGGER tr_ultima_salida
AFTER INSERT ON public.movimientos
FOR EACH ROW EXECUTE FUNCTION public.actualizar_ultima_salida();

-- ==============================================================================
-- FIN MIGRACIÓN 032
-- ==============================================================================
