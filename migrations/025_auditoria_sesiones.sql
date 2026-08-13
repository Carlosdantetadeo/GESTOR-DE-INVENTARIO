-- ==============================================================================
-- MIGRACIÓN 025 — Sesiones de auditoría (AuditorIA)
-- Propósito : período de conteo en una sede. Estados: abierta → cerrada.
-- Idempotente: CREATE TABLE IF NOT EXISTS.
-- RLS se habilita en la migración 029 (junto al resto de tablas nuevas).
--
-- abierta_por / cerrada_por guardan el auth.uid() (UUID) del usuario web de
-- AuditorIA. No se referencia auth.users con FK (misma convención que el resto
-- del sistema, que maneja la identidad vía app_metadata).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.sesiones_auditoria (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id  UUID   NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tienda_id   BIGINT NOT NULL REFERENCES public.tiendas(id),
  estado      TEXT   NOT NULL DEFAULT 'abierta'
                CHECK (estado IN ('abierta', 'cerrada')),
  abierta_por UUID,
  cerrada_por UUID,
  resumen     JSONB,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS sesiones_auditoria_empresa_idx
  ON public.sesiones_auditoria (empresa_id, estado);
CREATE INDEX IF NOT EXISTS sesiones_auditoria_tienda_idx
  ON public.sesiones_auditoria (tienda_id);

-- ==============================================================================
-- FIN MIGRACIÓN 025
-- ==============================================================================
