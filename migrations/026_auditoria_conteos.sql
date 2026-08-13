-- ==============================================================================
-- MIGRACIÓN 026 — Conteos de auditoría (AuditorIA)
-- Propósito : registro de una pieza auditada dentro de una sesión. Es la unidad
--             que se captura offline y se sincroniza.
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- RLS se habilita en la migración 029.
--
-- client_op_id: UUID generado en el cliente para idempotencia (un reintento de
-- subida no duplica el conteo). UNIQUE.
-- estado_fisico: valor ASCII ('danada_oxidada'); la UI muestra "dañada/oxidada".
-- auditor_uid: auth.uid() del auditor (la autoría real; movimientos.usuario_id
-- es Telegram y queda NULL para operaciones de AuditorIA).
-- semaforo_color/razon: resultado calculado en el dispositivo y persistido.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.conteos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_op_id   UUID   NOT NULL UNIQUE,
  empresa_id     UUID   NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tienda_id      BIGINT NOT NULL REFERENCES public.tiendas(id),
  sesion_id      BIGINT NOT NULL REFERENCES public.sesiones_auditoria(id) ON DELETE CASCADE,
  producto_id    BIGINT REFERENCES public.productos(id),
  cantidad       INTEGER NOT NULL CHECK (cantidad >= 0),
  estado_fisico  TEXT   NOT NULL
                   CHECK (estado_fisico IN ('integra', 'deterioro_menor', 'danada_oxidada')),
  semaforo_color TEXT   NOT NULL
                   CHECK (semaforo_color IN ('verde', 'amarillo', 'rojo')),
  semaforo_razon TEXT,
  canal          TEXT   NOT NULL DEFAULT 'voz'
                   CHECK (canal IN ('voz', 'manual')),
  transcripcion  TEXT,
  auditor_uid    UUID   NOT NULL,
  duplicado      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conteos_sesion_idx
  ON public.conteos (sesion_id);
CREATE INDEX IF NOT EXISTS conteos_empresa_fecha_idx
  ON public.conteos (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS conteos_producto_sesion_idx
  ON public.conteos (producto_id, sesion_id);

-- ==============================================================================
-- FIN MIGRACIÓN 026
-- ==============================================================================
