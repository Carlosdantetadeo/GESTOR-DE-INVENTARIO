-- ==============================================================================
-- MIGRACIÓN 028 — Piezas pendientes de aprobación (AuditorIA)
-- Propósito : pieza detectada en una factura que no existe en el catálogo.
--             No entra al inventario hasta que admin/supervisor la apruebe.
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- RLS se habilita en la migración 029.
--
-- Estados: pendiente → aprobada (crea productos + movimiento de ingreso) |
--          pendiente → rechazada (sin efecto).
-- recepcion_ref: agrupa los ítems de una misma factura.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.piezas_pendientes (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          UUID   NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tienda_id           BIGINT REFERENCES public.tiendas(id),
  descripcion_extraida TEXT  NOT NULL,
  unidad_sugerida     TEXT,
  cantidad            INTEGER,
  precio_unitario     NUMERIC(10, 2),
  estado              TEXT   NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  producto_id         BIGINT REFERENCES public.productos(id),
  recepcion_ref       TEXT,
  resuelta_por        UUID,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS piezas_pendientes_empresa_estado_idx
  ON public.piezas_pendientes (empresa_id, estado);

-- ==============================================================================
-- FIN MIGRACIÓN 028
-- ==============================================================================
