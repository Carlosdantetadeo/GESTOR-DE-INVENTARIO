# Phase 0 — Research: AuditorIA Autopartes

Resuelve los puntos técnicos abiertos del spec y del Technical Context. Cada decisión lista: qué se eligió, por qué, y qué se descartó.

---

## R1. Ubicación del código: ¿app nueva o dentro del `frontend/` existente?

- **Decisión**: route group `frontend/app/auditoria/` dentro de la app Next.js existente, con manifest y service worker propios.
- **Rationale**: La clarificación fijó **misma DB**. Reutilizar la misma app reutiliza también el cliente Supabase, la auth con `app_metadata`, las variables de entorno y el despliegue automático en Vercel. Cero duplicación de infra. La sección es aislable (su propia carpeta y libs) y no toca el dashboard ni el bot.
- **Alternativas descartadas**:
  - *App/repo separado*: duplicaría auth, env, deploy y cliente Supabase; contradice "reutiliza el negocio actual" y agrega mantenimiento (Constitución VII).
  - *Monorepo Turborepo*: sobre-ingeniería para un equipo mínimo; migrar el `frontend/` actual a workspaces es un cambio grande no pedido.

## R2. Identidad y autenticación de usuarios

- **Contexto**: La tabla `usuarios` es **basada en Telegram** (`telegram_id UNIQUE NOT NULL`, sin columna email) y sirve al bot. El dashboard web usa **Supabase Auth** con `empresa_id`/`rol` en `app_metadata`.
- **Decisión**: Los usuarios de AuditorIA son **usuarios de Supabase Auth** (email + contraseña), con `empresa_id`, `rol` (`auditor`/`supervisor`/`admin`) y `tienda_id` en `app_metadata`. **No** se reutiliza la fila de `usuarios` (Telegram) para login; el vínculo entre ambos mundos es el `empresa_id` (tenant), no la persona.
- **Matiz sobre la clarificación Q4**: se confirma email+contraseña vía Supabase Auth (como el dashboard), pero el "vínculo por email al registro existente de `usuarios`" no aplica porque esa tabla no tiene email ni representa cuentas web. El admin **crea/invita** al usuario web; opcionalmente se guarda su `tienda_id`.
- **Autoría de `movimientos`**: `movimientos.usuario_id` referencia la tabla Telegram (BIGINT, **nullable**). Las salidas/recepciones creadas desde AuditorIA se insertan con `usuario_id = NULL` y la autoría real (auth uid del auditor) se guarda en la tabla nueva `conteos`/`recepciones`. Así no se contamina la semántica del ledger ni se fuerzan filas Telegram falsas.
- **Alternativas descartadas**: crear filas `usuarios` Telegram "fantasma" para cada usuario web (rompe la unicidad de `telegram_id` y ensucia el modelo); usar `user_metadata` (prohibido por Constitución III).

## R3. Rol de negocio → autorización

- **Decisión**: tres roles en `app_metadata.rol`:
  - **auditor**: captura por voz, recepción, salidas, evidencia. Scoped a su `tienda_id`.
  - **supervisor**: todo lo del auditor + dashboard tiempo real, aprobar/rechazar piezas pendientes, cerrar sesiones. Ve todas las sedes de su empresa.
  - **admin**: todo lo del supervisor + gestión de catálogo y de usuarios + configuración de umbrales.
- **Rationale**: Mapea el binario `admin/vendedor` de GMS (vendedor→auditor; admin→supervisor+admin) sin tocar el rol del bot. La aprobación de piezas nuevas queda en supervisor/admin (FR-007).

## R4. Matching de productos: ¿pgvector o fuzzy on-device?

- **Decisión v1**: **fuzzy matching en el dispositivo** (normalización de texto + similitud por trigramas/Levenshtein en JS) sobre el catálogo sincronizado en IndexedDB. Sin pgvector.
- **Rationale**: El flujo de auditoría por voz es **offline-first** (FR-001). Un índice pgvector vive en el servidor y no está disponible sin red, por lo que **no puede** ser el motor del matching offline. El fuzzy local resuelve el 90% de los casos (SC-002) con catálogos ≤ 2.000 piezas que caben en IndexedDB (SC-010). La referencia/código de la pieza da desempate exacto.
- **Para recepción por factura (online)**: el matching corre server-side sobre el texto extraído; en v1 se usa el **mismo fuzzy** (o `pg_trgm` con `similarity()` en Postgres, extensión estándar de Supabase) — más simple que embeddings y suficiente para SC-003.
- **Alternativas descartadas**: pgvector + embeddings (Groq/OpenAI) — potente pero (a) inútil offline, (b) agrega pipeline de generación/actualización de embeddings y una dependencia de proveedor, (c) sobre-ingeniería para 2.000 ítems. Se documenta como **mejora futura** si el fuzzy no alcanza los KPIs.
- **Nota de alcance**: esto se aparta de la mención inicial "matching semántico (pgvector)" del prompt; el tradeoff (offline gana sobre semántica) se hace explícito aquí para revisión del dueño.

## R5. Transcripción de voz y OCR de facturas

