# Contrato — Sincronización Offline

Módulo `frontend/lib/auditoria/offline/`. Garantiza captura sin red (FR-001) y sync sin duplicados (FR-004 SC-005).

## IndexedDB — stores

| Store | Contenido | Clave |
|-------|-----------|-------|
| `catalogo` | piezas + umbrales + `ultima_salida_at` | `producto_id` |
| `cola_conteos` | conteos pendientes de subir | `client_op_id` (UUID) |
| `cola_fotos` | blobs de evidencia + metadata | `client_op_id` (UUID) |
| `meta` | `last_sync_at`, `sesion_activa` | clave fija |

## Ciclo de vida

1. **Login / arranque**: descargar catálogo del tenant a `catalogo` (≤ 60s, SC-010). Registrar service worker.
2. **Captura offline**: grabar audio (con `mimeType` intacto, FR-018) o entrada manual → escribir en `cola_conteos` con `client_op_id` nuevo. Estado UI: "pendiente de procesar" (FR-016). **Nunca** mostrar "registrado" antes de confirmar server.
3. **Flush** (disparadores): evento `online` **y** arranque de la app (FR-017). No solo timers.
4. **Subida idempotente**: por cada item de la cola, POST al server con `client_op_id`. El server deduplica por `UNIQUE(client_op_id)`. Respuesta OK → borrar de la cola. Error de red → reintentar en el próximo flush.
5. **Fotos**: al reconectar, subir blob a Storage, crear fila `evidencias`, borrar de `cola_fotos`.

## Reglas de idempotencia

- `client_op_id` (UUIDv4) se genera **una vez** al capturar y no cambia entre reintentos.
- El server responde 200 tanto si insertó como si el `client_op_id` ya existía (upsert semántico), para que el cliente pueda limpiar la cola sin ambigüedad.
- Un `movimiento` derivado (salida/ingreso) también lleva el `client_op_id` para no duplicar en el ledger.

## Indicadores UI (FR-010)

- Badge con conteo de items en `cola_conteos` + `cola_fotos`.
- Estado global `online`/`offline` visible en el shell.
- Por item: `pendiente` | `sincronizado` | `error`.

## Escenarios de aceptación

- Capturar 10 piezas en avión (sin red), cerrar app, reabrir con red → los 10 suben una sola vez (SC-005). Verificable en el dashboard del supervisor.
- Doble flush concurrente (online + arranque a la vez) → sin duplicados por `UNIQUE(client_op_id)`.
