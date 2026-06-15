-- migrations/018_ux_unificada.sql
-- Sprint 018 — UX unificada del bot (rama feat/018-ux-unificada).
--
-- Reemplaza foto_pendiente (016/017) por una tabla genérica de "pendiente de
-- confirmación" para LOS TRES canales (voz, texto, foto). Agrega el modo de admin
-- (consulta vs con_sede) y la infraestructura de auditoría de reversiones.
--
-- ─── CORRECCIONES sobre el SQL del documento de sprint ───────────────────────
-- El SQL del brief asumía cosas que NO coinciden con el esquema real; se
-- corrigieron acá (decisiones de la sesión de arquitectura):
--
--  · TIPOS: todos los PK del esquema son BIGINT IDENTITY, no UUID
--    (ver CREAR_TABLAS_SUPABASE_FINAL.sql). Por eso `auditoria_reversiones`
--    usa movimiento_id BIGINT y revertido_por BIGINT (no UUID), y el RPC
--    recibe p_movimiento_id BIGINT. Solo empresas.id es UUID.
--  · movimientos NO tiene empresa_id (001 lo agregó a tiendas/usuarios/
--    categorias/productos, no a movimientos). El scoping multi-tenant va por
--    el join productos.empresa_id (igual que handleUndo en el bot). Por eso el
--    RPC joinea productos en vez de filtrar m.empresa_id.
--  · RLS: el modelo real es get_my_empresa_id() leyendo auth.jwt()->app_metadata
--    (002/007), NO current_setting('app.current_empresa_id'). Las policies usan
--    el helper existente. El bot usa SERVICE_ROLE_KEY y BYPASSA RLS, con scoping
--    explícito en código — por eso movimiento_pendiente queda con RLS habilitado
--    SIN policies (solo service_role entra; anon queda bloqueado), mismo patrón
--    que foto_pendiente (016) y telegram_updates (009).
--  · No se migran datos de foto_pendiente: los pendientes son transitorios
--    (viven minutos), se descartan al dropear la tabla.

-- ─── 1) movimiento_pendiente (reemplaza foto_pendiente) ──────────────────────
-- PK UUID a propósito: el callback_data "confirmar:<uuid>" mide 46 bytes y entra
-- en el límite de 64 bytes de Telegram, así que no hace falta short_id.
CREATE TABLE IF NOT EXISTS public.movimiento_pendiente (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  telegram_id         BIGINT NOT NULL,
  channel             TEXT NOT NULL CHECK (channel IN ('voz', 'texto', 'foto')),
  -- 'compra' es la elección UX de la foto; se mapea a 'ingreso' al insertar en
  -- movimientos (el ledger usa venta/ingreso/gasto/traslado/ajuste).
  tipo                TEXT CHECK (tipo IN ('compra', 'venta', 'ingreso', 'traslado')),
  items               JSONB NOT NULL DEFAULT '[]'::jsonb,
  total               NUMERIC(12, 2),
  card_message_id     BIGINT,
  editing_state       TEXT CHECK (editing_state IN ('asking_item_number', 'asking_values')),
  editing_item_number INT,
  auto_confirm_at     TIMESTAMPTZ,
  file_id             TEXT,
  -- Transcripción (STT de voz / texto / prosa de Vision). Solo backend: NUNCA se
  -- ecoa al chat (decisión #2), pero se conserva para auditar movimientos.transcripcion.
  transcripcion       TEXT,
  cancelled           BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup del pendiente activo por operario.
CREATE INDEX IF NOT EXISTS idx_mov_pend_telegram
  ON public.movimiento_pendiente(telegram_id, empresa_id) WHERE cancelled = false;
-- Barrido de los que tienen auto-confirmación agendada.
CREATE INDEX IF NOT EXISTS idx_mov_pend_auto_confirm
  ON public.movimiento_pendiente(auto_confirm_at)
  WHERE auto_confirm_at IS NOT NULL AND cancelled = false;

-- ─── 2) Dropear foto_pendiente (sin migrar datos: son transitorios) ──────────
DROP TABLE IF EXISTS public.foto_pendiente;

-- ─── 3) usuarios.modo_admin ──────────────────────────────────────────────────
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS modo_admin TEXT
  CHECK (modo_admin IN ('consulta', 'con_sede'));

