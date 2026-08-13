---
description: "Task list for AuditorIA — Sector Autopartes"
---

# Tasks: AuditorIA — PWA de Auditoría de Inventario (Sector Autopartes)

**Input**: Design documents from `/specs/002-auditoria-autopartes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Se incluyen SOLO los tests exigidos por el diseño: los 7 unit tests deterministas del semáforo (`contracts/semaforo.md`) y el E2E de validación (`quickstart.md`). No se genera TDD completo (Constitución VII — simplicidad).

**Organización**: por historia de usuario (US1–US6) + fase de salidas (FR-021). Cada historia es un incremento desplegable e independientemente testeable.

**Contexto de rutas**: web app dentro del `frontend/` existente. Código nuevo en `frontend/app/auditoria/`, `frontend/lib/auditoria/`, `frontend/public/`; migraciones en `migrations/`. NO se tocan `frontend/lib/supabase.js`, `frontend/lib/queries.js`, ni `supabase/functions/telegram-bot/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: estructura de la PWA y andamiaje offline.

- [x] T001 Crear estructura de carpetas de la feature: `frontend/app/auditoria/` (con subcarpetas `captura/`, `recepcion/`, `salidas/`, `supervisor/`, `catalogo/`) y `frontend/lib/auditoria/` (con `offline/`)
- [x] T002 [P] Agregar Web App Manifest instalable en `frontend/public/auditoria-manifest.json` (nombre, íconos, `start_url=/auditoria`, `display=standalone`)
- [x] T003 [P] Crear Service Worker de app shell en `frontend/public/auditoria-sw.js` con scope limitado a `/auditoria/*` (FR-011)
- [x] T004 [P] Agregar dependencia `idb` en `frontend/package.json` y crear stores de IndexedDB (`catalogo`, `cola_conteos`, `cola_fotos`, `meta`) en `frontend/lib/auditoria/offline/db.js` (ver `contracts/sync-offline.md`)
- [ ] T005 [P] Crear bucket de Supabase Storage `evidencias` con path `{empresa_id}/{sesion_id}/{conteo_id}/{uuid}.jpg` y documentar su creación en `specs/002-auditoria-autopartes/quickstart.md` (ya referenciado)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: migraciones, RLS, auth y motor de sync que TODAS las historias necesitan.

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase.

- [ ] T006 [P] Migración `migrations/024_autopartes_producto_campos.sql`: columnas aditivas en `productos` (`referencia`, `unidad_medida`, `punto_reorden`, `ultima_salida_at`) con checks e índice único parcial de `referencia` por empresa (ver `data-model.md`)
- [ ] T007 [P] Migración `migrations/025_auditoria_sesiones.sql`: tabla `sesiones_auditoria` con `empresa_id`, `tienda_id`, estado, autoría
- [ ] T008 [P] Migración `migrations/026_auditoria_conteos.sql`: tabla `conteos` con `client_op_id UNIQUE`, `estado_fisico`, `semaforo_*`, `auditor_uid`, `duplicado`, índices
- [ ] T009 [P] Migración `migrations/027_auditoria_evidencias.sql`: tabla `evidencias` con `client_op_id UNIQUE`, `storage_path`, FK a `conteos`
- [ ] T010 [P] Migración `migrations/028_auditoria_piezas_pendientes.sql`: tabla `piezas_pendientes` con estados y `recepcion_ref`
- [ ] T011 Migración `migrations/029_auditoria_rls.sql`: `ENABLE ROW LEVEL SECURITY` + policies **nuevas** scoped por `empresa_id` (`app_metadata`) en las 4 tablas nuevas + policy del bucket `evidencias` (depende de T007–T010; NO altera policies existentes — Constitución II)
- [ ] T045 [P] Migración `migrations/030_movimientos_client_op_id.sql`: columna aditiva `client_op_id UUID` en `movimientos` + índice `UNIQUE` parcial (`WHERE client_op_id IS NOT NULL`) para idempotencia de salidas/recepciones (C1; DDL aditiva, sigue append-only — Constitución V)
- [x] T012 Definir roles `auditor`/`supervisor`/`admin` en `app_metadata` y guard de acceso a `/auditoria` en `frontend/app/auditoria/layout.js` reutilizando el patrón de sesión existente (research R2/R3; Constitución III) — helpers en `frontend/lib/auditoria/auth.js`
- [x] T013 [P] Crear cliente/queries de AuditorIA en `frontend/lib/auditoria/queries.js` (lee `app_metadata.empresa_id`; NO toca `frontend/lib/queries.js`)
- [x] T014 Implementar motor de sync idempotente en `frontend/lib/auditoria/offline/syncEngine.js` y `queue.js`: flush en evento `online` y en arranque, dedupe por `client_op_id` (FR-017; `contracts/sync-offline.md`)
- [x] T015 Shell PWA con estado online/offline y badge de pendientes en `frontend/app/auditoria/layout.js` (FR-010), registrando `auditoria-sw.js` (shell en `AuditoriaShell.js`; excluido del sidebar en `components/AppShell.js`)

