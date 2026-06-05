-- Migración 005: agrega guards de NULL al trigger de stock
-- Evita el error "null value in column tienda_id" cuando el movimiento
-- no tiene tienda especificada (ej: gastos sin ubicación, trasladados parciales).

CREATE OR REPLACE FUNCTION public.actualizar_stock_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_tipo        TEXT;
  v_prod_id     BIGINT;
  v_tienda_orig BIGINT;
  v_tienda_dest BIGINT;
  v_cant        INTEGER;
  v_factor      INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tipo        := NEW.tipo;
    v_prod_id     := NEW.producto_id;
    v_tienda_orig := NEW.tienda_origen;
    v_tienda_dest := NEW.tienda_destino;
    v_cant        := NEW.cantidad;
    v_factor      := 1;
  ELSIF TG_OP = 'DELETE' THEN
    v_tipo        := OLD.tipo;
    v_prod_id     := OLD.producto_id;
    v_tienda_orig := OLD.tienda_origen;
    v_tienda_dest := OLD.tienda_destino;
    v_cant        := OLD.cantidad;
    v_factor      := -1;
  END IF;

  IF v_tipo IN ('venta', 'gasto') THEN
    IF v_tienda_orig IS NOT NULL THEN
      INSERT INTO public.stock (producto_id, tienda_id, cantidad)
      VALUES (v_prod_id, v_tienda_orig, -v_cant * v_factor)
      ON CONFLICT (producto_id, tienda_id)
      DO UPDATE SET cantidad   = stock.cantidad + EXCLUDED.cantidad,
                    updated_at = NOW();
    END IF;

  ELSIF v_tipo = 'ingreso' THEN
    IF v_tienda_dest IS NOT NULL THEN
      INSERT INTO public.stock (producto_id, tienda_id, cantidad)
      VALUES (v_prod_id, v_tienda_dest, v_cant * v_factor)
      ON CONFLICT (producto_id, tienda_id)
      DO UPDATE SET cantidad   = stock.cantidad + EXCLUDED.cantidad,
                    updated_at = NOW();
    END IF;
    IF TG_OP = 'INSERT' AND NEW.costo_unitario > 0 THEN
      UPDATE public.productos
      SET ultimo_costo          = NEW.costo_unitario,
          precio_venta_sugerido = NEW.precio_unitario
      WHERE id = NEW.producto_id;
    END IF;

  ELSIF v_tipo = 'traslado' THEN
    IF v_tienda_orig IS NOT NULL THEN
      INSERT INTO public.stock (producto_id, tienda_id, cantidad)
      VALUES (v_prod_id, v_tienda_orig, -v_cant * v_factor)
      ON CONFLICT (producto_id, tienda_id)
      DO UPDATE SET cantidad   = stock.cantidad + EXCLUDED.cantidad,
                    updated_at = NOW();
    END IF;
    IF v_tienda_dest IS NOT NULL THEN
      INSERT INTO public.stock (producto_id, tienda_id, cantidad)
      VALUES (v_prod_id, v_tienda_dest, v_cant * v_factor)
      ON CONFLICT (producto_id, tienda_id)
      DO UPDATE SET cantidad   = stock.cantidad + EXCLUDED.cantidad,
                    updated_at = NOW();
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN RETURN NEW; ELSE RETURN OLD; END IF;
END;
$$ LANGUAGE plpgsql;
