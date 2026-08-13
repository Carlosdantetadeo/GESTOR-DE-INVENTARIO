# Contrato — Operaciones de datos (server)

Lo que AuditorIA expone/consume contra Supabase. Todas las operaciones son **scoped por `empresa_id`** vía RLS (`app_metadata`). `frontend/lib/auditoria/queries.js` (NO se toca `frontend/lib/queries.js`).

## Catálogo (sync)

- `GET catálogo del tenant`: `SELECT` de `productos` (+ `stock` de la sede + `ultima_salida_at`) filtrado por `empresa_id`. Alimenta IndexedDB.
- `POST carga de catálogo` (admin): valida columnas (nombre, unidad_medida, referencia, stock_minimo, punto_reorden), importa filas válidas, reporta inválidas sin abortar (FR-014).

## Auditoría

- `POST sesión` (supervisor): crea `sesiones_auditoria` (`abierta`).
- `POST conteo`: inserta `conteos` con `client_op_id` (idempotente). Marca `duplicado` si ya hay conteo de esa pieza en la sesión (FR-015).
- `POST evidencia`: sube a bucket `evidencias`, inserta fila (idempotente).
- `POST cerrar sesión`: `estado='cerrada'`, calcula `resumen` (totales por color); si hay red, agrega insight ejecutivo.
- `GET dashboard supervisor` (realtime): conteos por color, alertas críticas (rojos), progreso — vía Supabase Realtime sobre `conteos` (SC-006).

## Recepción por factura

- `POST ocr-factura`: imagen → texto de ítems (Groq Vision, server-side, key oculta). Devuelve ítems + match sugerido (fuzzy / `pg_trgm`).
- `POST confirmar recepción`: por ítem con match → INSERT `movimientos` `tipo='ingreso'` (`client_op_id`); ítem sin match → `piezas_pendientes` (`pendiente`), NO entra al inventario (FR-007).
- `POST aprobar/rechazar pieza pendiente` (supervisor/admin): aprobar → crea `productos` + movimiento de ingreso; rechazar → cierra sin efecto.

## Salidas/ventas (FR-021)

- `POST salida`: INSERT `movimientos` `tipo='venta'`, `tienda_origen=tienda_id`, `client_op_id`. El trigger descuenta stock. Respeta stock disponible y `tienda_id` obligatorio.
- `POST deshacer salida` (ventana corta): DELETE del movimiento (reversión por trigger).

## Invariantes de seguridad (constitución)

- Ningún endpoint escribe `stock` directamente (IV).
- Ningún endpoint hace UPDATE de `movimientos` (V).
- Toda inserción incluye `empresa_id` y `tienda_id` donde aplique (I).
- Keys de Groq / service role: solo server-side (nunca en cliente).
- No se modifican RLS ni `supabase.js` existentes (II).