**Checkpoint**: fundación lista — las historias pueden comenzar.

---

## Phase 3: User Story 1 — Auditor cuenta piezas por voz (Priority: P1) 🎯 MVP

**Goal**: capturar el conteo de una pieza por voz sin conexión y encolarlo para sync.

**Independent Test**: en modo avión, contar un pasillo completo por voz; los conteos quedan locales y suben una sola vez al reconectar (SC-005).

- [x] T016 [US1] Sincronizar catálogo del tenant a IndexedDB (`catalogo`) al login/arranque en `frontend/lib/auditoria/offline/catalogo.js` (SC-010)
- [x] T017 [P] [US1] Implementar fuzzy match on-device en `frontend/lib/auditoria/matching.js` (normalización + trigramas; top-3; desempate por `referencia`) (FR-004; research R4) — 6/6 tests en verde
- [x] T018 [US1] Grabación de voz con `MediaRecorder` preservando `mimeType` en `frontend/app/auditoria/captura/page.js` (FR-016/FR-018): online transcribe y prellena; offline encola el audio (`cola_audios`, store v2) y lo transcribe al reconectar (`offline/audios.js`), listo para que el auditor complete el conteo
- [x] T019 [US1] UI de captura con búsqueda local, selección entre coincidencias y confirmación explícita antes de guardar (FR-001) en `frontend/app/auditoria/captura/page.js`
- [x] T020 [US1] Subida idempotente de `conteos` vía `queries.js` (`upsert onConflict=client_op_id`); marca `duplicado` cuando ya existe conteo de la pieza en la sesión (FR-015)

**Checkpoint**: US1 funcional y testeable — captura por voz offline con sync sin duplicados.

---

## Phase 4: User Story 2 — El semáforo informa el estado de cada pieza (Priority: P1)

**Goal**: mostrar color/razón/acción determinista por pieza, offline, en < 2s.

**Independent Test**: pieza bajo mínimo → rojo "quiebre de stock"; pieza dañada con stock sano → rojo; sin red, < 2s (SC-011).

- [x] T021 [P] [US2] Implementar motor puro `evaluarSemaforo(pieza, conteo, config)` en `frontend/lib/auditoria/semaforo.js` (color = peor de estado físico + salud de inventario; stock muerto = 6 meses; + regla de sobrestock) (`contracts/semaforo.md`)
- [x] T022 [P] [US2] Unit tests del semáforo (8 casos del contrato) en `frontend/lib/auditoria/semaforo.test.mjs` — 8/8 en verde con `node --test`
- [x] T023 [US2] Capturar `estado_fisico` en el flujo de conteo e integrar el resultado del semáforo en la tarjeta de confirmación, persistiendo `semaforo_color`/`semaforo_razon` en `conteos` (FR-019; `frontend/app/auditoria/captura/page.js`)
- [x] T024 [US2] Poblar `ultima_salida_at` por pieza desde el ledger para la rotación offline: backfill + trigger `tr_ultima_salida` en `migrations/032_ultima_salida_rotacion.sql` (forward-only; el sync del catálogo ya lo lee)

**Checkpoint**: US1 + US2 funcionan — captura por voz con semáforo offline.

---

## Phase 5: User Story 3 — Supervisor ve el inventario en tiempo real (Priority: P2)

**Goal**: dashboard en vivo por color, alertas críticas, cierre de sesión con resumen y panel de aprobaciones.

**Independent Test**: 3 piezas rojas registradas → aparecen en el dashboard en < 30s con su detalle (SC-006).

