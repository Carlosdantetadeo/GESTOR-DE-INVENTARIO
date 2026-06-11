-- migrations/009_telegram_updates_dedupe.sql
-- FIX (B5): Telegram reenvía el mismo update si el webhook no responde 200
-- a tiempo (el pipeline STT + NLU puede tardar varios segundos), lo que
-- duplicaba movimientos y descontaba stock dos veces.
-- Esta tabla registra cada update_id procesado; el PRIMARY KEY hace que el
-- segundo intento falle con 23505 y la función lo descarte.

CREATE TABLE IF NOT EXISTS public.telegram_updates (
  update_id  BIGINT      PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Solo la Edge Function (service_role) escribe acá; sin políticas, RLS
-- habilitado bloquea cualquier acceso con anon key.
ALTER TABLE public.telegram_updates ENABLE ROW LEVEL SECURITY;

-- Para la limpieza oportunista de registros viejos que hace la función
CREATE INDEX IF NOT EXISTS telegram_updates_created_idx
  ON public.telegram_updates(created_at);