- **Decisión**: reutilizar **Groq** (Whisper para voz, Vision para facturas), el mismo proveedor y patrón que ya usa el bot de Telegram. La API key vive en secretos server-side (Edge Function `auditoria-ocr` o ruta API del backend), **nunca en el cliente** (Constitución: `SERVICE_ROLE_KEY`/keys fuera del frontend).
- **Voz offline**: se graba el audio con `MediaRecorder`, se guarda en IndexedDB con su `mimeType` sin conversión (FR-016/018) y se encola; la transcripción ocurre al recuperar red. La UI nunca muestra "registrado" antes de que Groq procese (FR-016).
- **Alternativas descartadas**: Web Speech API del navegador (inconsistente entre iOS/Android y requiere red igual); transcripción on-device (modelos pesados, fuera de alcance).

## R6. Motor de semáforo (determinista, on-device)

- **Decisión**: función pura `evaluarSemaforo(pieza, conteo, config)` en `lib/auditoria/semaforo.js`, sin I/O, testeable en aislamiento. Devuelve `{ color, razon, accion, estrategia }`.
- **Reglas v1 (sector autopartes)** — el color final es el **peor** de las dos dimensiones (clarificación Q1):
  - **Estado físico** (lo marca el auditor): `integra`→verde · `deterioro_menor`→amarillo · `dañada_oxidada`→rojo.
  - **Salud de inventario** (calculada): `cantidad < stock_minimo`→rojo (quiebre) · `stock_minimo ≤ cantidad < punto_reorden`→amarillo (reponer) · sin salida en **6 meses**→amarillo (stock muerto) · en rango sano→verde.
  - Si la pieza no tiene umbrales definidos, la dimensión de inventario se omite (solo cuenta estado físico) — ver Edge Cases del spec.
- **Estrategia de recuperación de valor** (informativa): dañada→reacondicionar/devolver a proveedor; stock muerto→liquidar/promocionar. Nunca bloquea al supervisor.
- **Datos de rotación offline**: la "última salida" de cada pieza se precalcula server-side y se **sincroniza con el catálogo** (campo `ultima_salida_at` por `producto_id`+`tienda_id`), para que el semáforo funcione sin consultar el ledger en vivo. Se recalcula en cada sync.
- **Rationale**: Determinismo = testeable, rápido (<2s, SC-011) y 100% offline (FR-002).

## R7. Sincronización offline e idempotencia

- **Decisión**: IndexedDB con tres stores: `catalogo` (piezas + umbrales + `ultima_salida_at`), `cola_conteos`, `cola_fotos`. El `syncEngine` hace flush **en el evento `online` y en el arranque de la app** (FR-017), no solo por timers.
- **Idempotencia**: cada conteo/salida/foto lleva un **UUID generado en el cliente** (`client_op_id`). El servidor deduplica por ese id (constraint UNIQUE), de modo que un reintento nunca duplica un `movimiento` ni un `conteo`. Mismo principio que la dedupe por `update_id` del bot (Constitución: webhook dedupe).
- **Alternativas descartadas**: Background Sync API (soporte irregular en iOS Safari); depender solo de reintentos temporizados (FR-017 lo prohíbe explícitamente).

## R8. Almacenamiento de fotos de evidencia

- **Decisión**: bucket nuevo de Supabase Storage `evidencias`, con path `{empresa_id}/{sesion_id}/{conteo_id}/{uuid}.jpg`. Compresión en cliente a ≤ 2MB antes de encolar (Assumptions del spec). Offline: el blob se guarda en `cola_fotos` y se sube al reconectar (FR-008).
- **RLS de Storage**: policy por `empresa_id` derivado del path/metadata, consistente con el aislamiento multi-tenant.
- **Alternativas descartadas**: guardar fotos como base64 en la tabla (infla la DB y rompe el límite de fila); bucket público (fuga cross-tenant).

## R9. PWA instalable + offline app shell

- **Decisión**: Web App Manifest (`auditoria-manifest.json`) + Service Worker (`auditoria-sw.js`) que cachea el app shell de `/auditoria`. Instalable en Android (Chrome) e iOS (Safari "Agregar a inicio") sin tienda (FR-011).
- **Rationale**: Requisito directo de FR-011. Se limita el scope del SW a `/auditoria/*` para no interferir con el dashboard/landing existentes.
- **Alternativas descartadas**: app nativa (fuera de alcance, requiere tiendas); `next-pwa` (dependencia extra; un SW mínimo propio basta y es más transparente).

## R10. Salidas/ventas desde AuditorIA (FR-021)

- **Decisión**: registrar salida = INSERT en `movimientos` con `tipo='venta'`, `producto_id`, `tienda_origen=tienda_id`, `cantidad`, `precio_unitario`. El trigger descuenta stock. Deshacer = DELETE (ventana corta), igual patrón que el bot.
- **Consistencia con el bot**: ambos canales usan el mismo ledger y trigger; no hay lógica de stock duplicada. `tienda_id` obligatorio (Constitución I).
- **Alternativas descartadas**: tabla de ventas propia de AuditorIA (fragmentaría la fuente de verdad del stock, viola Constitución IV/V).

---

## Unknowns restantes

Ninguno bloqueante para el diseño. Se registran como decisiones a validar en implementación/pruebas, no como clarificaciones de spec:

- Umbral de similitud fuzzy exacto (se calibra contra SC-002/SC-003 en pruebas con catálogo real).
- Si la OCR corre en Edge Function dedicada o en ruta API del frontend (se decide en `tasks.md` según dónde vivan hoy las keys de Groq).
