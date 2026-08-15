# Phase 1 — Data Model: AuditorIA Autopartes

Todas las tablas nuevas viven en la **misma base de datos** de GMS. Convenciones heredadas de la constitución: `empresa_id UUID NOT NULL` en toda tabla de tenant, RLS habilitado con policies **nuevas** (no se tocan las existentes), IDs de tablas de negocio en `BIGINT GENERATED ALWAYS AS IDENTITY` (consistente con `productos`/`tiendas`/`usuarios`).

Leyenda: 🆕 tabla/columna nueva · ♻️ tabla existente reutilizada (no se modifica su estructura salvo columnas aditivas marcadas).

---

## Entidades existentes reutilizadas (♻️)

| Entidad | Uso en AuditorIA | Cambios |
|---------|------------------|---------|
| `empresas` | Tenant. `rubro` distingue el sector (`autopartes`). | Ninguno. |
| `tiendas` | Sede donde se audita. | Ninguno. |
| `usuarios` | Tabla Telegram del bot. **No** se usa para login web. | Ninguno. |
| `productos` | Catálogo de piezas. | 🆕 columnas aditivas (ver 024). |
| `stock` | Stock derivado por trigger. Se **lee** para el semáforo; nunca se escribe. | Ninguno. |
| `movimientos` | Ledger. AuditorIA inserta salidas/recepciones aquí. | 🆕 columna aditiva `client_op_id` (migración 030); sigue append-only. |

### 024 — columnas aditivas sobre `productos` 🆕

| Campo | Tipo | Regla |
|-------|------|-------|
| `referencia` | `TEXT` | Código/SKU de la pieza. Único por empresa cuando no es NULL. Desempata matching por voz. |
| `unidad_medida` | `TEXT NOT NULL DEFAULT 'unidad'` | Unidad de conteo. |
| `punto_reorden` | `INTEGER NOT NULL DEFAULT 0` | `CHECK (punto_reorden >= 0)`. Umbral amarillo de reposición. `stock_minimo` (ya existe, DEFAULT 5) es el umbral rojo. |
| `stock_maximo` | `INTEGER` (nullable) | `CHECK (stock_maximo IS NULL OR stock_maximo >= 0)`. Umbral de **sobrestock** (amarillo). NULL = sin control de sobrestock para esa pieza. |
| `ultima_salida_at` | `TIMESTAMPTZ` | Precalculado/actualizado para el semáforo offline (rotación 6 meses). Se refresca en cada sync del catálogo. |

Invariante de umbrales: `stock_minimo ≤ punto_reorden ≤ stock_maximo` (cuando `stock_maximo` está definido; validado en carga de catálogo; si no se cumple, se marca fila con warning).

### 030 — idempotencia del ledger 🆕

| Campo | Tipo | Regla |
|-------|------|-------|
| `client_op_id` | `UUID` | Idempotencia de salidas/recepciones creadas offline. Índice `UNIQUE` **parcial** (`WHERE client_op_id IS NOT NULL`) para no afectar los movimientos históricos (bot) que lo tienen NULL. |

DDL **aditiva**: agrega la columna y el índice único parcial; no altera filas existentes ni el trigger. Sigue cumpliendo Constitución V (append-only): registrar = INSERT, deshacer = DELETE. Un reintento de subida con el mismo `client_op_id` no duplica el movimiento.

---

## Entidades nuevas (🆕)

### `sesiones_auditoria`

Período de conteo en una sede. Estados: `abierta` → `cerrada`.

| Campo | Tipo | Regla |
|-------|------|-------|
| `id` | `BIGINT IDENTITY PK` | |
| `empresa_id` | `UUID NOT NULL → empresas` | Aislamiento tenant. |
| `tienda_id` | `BIGINT NOT NULL → tiendas` | Sede auditada. |
| `estado` | `TEXT CHECK (estado IN ('abierta','cerrada')) DEFAULT 'abierta'` | |
| `abierta_por` | `UUID` | auth uid (supervisor/auditor). |
| `cerrada_por` | `UUID` | auth uid; NULL mientras abierta. |
| `resumen` | `JSONB` | Totales por color + insights al cerrar. |
| `created_at` / `closed_at` | `TIMESTAMPTZ` | |

**Transiciones**: `abierta` (al crear) → `cerrada` (al cerrar, setea `closed_at`, `cerrada_por`, `resumen`). No se reabre.

### `conteos`

Registro de una pieza auditada dentro de una sesión. Es la unidad que sincroniza offline.

