-- ==============================================================================
-- MIGRACIÓN 037 — Consignaciones (Almacenero Digital)
-- Propósito : registrar productos dados a clientes sin cobro inmediato.
--             El stock NO se altera al crear la consignación. Solo se descuenta
--             cuando el admin/supervisor confirma que se vendió (lo que inserta
--             un movimiento tipo 'venta' y dispara el trigger existente).
--             Si se devuelve, el estado cambia a 'devuelta' y no hay movimiento.
-- NOTA      : el DROP inicial garantiza idempotencia aunque la tabla ya exista
--             con una definición incompleta.
-- ==============================================================================

DROP TABLE IF EXISTS public.consignaciones CASCADE;

CREATE TABLE public.consignaciones (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id      UUID    NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tienda_id       BIGINT  NOT NULL REFERENCES public.tiendas(id),
  producto_id     BIGINT  NOT NULL REFERENCES public.productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  cliente         TEXT    NOT NULL,
  estado          TEXT    NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','confirmada','devuelta')),
  auth_uid        UUID    NOT NULL,           -- quien la creó (auth.uid())
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  cerrada_at      TIMESTAMP WITH TIME ZONE,
  cerrada_por     UUID,                       -- quien confirmó/devolvió
  movimiento_id   BIGINT                      -- enlace al movimiento cuando se confirma
);

CREATE INDEX consignaciones_empresa_estado_idx ON public.consignaciones (empresa_id, estado);
CREATE INDEX consignaciones_tienda_estado_idx  ON public.consignaciones (tienda_id, estado);
CREATE INDEX consignaciones_auth_uid_idx       ON public.consignaciones (auth_uid);

ALTER TABLE public.consignaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_empresa" ON public.consignaciones;
CREATE POLICY "rls_empresa" ON public.consignaciones
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());

-- ==============================================================================
-- FIN MIGRACIÓN 037
-- Verificación:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'consignaciones' ORDER BY ordinal_position;
-- ==============================================================================