-- Backfill: admins con tienda_id NULL → 'consulta'; el resto de admins → 'con_sede'.
UPDATE public.usuarios
SET modo_admin = CASE
  WHEN rol = 'admin' AND tienda_id IS NULL THEN 'consulta'
  WHEN rol = 'admin'                        THEN 'con_sede'
  ELSE NULL
END
WHERE rol = 'admin';

-- ─── 4) auditoría de reversiones del admin (infra; el dashboard la usará) ─────
-- movimiento_id y revertido_por son BIGINT (los PK reales del esquema).
-- revertido_por es NULLABLE: un admin que opera desde la web tiene cuenta de
-- Supabase Auth, pero NO necesariamente una fila en `usuarios` (esa se crea por
-- Telegram /start). Resolver qué usuarios.id registrar para una reversión web es
-- un OPEN ITEM del epic de dashboard; por ahora el RPC lo deja NULL.
CREATE TABLE IF NOT EXISTS public.auditoria_reversiones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  movimiento_id   BIGINT NOT NULL,
  movimiento_data JSONB NOT NULL,
  revertido_por   BIGINT REFERENCES public.usuarios(id),
  motivo          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_rev_empresa
  ON public.auditoria_reversiones(empresa_id, created_at DESC);

-- ─── 5) RLS ──────────────────────────────────────────────────────────────────
-- movimiento_pendiente: solo el bot (service_role) la toca y bypassa RLS. Sin
-- policies → cualquier acceso con anon key queda bloqueado (patrón 009/016).
ALTER TABLE public.movimiento_pendiente ENABLE ROW LEVEL SECURITY;

-- auditoria_reversiones: el dashboard (admin autenticado, anon key + RLS) la lee.
-- Policy de aislamiento por empresa con el helper existente (002/007). El INSERT
-- lo hace el RPC SECURITY DEFINER (bypassa RLS), por eso solo se necesita SELECT.
ALTER TABLE public.auditoria_reversiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_audit_rev ON public.auditoria_reversiones;
CREATE POLICY tenant_select_audit_rev ON public.auditoria_reversiones
  FOR SELECT
  USING (empresa_id = public.get_my_empresa_id());

-- ─── 6) RPC de reversión de admin (la usa el dashboard, no el bot) ───────────
-- Corrige el RPC del brief: p_movimiento_id BIGINT, empresa vía get_my_empresa_id(),
-- admin verificado por auth.jwt()->app_metadata->rol (fuente confiable, 007), y
-- scoping de movimientos por join a productos (movimientos no tiene empresa_id).
CREATE OR REPLACE FUNCTION public.revertir_movimiento_admin(
  p_movimiento_id BIGINT,
  p_motivo        TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movimiento JSONB;
  v_empresa_id UUID;
  v_rol        TEXT;
BEGIN
  v_empresa_id := public.get_my_empresa_id();
  v_rol        := auth.jwt() -> 'app_metadata' ->> 'rol';

  IF v_empresa_id IS NULL OR v_rol IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un admin puede revertir movimientos';
  END IF;

  -- Scoping multi-tenant por productos.empresa_id (movimientos no tiene empresa_id).
  SELECT to_jsonb(m.*) INTO v_movimiento
  FROM public.movimientos m
  JOIN public.productos p ON p.id = m.producto_id
  WHERE m.id = p_movimiento_id
    AND p.empresa_id = v_empresa_id;

  IF v_movimiento IS NULL THEN
    RAISE EXCEPTION 'Movimiento no encontrado o sin permiso';
  END IF;

  -- revertido_por queda NULL: ver nota en la tabla (mapeo auth↔usuarios pendiente).
  INSERT INTO public.auditoria_reversiones (empresa_id, movimiento_id, movimiento_data, revertido_por, motivo)
  VALUES (v_empresa_id, p_movimiento_id, v_movimiento, NULL, p_motivo);

  -- El trigger tr_actualizar_stock revierte el stock con factor -1 en el DELETE.
  DELETE FROM public.movimientos WHERE id = p_movimiento_id;
END;
$$;

-- Solo usuarios autenticados (admins, vía dashboard) pueden invocarla; anon no.
REVOKE ALL ON FUNCTION public.revertir_movimiento_admin(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_movimiento_admin(BIGINT, TEXT) TO authenticated;