- [x] T025 [US3] Dashboard de supervisor en tiempo real (conteos por color, alertas de rojos, progreso) usando Supabase Realtime en `frontend/app/auditoria/supervisor/page.js`
- [x] T026 [US3] Cierre de sesión con cálculo de `resumen` (totales por color) en `frontend/app/auditoria/supervisor/page.js` (insight ejecutivo con IA queda para más adelante)
- [x] T027 [US3] Panel que lista `piezas_pendientes` (`pendiente`) para el supervisor en `frontend/app/auditoria/supervisor/page.js` (aprobar/rechazar se cablea en US4/T031)

**Checkpoint**: US1–US3 funcionan; el supervisor tiene visibilidad y control.

---

## Phase 6: User Story 4 — Recepción por foto de factura (Priority: P2)

**Goal**: extraer ítems de una factura, revisarlos y registrar la recepción; piezas nuevas quedan pendientes.

**Independent Test**: factura de 10 ítems → ≥ 8 identificados; ítem inexistente queda pendiente sin entrar al inventario (SC-003; FR-007).

- [x] T028 [US4] Endpoint server-side de OCR de factura (Groq Vision, key oculta, modelo por env) en `frontend/app/api/auditoria/factura/route.js` (research R5; `contracts/data-operations.md`)
- [x] T029 [US4] UI de revisión ítem por ítem con match local (fuzzy) e indicador de baja confianza en `frontend/app/auditoria/recepcion/page.js` (FR-005/FR-006)
- [x] T030 [US4] Confirmar recepción → INSERT `movimientos tipo='ingreso'` (con `client_op_id`, dedupe) para ítems con match; ítems sin match → `piezas_pendientes` (`pendiente`) (FR-007; Constitución IV/V)
- [x] T031 [US4] Aprobar/rechazar pieza pendiente (supervisor/admin): aprobar crea `productos` + movimiento de ingreso; rechazar cierra sin efecto (FR-007) en `frontend/app/auditoria/supervisor/page.js`

**Checkpoint**: US1–US4 funcionan; recepción sin doble digitación.

---

## Phase 7: User Story 5 — Evidencia fotográfica offline (Priority: P2)

**Goal**: adjuntar foto a un conteo, guardarla offline y sincronizarla sin pérdida.

**Independent Test**: foto de pieza oxidada sin red → aparece en el dashboard vinculada al conteo correcto al reconectar.

- [x] T032 [US5] Captura de cámara + compresión ≤ 2MB (`frontend/lib/auditoria/imagen.js`) y encolado en `cola_fotos` con `client_op_id` en `frontend/app/auditoria/captura/page.js` (FR-008)
- [x] T033 [US5] Subida a Storage `evidencias` + fila `evidencias` idempotente en `frontend/lib/auditoria/offline/fotos.js` (resuelve `conteo_id` por `client_op_id` tras sincronizar el conteo)
- [x] T034 [US5] Mostrar la foto de evidencia (URL firmada) en el detalle del conteo rojo del dashboard en `frontend/app/auditoria/supervisor/page.js`

**Checkpoint**: US1–US5 funcionan; hallazgos documentados con foto.

---

## Phase 8: User Story 6 — Admin gestiona catálogo y usuarios (Priority: P3)

**Goal**: cargar catálogo con umbrales, gestionar usuarios web y configurar el sector.

**Independent Test**: cargar 50 piezas → reconocibles por voz en < 5 min; un auditor nuevo entra y ve solo su sede (SC-008).

- [x] T035 [US6] Carga de catálogo Excel/CSV (columnas: nombre, unidad_medida, referencia, stock_minimo, punto_reorden, stock_maximo) con validación por fila sin abortar las válidas en `frontend/app/auditoria/catalogo/page.js` (FR-013/FR-014)
- [x] T036 [P] [US6] Gestión de usuarios web: crear/listar usuario de Supabase Auth con `app_metadata` (`empresa_id`, `rol`, `tienda_id`) vía `frontend/app/api/auditoria/usuarios/route.js` (service role + guard admin) (research R2/R3)
- [x] T037 [P] [US6] Configuración del tenant (`meses_stock_muerto`, migración 031) en `frontend/app/auditoria/catalogo/page.js`, cableada al semáforo vía sync

**Checkpoint**: todas las historias del spec funcionan.

---

## Phase 9: Salidas/ventas (FR-021)

**Goal**: registrar salidas/ventas desde AuditorIA sobre el mismo ledger que el bot.

