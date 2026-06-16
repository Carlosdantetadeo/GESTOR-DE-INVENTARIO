-- migrations/020_catalogo_productos.sql
-- Sprint 020 — Catálogo de productos (carga inicial del cliente)
--
-- Agrega a `productos` los campos que el cliente carga manualmente o por
-- import Excel/CSV desde /admin/config (Catálogo de productos):
--   · unidad             — unidad de medida (und, kg, m, m², litro, caja, bolsa, otro)
--   · precio_referencial — precio de referencia que ayuda al NLU a validar precios
--
-- NOTA sobre categoría: `productos` ya modela la categoría vía `categoria_id`
-- (FK → categorias, con empresa_id). NO se agrega una columna `categoria` TEXT
-- redundante; el alta/importación resuelve el nombre de categoría a categoria_id
-- (mismo patrón que createProducto() y el auto-alta del bot).
--
-- NOTA sobre consumo de tokens: la tabla `consumo_ia` (migración 004) ya cubre
-- exactamente lo que el sprint pedía como `nlu_usage_log`
-- (empresa_id, modelo, tokens_entrada, tokens_salida, costo_usd, created_at) y el
-- bot ya escribe ahí tras cada llamada al NLU. El panel superadmin lee de
-- `consumo_ia` — no se crea ninguna tabla nueva.
--
-- Idempotente: pegar en el SQL Editor de Supabase → Run.

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS unidad             TEXT          DEFAULT 'und',
  ADD COLUMN IF NOT EXISTS precio_referencial NUMERIC(12,2);

-- Para los productos ya existentes sin unidad, fijar el default explícito.
UPDATE public.productos SET unidad = 'und' WHERE unidad IS NULL;
