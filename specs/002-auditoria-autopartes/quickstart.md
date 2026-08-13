# Quickstart — Validación de AuditorIA Autopartes

Guía para probar que la feature funciona end-to-end. No incluye código de implementación; ver `data-model.md` y `contracts/` para el detalle.

## Prerrequisitos

- Base de datos GMS existente (Supabase) con migraciones ≤ 023 aplicadas.
- Migraciones nuevas 024–029 aplicadas en orden (SQL Editor de Supabase).
- Bucket de Storage `evidencias` creado con RLS por `empresa_id`.
- Un tenant (`empresas.rubro = 'autopartes'`) con al menos una sede (`tiendas`) y un usuario Supabase Auth con `app_metadata = { empresa_id, rol:'auditor', tienda_id }`.
- Catálogo cargado (≥ 20 piezas con `stock_minimo`, `punto_reorden`, `referencia`).

## Setup local

```
cd frontend
npm install
npm run dev
# abrir http://localhost:3000/auditoria e "instalar" la PWA
```

## Escenarios de validación

### 1. Semáforo determinista (offline) — US2, SC-011

- Poner el dispositivo en modo avión.
- Contar por voz una pieza con stock por debajo de su `stock_minimo`.
- **Esperado**: tarjeta roja, razón "quiebre de stock (bajo mínimo)", en < 2s, sin red.
- Contar una pieza sana pero marcada `dañada_oxidada` → **roja** (el daño gana).
- Ver `contracts/semaforo.md` (tabla de casos) — todos deben pasar en unit test antes del E2E.

### 2. Captura por voz offline + sync — US1, SC-005

- En modo avión, capturar 10 piezas. Verificar badge de "10 pendientes" (FR-010) y que **nunca** aparece "registrado".
- Cerrar la app. Reabrir con red.
- **Esperado**: las 10 suben una sola vez (flush en arranque + `online`); aparecen en el dashboard del supervisor en < 30s (SC-006). Sin duplicados (idempotencia por `client_op_id`).

### 3. Recepción por foto de factura — US4, FR-007

- Con red, fotografiar una factura de 10 ítems.
- **Esperado**: tarjeta de revisión con match sugerido por ítem; ≥ 8 identificados (SC-003).
- Un ítem inexistente en catálogo → queda `pendiente_aprobacion`, **no** entra al inventario.
- Confirmar recepción → ítems con match generan `movimientos tipo='ingreso'`; stock sube (vía trigger).

### 4. Aprobación de pieza nueva — US3/US6

- Como supervisor, abrir panel de aprobaciones → ver la pieza pendiente.
- Aprobar con nombre/unidad/umbrales → se crea en `productos` y queda disponible para voz/factura.

### 5. Evidencia fotográfica offline — US5, FR-008

- En modo avión, adjuntar foto a una pieza roja.
- Reconectar → la foto aparece en el detalle del conteo en el dashboard, vinculada al registro correcto.

### 6. Salida/venta — FR-021

- Registrar una salida de N unidades de una pieza.
- **Esperado**: INSERT en `movimientos tipo='venta'`; el stock baja por el trigger; deshacer (ventana corta) revierte.
- Verificar en paralelo que el **bot de Telegram sigue registrando** normalmente sobre las mismas tablas (FR-020).

### 7. Aislamiento multi-tenant — SC-007

- Con un usuario del tenant A, intentar leer conteos/piezas del tenant B (por API directa).
- **Esperado**: RLS bloquea; cero filas cross-tenant.

## Definición de "funciona"

- Escenarios 1–7 pasan.
- El bot de Telegram y el dashboard actual **no cambian su comportamiento** (regresión).
- Unit tests del semáforo verdes (7 casos de `contracts/semaforo.md`).
- No se escribió `stock` directamente ni se hizo UPDATE de `movimientos` (revisión contra Constitución IV/V).