**Independent Test**: registrar una salida baja el stock (vía trigger); deshacer la revierte; el bot sigue registrando en paralelo (FR-020/FR-021).

- [x] T038 Registro de salida → INSERT `movimientos tipo='venta'`, `tienda_origen=tienda_id`, `client_op_id`, validando stock disponible, en `frontend/app/auditoria/salidas/page.js` (Constitución I/IV/V)
- [x] T039 Deshacer salida (ventana de 5 min) → DELETE del movimiento (reversión por trigger) en `frontend/app/auditoria/salidas/page.js`

**Checkpoint**: alcance v1 completo (auditoría + recepción + salidas).

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T040 [P] E2E Playwright de los escenarios de `quickstart.md` (1–7) en `tests/auditoria/` de la raíz
- [ ] T041 [P] Test de aislamiento multi-tenant (usuario A no lee datos de B por API) (SC-007)
- [ ] T042 Regresión: verificar que el bot de Telegram y el dashboard actual no cambian su comportamiento (FR-020)
- [ ] T043 Ejecutar la validación completa de `quickstart.md` y revisar contra Constitución IV/V (no se escribió `stock`, no hubo UPDATE de `movimientos`)
- [ ] T044 [P] Nota breve en `CLAUDE.md` sobre la sección `auditoria/` y sus reglas (sin duplicar el spec)
- [ ] T046 [P] Calibrar el umbral de similitud del fuzzy matching en `frontend/lib/auditoria/matching.js` contra un catálogo real, midiendo precisión de voz (meta SC-002: 90%) y de factura (meta SC-003: 85%); ajustar el corte y documentar el valor elegido (A1)
- [ ] T047 [P] Prueba de volumen/escala: catálogo de 2.000 piezas + 5 auditores concurrentes por sede; verificar sync del catálogo < 60s (SC-010) y dashboard sin degradación (SC-009) (G1)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Setup — **BLOQUEA todas las historias**. T011 depende de T007–T010; T014/T015 dependen de T004.
- **US1 (Phase 3)**: depende de Foundational. MVP.
- **US2 (Phase 4)**: depende de Foundational; se integra con US1 (T023 usa el flujo de captura).
- **US3 (Phase 5)**: depende de Foundational; lee lo que US1/US2 escriben.
- **US4 (Phase 6)**: depende de Foundational; T031 usa el panel de T027.
- **US5 (Phase 7)**: depende de Foundational; T034 usa el dashboard de US3.
- **US6 (Phase 8)**: depende de Foundational; su carga de catálogo mejora US1 pero US1 puede probarse con catálogo cargado a mano.
- **Salidas (Phase 9)**: depende de Foundational.
- **Polish (Phase 10)**: depende de las historias que se quieran validar.

### Parallel Opportunities

- Setup: T002, T003, T004, T005 en paralelo.
- Foundational: las migraciones T006–T010 y T045 en paralelo (archivos distintos); T011 (RLS) después de T007–T010. T013 en paralelo.
- US2: T021 y T022 en paralelo (motor + tests).
- US6: T036 y T037 en paralelo.
- Polish: T040, T041, T044 en paralelo.
- Con equipo: tras Foundational, US1–US6 pueden repartirse entre personas (cada historia es independientemente testeable).

---

## Implementation Strategy

### MVP (recomendado)

1. Phase 1 (Setup) → 2. Phase 2 (Foundational) → 3. Phase 3 (US1) → 4. Phase 4 (US2).
**Detenerse y validar**: captura por voz offline + semáforo, el corazón del producto. Desplegar/demostrar.

### Entrega incremental (un cambio a la vez — Constitución VI)

Setup+Foundational → US1 → US2 (MVP) → US3 → US4 → US5 → US6 → Salidas. Cada historia se prueba end-to-end y se confirma con el dueño antes de la siguiente. Las Edge Functions nuevas (si T028 usa una) requieren redeploy manual.

---

## Notes

- `[P]` = archivos distintos, sin dependencias.
- Etiqueta `[US#]` mapea la tarea a su historia para trazabilidad.
- Migraciones se aplican en orden numérico en el SQL Editor de Supabase; ninguna se edita tras aplicarse (se crea una nueva).
- No tocar `frontend/lib/supabase.js`, `frontend/lib/queries.js`, RLS existentes, ni el bot.
- Commit por tarea o grupo lógico; validar cada checkpoint antes de avanzar.
