-- migrations/019_edicion_por_campo.sql
-- Edición de ítem por CAMPO (Nombre / Cantidad / Precio) en vez de reescribir los
-- tres datos juntos. Cambia los estados de edición y agrega editing_field.
--
-- NO toca el ledger (movimientos / triggers / esquema). Solo movimiento_pendiente
-- (tabla de pendientes transitorios de 018).
--
-- Estados nuevos del flujo: asking_item_number → asking_field → asking_value.
-- (Reemplaza 'asking_values' de 018 por 'asking_field' + 'asking_value'.)

-- 1) Limpiar ediciones en vuelo con el estado viejo, para no violar el CHECK nuevo.
UPDATE public.movimiento_pendiente
SET editing_state = NULL, editing_item_number = NULL
WHERE editing_state IS NOT NULL
  AND editing_state NOT IN ('asking_item_number', 'asking_field', 'asking_value');

-- 2) Reemplazar el CHECK de editing_state (el inline de 018 se llama
--    movimiento_pendiente_editing_state_check).
ALTER TABLE public.movimiento_pendiente
  DROP CONSTRAINT IF EXISTS movimiento_pendiente_editing_state_check;
ALTER TABLE public.movimiento_pendiente
  ADD CONSTRAINT movimiento_pendiente_editing_state_check
  CHECK (editing_state IN ('asking_item_number', 'asking_field', 'asking_value'));

-- 3) Qué campo se está editando (cuando editing_state = 'asking_value').
ALTER TABLE public.movimiento_pendiente
  ADD COLUMN IF NOT EXISTS editing_field TEXT
  CHECK (editing_field IN ('nombre', 'cantidad', 'precio'));

-- Rollback (si hiciera falta):
--   ALTER TABLE public.movimiento_pendiente DROP COLUMN IF EXISTS editing_field;
--   UPDATE public.movimiento_pendiente SET editing_state = NULL
--     WHERE editing_state IN ('asking_field', 'asking_value');
--   ALTER TABLE public.movimiento_pendiente DROP CONSTRAINT IF EXISTS movimiento_pendiente_editing_state_check;
--   ALTER TABLE public.movimiento_pendiente ADD CONSTRAINT movimiento_pendiente_editing_state_check
--     CHECK (editing_state IN ('asking_item_number', 'asking_values'));
