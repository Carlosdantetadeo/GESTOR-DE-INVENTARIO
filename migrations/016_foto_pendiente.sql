-- migrations/016_foto_pendiente.sql
-- Feature 016 — pausa de confirmación para movimientos extraídos de FOTOS.
--
-- Una foto pasa por Vision (prosa) → NLU (JSON de movimientos), igual que hoy.
-- La diferencia: a diferencia de voz/texto, NO se inserta de inmediato. Los
-- movimientos ya parseados se guardan acá y el bot pide confirmación con botones.
--   · Confirmar → la Edge Function inserta los movimientos en `movimientos` y borra esta fila.
--   · Cancelar  → solo borra esta fila.
--
-- El número de migración salta de 014 a 016 a propósito: la feature 015
-- (reportes admin) fue solo-código, sin cambio de esquema (ver Feature log en CLAUDE.md).
--
-- Solo la Edge Function (service_role) toca esta tabla; RLS habilitado sin
-- políticas bloquea cualquier acceso con anon key (mismo patrón que telegram_updates, 009).

CREATE TABLE IF NOT EXISTS public.foto_pendiente (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id   BIGINT      NOT NULL,   -- quién la generó; el callback verifica que coincida
  empresa_id    UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  movimientos   JSONB       NOT NULL,   -- array de movimientos ya parseados por el NLU
  transcripcion TEXT,                   -- descripción que devolvió Vision (auditoría / mostrar al usuario)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.foto_pendiente ENABLE ROW LEVEL SECURITY;

-- Para la limpieza oportunista de pendientes viejas (foto nunca confirmada ni cancelada)
CREATE INDEX IF NOT EXISTS foto_pendiente_created_idx
  ON public.foto_pendiente(created_at);
