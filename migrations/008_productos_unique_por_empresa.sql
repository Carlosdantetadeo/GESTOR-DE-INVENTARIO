-- migrations/008_productos_unique_por_empresa.sql
-- FIX (B3): productos_nombre_key era UNIQUE global sobre nombre (del schema
-- base, pensado para una sola empresa). En multi-tenant hacía fallar el
-- auto-create del bot cuando OTRA empresa ya tenía un producto con ese nombre,
-- y el movimiento se perdía silenciosamente.
-- La unicidad correcta es por empresa, case-insensitive (el NLU normaliza
-- nombres con casing variable).

-- Precheck sugerido antes de correr (debe devolver 0 filas; si devuelve algo,
-- hay duplicados por empresa que resolver a mano primero):
--   SELECT empresa_id, LOWER(nombre), COUNT(*)
--   FROM public.productos
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1;

ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_nombre_key;

CREATE UNIQUE INDEX IF NOT EXISTS productos_empresa_nombre_key
  ON public.productos (empresa_id, LOWER(nombre));