| Campo | Tipo | Regla |
|-------|------|-------|
| `id` | `BIGINT IDENTITY PK` | |
| `client_op_id` | `UUID NOT NULL UNIQUE` | Idempotencia offline (generado en cliente). |
| `empresa_id` | `UUID NOT NULL → empresas` | |
| `tienda_id` | `BIGINT NOT NULL → tiendas` | |
| `sesion_id` | `BIGINT NOT NULL → sesiones_auditoria` | |
| `producto_id` | `BIGINT → productos` | NULL si es pieza pendiente sin aprobar. |
| `cantidad` | `INTEGER NOT NULL` | `CHECK (cantidad >= 0)`. |
| `estado_fisico` | `TEXT CHECK (estado_fisico IN ('integra','deterioro_menor','danada_oxidada')) NOT NULL` | Alimenta el semáforo (FR-019). Valor almacenado en ASCII; el acento ("dañada/oxidada") solo se muestra en UI. |
| `semaforo_color` | `TEXT CHECK (semaforo_color IN ('verde','amarillo','rojo')) NOT NULL` | Resultado calculado en cliente y persistido. |
| `semaforo_razon` | `TEXT` | Motivo legible. |
| `canal` | `TEXT CHECK (canal IN ('voz','manual')) DEFAULT 'voz'` | Cómo se capturó. |
| `transcripcion` | `TEXT` | Texto de la voz (solo backend, no se muestra en el chat — n/a aquí). |
| `auditor_uid` | `UUID NOT NULL` | Autoría real (auth uid), ya que `movimientos.usuario_id` es Telegram. |
| `duplicado` | `BOOLEAN DEFAULT false` | Marca si otro conteo de la misma pieza existe en la sesión (FR-015). |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |

**Nota FR-015**: dos conteos de la misma pieza en una sesión se guardan ambos; un chequeo marca `duplicado=true` en los involucrados para revisión del supervisor. Sin bloqueo ni sobreescritura.

### `evidencias`

Foto adjunta a un conteo. Vive en Storage; la fila guarda la referencia.

| Campo | Tipo | Regla |
|-------|------|-------|
| `id` | `BIGINT IDENTITY PK` | |
| `client_op_id` | `UUID NOT NULL UNIQUE` | Idempotencia de subida offline. |
| `empresa_id` | `UUID NOT NULL → empresas` | |
| `conteo_id` | `BIGINT NOT NULL → conteos` | |
| `storage_path` | `TEXT NOT NULL` | `{empresa_id}/{sesion_id}/{conteo_id}/{uuid}.jpg` en bucket `evidencias`. |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |

### `piezas_pendientes`

Pieza detectada en factura que no existe en el catálogo. Requiere aprobación (FR-007).

| Campo | Tipo | Regla |
|-------|------|-------|
| `id` | `BIGINT IDENTITY PK` | |
| `empresa_id` | `UUID NOT NULL → empresas` | |
| `tienda_id` | `BIGINT → tiendas` | Sede de la recepción. |
| `descripcion_extraida` | `TEXT NOT NULL` | Texto leído de la factura. |
| `unidad_sugerida` | `TEXT` | |
| `cantidad` | `INTEGER` | |
| `precio_unitario` | `NUMERIC(10,2)` | |
| `estado` | `TEXT CHECK (estado IN ('pendiente','aprobada','rechazada')) DEFAULT 'pendiente'` | |
| `producto_id` | `BIGINT → productos` | Se llena al aprobar (pieza creada). |
| `recepcion_ref` | `TEXT` | Agrupa ítems de una misma factura. |
| `resuelta_por` | `UUID` | auth uid del supervisor/admin. |
| `created_at` / `resolved_at` | `TIMESTAMPTZ` | |

**Transiciones**: `pendiente` → `aprobada` (crea `productos` + genera movimiento de ingreso) | `rechazada` (no entra al catálogo ni al inventario).

---

## Flujo de escritura al ledger (recepción y salidas)

- **Recepción aprobada** → INSERT `movimientos` `tipo='ingreso'`, `tienda_destino=tienda_id`, con `costo_unitario` (el trigger actualiza `ultimo_costo`/`precio_venta_sugerido`).
- **Salida/venta (FR-021)** → INSERT `movimientos` `tipo='venta'`, `tienda_origen=tienda_id`.
- En ambos: `usuario_id = NULL` (autoría real en `conteos`/`piezas_pendientes`); `client_op_id` deduplica reintentos.
- **Nunca** se escribe `stock` (Constitución IV). **Nunca** UPDATE de `movimientos` (Constitución V).

## RLS (migración 029) 🆕

Cada tabla nueva: `ENABLE ROW LEVEL SECURITY` + policy **nueva** scoped por `empresa_id` leído de `app_metadata` (mismo patrón que el frontend actual). No se alteran policies existentes. Bucket `evidencias`: policy por `empresa_id` en el primer segmento del path.

## Índices

- `conteos (sesion_id)`, `conteos (empresa_id, created_at)`, `conteos (producto_id, sesion_id)` para detección de duplicados.
- `piezas_pendientes (empresa_id, estado)` para el panel de aprobaciones.
- `productos (empresa_id, referencia)` único parcial `WHERE referencia IS NOT NULL`.
- `UNIQUE (client_op_id)` en `conteos` y `evidencias` (idempotencia).
