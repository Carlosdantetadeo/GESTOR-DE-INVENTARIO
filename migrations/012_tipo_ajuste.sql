-- migrations/012_tipo_ajuste.sql
-- Nuevo tipo de movimiento 'ajuste': corrección manual de stock con motivo
-- obligatorio. La cantidad del ajuste es la DIFERENCIA con signo entre el
-- conteo real y el stock del sistema (positiva = sobrante, negativa =
-- faltante); el dashboard la calcula a partir de la cantidad contada.
-- El Undo funciona igual que los demás tipos: DELETE → trigger con factor -1.
--
-- ⚠️ PRECHECK — correr ANTES de esta migración. El paso 3 agrega una
-- restricción de signo sobre cantidad que valida las filas EXISTENTES;
-- si hay movimientos históricos con cantidad <= 0 el ALTER falla:
--
--   SELECT id, tipo, cantidad, created_at
--   FROM public.movimientos
--   WHERE cantidad <= 0;
--
-- Si devuelve filas, son datos inválidos históricos: corregirlas primero
-- (borrarlas revierte su efecto en stock vía trigger) y luego ejecutar
-- SELECT recalcular_stock(); para verificar consistencia.

-- ─── 1. Columna motivo (obligatoria solo para ajustes) ──────────────────────

ALTER TABLE public.movimientos
  ADD COLUMN IF NOT EXISTS motivo TEXT;

ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_ajuste_motivo
  CHECK (tipo <> 'ajuste' OR (motivo IS NOT NULL AND btrim(motivo) <> ''));

-- ─── 2. Permitir 'ajuste' en el CHECK de tipo ────────────────────────────────
-- 'movimientos_tipo_check' es el nombre autogenerado del CHECK inline del
-- schema base. Si el DROP no encuentra el constraint (no falla, pero el ADD
-- posterior dejaría DOS checks y los INSERT de ajuste seguirían rechazados),
-- buscar el nombre real con:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.movimientos'::regclass AND contype = 'c';

ALTER TABLE public.movimientos DROP CONSTRAINT IF EXISTS movimientos_tipo_check;
ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_tipo_check
  CHECK (tipo IN ('venta', 'ingreso', 'gasto', 'traslado', 'ajuste'));

-- ─── 3. Signo de cantidad ────────────────────────────────────────────────────
-- Tipos clásicos: cantidad estrictamente positiva (antes no había restricción).
-- Ajuste: positiva o negativa, nunca cero (un ajuste de 0 no significa nada).
-- Nota: total es columna generada (cantidad * precio_unitario); los ajustes
-- se insertan con precio_unitario = 0, así que total = 0 y no contaminan KPIs.

ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_cantidad_signo
  CHECK (
    (tipo = 'ajuste' AND cantidad <> 0)
    OR (tipo <> 'ajuste' AND cantidad > 0)
  );

-- ─── 4. Trigger con rama para 'ajuste' ───────────────────────────────────────
-- Reemplaza la función COMPLETA. La fuente canónica del trigger pasa a ser
-- este archivo (basado en migrations/005 + rama ajuste). NUNCA editar la
-- función a mano en el SQL Editor — ver incidente documentado en CLAUDE.md.
--
-- El ajuste opera sobre tienda_origen (la tienda donde se hizo el conteo):
--   stock.cantidad += movimiento.cantidad   (la cantidad ya trae el signo)
-- En DELETE, v_factor = -1 lo revierte — el Undo no necesita código nuevo.

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

  ELSIF v_tipo = 'ajuste' THEN
    -- v_cant trae el signo de la diferencia (sobrante > 0, faltante < 0)
    IF v_tienda_orig IS NOT NULL THEN
      INSERT INTO public.stock (producto_id, tienda_id, cantidad)
      VALUES (v_prod_id, v_tienda_orig, v_cant * v_factor)
      ON CONFLICT (producto_id, tienda_id)
      DO UPDATE SET cantidad   = stock.cantidad + EXCLUDED.cantidad,
                    updated_at = NOW();
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN RETURN NEW; ELSE RETURN OLD; END IF;
END;
$$ LANGUAGE plpgsql;

-- ─── Verificación post-migración ─────────────────────────────────────────────
-- 1. El trigger desplegado debe coincidir con este archivo:
--    SELECT prosrc FROM pg_proc WHERE proname = 'actualizar_stock_trigger';
-- 2. Probar un ajuste y su undo:
--    INSERT INTO movimientos (tipo, producto_id, tienda_origen, cantidad, motivo)
--    VALUES ('ajuste', <prod>, <tienda>, -2, 'prueba migración 012');
--    -- verificar stock, luego DELETE de ese movimiento y verificar reversión
