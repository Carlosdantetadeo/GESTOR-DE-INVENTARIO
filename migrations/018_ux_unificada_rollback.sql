-- migrations/018_ux_unificada_rollback.sql
-- ROLLBACK de 018_ux_unificada.sql — deja la base EXACTAMENTE como estaba antes
-- de aplicar 018 (esquema 016+017 de foto_pendiente, sin modo_admin, sin las
-- tablas/RPC nuevas).
--
-- ⚠️ LEER ANTES DE EJECUTAR
-- 1) Esto es un rollback de ESQUEMA. No puede restaurar datos que solo existían
--    bajo 018:
--      · auditoria_reversiones se DROPEA → se pierde el log de reversiones de admin.
--      · movimiento_pendiente se DROPEA → se pierden los pendientes en vuelo
--        (transitorios, viven minutos).
--      · usuarios.modo_admin se elimina (con sus valores). Si algún admin se
--        re-registró bajo 018 en modo 'con_sede', su tienda_id pudo cambiar de
--        NULL a una sede; ese cambio de DATO no se revierte (solo se quita la
--        columna). Revisar usuarios.tienda_id de admins si importa.
--      · foto_pendiente se recrea VACÍA (sus datos no existían bajo 018).
-- 2) El rollback de DB NO alcanza solo: la Edge Function desplegada con el código
--    018 consulta movimiento_pendiente y fallará tras este script. Hay que
--    REDESPLEGAR la versión previa del bot (la de main/016) en el mismo cambio:
--        supabase functions deploy telegram-bot --no-verify-jwt   (con el código 016)
-- 3) Idempotente (IF EXISTS / IF NOT EXISTS) y transaccional: si algo falla, no
--    deja la base a medias.

BEGIN;

-- ─── Revertir 6) RPC de reversión de admin ───────────────────────────────────
-- DROP FUNCTION también quita los GRANT/REVOKE asociados.
DROP FUNCTION IF EXISTS public.revertir_movimiento_admin(BIGINT, TEXT);

-- ─── Revertir 4) y 5b) auditoria_reversiones (índice + RLS + policy incluidos) ─
DROP TABLE IF EXISTS public.auditoria_reversiones;

-- ─── Revertir 1) y 5a) movimiento_pendiente (índices + RLS incluidos) ─────────
DROP TABLE IF EXISTS public.movimiento_pendiente;

-- ─── Revertir 3) usuarios.modo_admin (quita columna + CHECK + backfill) ───────
ALTER TABLE public.usuarios DROP COLUMN IF EXISTS modo_admin;

-- ─── Revertir 2) recrear foto_pendiente EXACTO como lo dejaron 016 + 017 ───────
-- 016: tabla base + RLS habilitado (sin policies) + índice por created_at.
-- 017: columnas editando_index + detalle_message_id (al final).
CREATE TABLE IF NOT EXISTS public.foto_pendiente (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id        BIGINT      NOT NULL,
  empresa_id         UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  movimientos        JSONB       NOT NULL,
  transcripcion      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  editando_index     INT,        -- 017
  detalle_message_id BIGINT      -- 017
);

ALTER TABLE public.foto_pendiente ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS foto_pendiente_created_idx
  ON public.foto_pendiente(created_at);

COMMIT;

-- Verificación rápida (opcional, correr aparte tras el COMMIT):
--   SELECT to_regclass('public.movimiento_pendiente');   -- debe ser NULL
--   SELECT to_regclass('public.auditoria_reversiones');  -- debe ser NULL
--   SELECT to_regclass('public.foto_pendiente');         -- debe existir
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'usuarios' AND column_name = 'modo_admin';  -- 0 filas
--   SELECT proname FROM pg_proc WHERE proname = 'revertir_movimiento_admin';  -- 0 filas
