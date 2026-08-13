# Feature Specification: AuditorIA — PWA de Auditoría de Inventario (Sector Autopartes)

**Feature Branch**: `002-auditoria-autopartes`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "AuditorIA para el sector autopartes (piezas de auto): PWA multi-tenant de auditoría de inventario adaptada desde el diseño existente de alimentos (specs/001-auditoria-ia). Reutiliza el negocio actual de AGENT GMS / Almacenero Digital (productos, usuarios, sedes, roles admin/vendedor). Captura por voz y por foto de factura, matching semántico de productos (pgvector), evidencia fotográfica offline, offline-first. Diferencia clave respecto a alimentos: el semáforo NO es sanitario/vencimiento sino sectorial para autopartes — redefinir su criterio (ej: stock crítico bajo mínimo, rotación lenta/stock muerto, daño físico/oxidación). El bot de Telegram de GMS debe seguir funcionando en paralelo sin cambios. Tres roles a mapear desde los actuales: Auditor, Supervisor, Admin."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Auditor cuenta piezas por voz en el almacén (Priority: P1)

El auditor recorre el almacén de autopartes con su teléfono instalado como aplicación. Para cada pieza que cuenta, presiona el botón de voz y dice el nombre y la cantidad ("quince amortiguadores delanteros"). El sistema lo identifica en el catálogo de la sede, muestra de inmediato su estado de semáforo (verde, amarillo o rojo) con la acción recomendada, y el auditor confirma con un toque. Todo esto funciona sin necesidad de internet.

**Why this priority**: Es el flujo principal del producto. Sin conteo por voz offline el sistema no entrega su propuesta de valor central. Todo lo demás depende de que esto funcione.

**Independent Test**: Un auditor puede completar el conteo de un pasillo entero — desde abrir la app hasta confirmar la última pieza — sin conexión a internet, y todos los conteos quedan registrados localmente listos para sincronizar.

**Acceptance Scenarios**:

1. **Given** el auditor está en el almacén sin señal de red, **When** presiona el botón de voz y dice "quince amortiguadores delanteros", **Then** el sistema identifica "Amortiguador Delantero" del catálogo, muestra el semáforo correspondiente y espera confirmación del auditor.
2. **Given** la pieza dicha no existe en el catálogo, **When** el auditor pronuncia un nombre no registrado, **Then** el sistema muestra las 3 piezas más parecidas para que el auditor elija manualmente.
3. **Given** el auditor confirma un conteo, **When** no hay conexión, **Then** el conteo se guarda localmente y se marca como "pendiente de sincronización", sin perder ningún dato.
4. **Given** el auditor recupera señal de red, **When** la app detecta conexión, **Then** sincroniza todos los conteos pendientes automáticamente, sin duplicar ningún registro.

---

### User Story 2 — El semáforo informa el estado de cada pieza (Priority: P1)

Al confirmar cada pieza contada, el auditor ve de inmediato si la pieza está sana (verde), requiere atención (amarillo) o representa un problema que debe resolverse (rojo). El semáforo de autopartes combina dos dimensiones: el **estado físico** de la pieza (íntegra, deterioro menor recuperable, daño/oxidación no vendible) y la **salud de inventario** (stock frente a su mínimo y su rotación). Junto al color, el sistema explica el motivo, indica la acción a tomar y sugiere una estrategia de recuperación de valor cuando aplica (reacondicionar, devolver a proveedor, liquidar stock muerto).

**Why this priority**: El semáforo es el diferenciador clave del producto. Sin él, la app es solo un contador; con él, es una herramienta de gestión de inventario que detecta quiebres de stock, capital inmovilizado y mermas físicas en el momento del conteo.

**Independent Test**: Dada una pieza con stock por debajo de su mínimo y empaque íntegro, el sistema devuelve "amarillo — stock bajo el mínimo, reponer" sin conexión a internet, en menos de 2 segundos.

**Acceptance Scenarios**:

1. **Given** una pieza cuyo stock contado queda por debajo del mínimo crítico definido, **When** el auditor la confirma, **Then** el semáforo muestra rojo, la razón indica "quiebre de stock (bajo mínimo)" y la acción sugiere "reponer con urgencia / generar pedido a proveedor".
2. **Given** una pieza con signos de oxidación o daño físico, independientemente de su nivel de stock, **When** el auditor la registra con estado físico "dañada/oxidada", **Then** el semáforo muestra rojo con acción "separar del stock vendible" y propone reacondicionamiento o devolución a proveedor como estrategia de recuperación de valor.
3. **Given** una pieza sin movimiento de salida en los últimos 6 meses (stock muerto), **When** el auditor la confirma, **Then** el sistema muestra amarillo con razón "baja rotación / capital inmovilizado" y sugiere liquidación o promoción.
4. **Given** una pieza íntegra con stock dentro de su rango saludable, **When** el auditor la confirma, **Then** el semáforo muestra verde sin acción pendiente.

---

### User Story 3 — Supervisor ve el estado del inventario en tiempo real (Priority: P2)

El supervisor accede al dashboard desde su tablet o computador y ve en tiempo real cuántas piezas están en cada estado del semáforo, qué sedes tienen alertas críticas (quiebres de stock, piezas dañadas), y el progreso del auditor en turno. Al cerrar una sesión, puede ver un resumen con los hallazgos más importantes.

**Why this priority**: El supervisor es quien toma decisiones de gestión (reponer, liquidar, reclamar a proveedor) basadas en los datos capturados. Sin dashboard, los datos existen pero nadie actúa sobre ellos.

**Independent Test**: Un supervisor puede abrir el dashboard, identificar todas las piezas en rojo de la sede principal, y ver la foto de evidencia adjunta — todo en menos de un minuto desde que el auditor las registró.

**Acceptance Scenarios**:

1. **Given** el auditor ha registrado 3 piezas en rojo en los últimos 10 minutos, **When** el supervisor abre el dashboard, **Then** ve un contador de alertas críticas actualizado y puede hacer clic para ver el detalle de cada una.
2. **Given** una sesión de auditoría está activa, **When** el supervisor la cierra, **Then** el sistema genera un resumen con total de ítems por color, acciones pendientes y (si hay internet) un párrafo ejecutivo con los hallazgos más relevantes.
3. **Given** hay piezas pendientes de aprobación, **When** el supervisor accede al panel de aprobaciones, **Then** ve la lista de piezas nuevas detectadas en facturas, con la descripción extraída, y puede aprobar o rechazar cada una.

---

### User Story 4 — Auditor recibe mercadería fotografiando la factura (Priority: P2)

Cuando llega un pedido a la sede, el auditor fotografía la factura de compra. El sistema lee automáticamente las piezas, cantidades y precios de la factura y los compara con el catálogo. El auditor revisa cada ítem en pantalla, corrige lo que sea necesario, y confirma la recepción. Las piezas que no están en el catálogo quedan marcadas para aprobación del admin o supervisor.

**Why this priority**: Elimina la doble digitación en la recepción de mercadería, que es donde ocurre la mayoría de los errores de inventario. Es el segundo flujo de mayor valor después de la auditoría.

**Independent Test**: Un auditor fotografía una factura de 10 piezas, el sistema identifica correctamente al menos 8, y el auditor puede corregir y confirmar las 2 restantes en menos de 3 minutos total.

**Acceptance Scenarios**:

1. **Given** el auditor fotografía una factura con 10 piezas, **When** el sistema la procesa, **Then** muestra una tarjeta de revisión con cada ítem extraído, la pieza del catálogo sugerida y la cantidad, esperando confirmación del auditor.
2. **Given** una pieza de la factura no está en el catálogo, **When** el sistema no encuentra coincidencia, **Then** muestra la descripción extraída marcada como "pendiente de aprobación" y no la registra como inventario hasta que admin/supervisor la apruebe.
3. **Given** la foto de la factura tiene mala iluminación, **When** el sistema no puede leer un ítem con certeza, **Then** lo muestra con un indicador de baja confianza y solicita corrección manual del auditor antes de confirmar.
4. **Given** el auditor confirma toda la recepción, **When** se registra en el sistema, **Then** los ítems aprobados se suman al inventario y la foto de la factura queda archivada como respaldo del movimiento.

---

### User Story 5 — Auditor adjunta foto de evidencia a hallazgos (Priority: P2)

Cuando el auditor encuentra una pieza con empaque dañado, oxidación, golpe o cualquier hallazgo que requiera documentación, puede tomar una foto directamente desde la app y adjuntarla al registro del ítem. Esta foto queda asociada al conteo y el supervisor puede verla en el dashboard.

**Why this priority**: La evidencia fotográfica transforma el reporte de hallazgos de subjetivo a documentado, esencial para reclamos a proveedor, decisiones de descarte y trazabilidad de mermas.

**Independent Test**: Un auditor sin señal de red toma una foto de una pieza oxidada, la adjunta al ítem, y al reconectarse la foto aparece en el dashboard del supervisor vinculada al registro correcto.

**Acceptance Scenarios**:

1. **Given** un ítem recibe semáforo rojo por daño físico, **When** el auditor decide adjuntar evidencia, **Then** la app activa la cámara, toma la foto y la vincula al registro del ítem sin interrumpir el flujo de captura.
2. **Given** el auditor está sin conexión, **When** adjunta una foto de evidencia, **Then** la foto se guarda localmente y la app muestra un aviso de "foto pendiente de sincronización" hasta que haya red.
3. **Given** hay fotos de evidencia pendientes de sincronización, **When** el auditor cierra la app sin conectarse, **Then** al reabrirla el sistema recuerda las fotos pendientes y las sube automáticamente al recuperar señal.

---

### User Story 6 — Admin gestiona el catálogo de piezas y usuarios (Priority: P3)

El administrador carga el listado de piezas de la sede, con su nombre, unidad de medida, código/referencia, stock mínimo y punto de reorden. Desde ese momento el sistema puede reconocer esas piezas por voz y por foto de factura. El admin también gestiona qué personas tienen acceso al sistema y con qué rol.

**Why this priority**: El catálogo es el insumo que hace funcionar el matching de voz y facturas, y provee los umbrales (mínimo, reorden) que alimentan el semáforo. Sin él no hay nada que reconocer ni contra qué comparar. Se hace una sola vez al configurar el tenant, por eso es P3 en uso continuo pero P1 en onboarding.

**Independent Test**: El admin carga un archivo con 50 piezas, todas quedan listas para ser reconocidas por voz en menos de 5 minutos, y un auditor puede encontrar correctamente "Amortiguador Delantero Corolla" diciendo "amortiguador" o "amortiguador delantero".

**Acceptance Scenarios**:

1. **Given** el admin carga una lista de piezas, **When** el proceso de carga termina, **Then** todas quedan disponibles para búsqueda por voz y las nuevas piezas tienen su capacidad de reconocimiento activa automáticamente.
2. **Given** el admin aprueba una pieza nueva detectada en una factura, **When** la aprueba con nombre, unidad, referencia y umbrales, **Then** la pieza se incorpora al catálogo y queda disponible para futuros reconocimientos de voz y factura.
3. **Given** el admin invita a un nuevo auditor, **When** el auditor accede por primera vez, **Then** ve únicamente las funciones correspondientes a su rol y los datos de la sede a la que pertenece, sin acceso a datos de otros tenants.

---

### Edge Cases

- ¿Qué pasa cuando la voz capta ruido de fondo del taller (compresores, herramienta neumática, motores)?
- ¿Cómo maneja el sistema una pieza contada dos veces en la misma sesión? → Ambos conteos se guardan como registros independientes. El supervisor los ve en el dashboard y decide si hay discrepancia real o duplicado accidental. No hay bloqueo automático.
- ¿Qué ocurre si el auditor confirma una recepción de factura y luego no hay internet para sincronizar?
- ¿Cómo se comporta el semáforo cuando una pieza no tiene stock mínimo ni punto de reorden definidos en el catálogo? → El semáforo evalúa solo la dimensión de estado físico; la dimensión de salud de inventario se marca como "sin umbral definido" y no dispara alertas de stock.
- El formato de audio de MediaRecorder varía por plataforma (webm/opus en Chrome, mp4/aac en Safari iOS) — el sistema lo maneja preservando el mimeType original sin conversión cliente.
- ¿Qué pasa si la foto de evidencia pesa más de lo que el almacenamiento local del dispositivo puede guardar?
- ¿Cómo distingue el sistema dos piezas con nombre casi idéntico pero referencia distinta (ej. filtro de aceite de dos modelos)? → La referencia/código forma parte de la clave de unicidad; el matching por voz muestra ambas opciones cuando el nombre es ambiguo.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir registrar el conteo de una pieza por voz sin requerir conexión a internet en ningún paso del flujo de auditoría.
- **FR-002**: El sistema DEBE clasificar cada pieza auditada con un color de semáforo (verde, amarillo, rojo), razón, acción sugerida y —cuando aplique— estrategia de recuperación de valor, sin conexión a internet.
- **FR-003**: El semáforo del sector autopartes DEBE evaluar la pieza combinando **dos dimensiones**: (1) el **estado físico** de la pieza (íntegra, deterioro menor recuperable, dañada/oxidada no vendible) y (2) la **salud de inventario** (stock contado frente a su mínimo y punto de reorden, más rotación / stock muerto). El color final es el peor de ambas dimensiones (ej. una pieza dañada es roja aunque su stock esté sano). Las reglas, umbrales y campos capturados DEBEN ser configurables por sector, de modo que sectores adicionales usen reglas diferentes sin cambiar la arquitectura del sistema.
- **FR-004**: El sistema DEBE reconocer piezas por nombre aproximado o parcial, no solo por coincidencia exacta, tanto en captura por voz como en lectura de facturas.
- **FR-005**: El sistema DEBE procesar una foto de factura y extraer automáticamente las piezas, cantidades y precios listados en ella.
- **FR-006**: El sistema DEBE presentar al auditor una pantalla de revisión ítem por ítem antes de registrar cualquier recepción de mercadería; ningún ítem se registra sin confirmación explícita del auditor.
- **FR-007**: El sistema DEBE bloquear el ingreso al catálogo de cualquier pieza nueva detectada en facturas hasta que admin o supervisor la apruebe explícitamente.
- **FR-008**: El sistema DEBE permitir adjuntar una foto de evidencia a cualquier ítem auditado, y guardarla localmente cuando no hay internet, sincronizándola automáticamente al recuperar conexión.
- **FR-009**: El sistema DEBE garantizar que ningún usuario acceda a datos de un tenant diferente al suyo, ni en la interfaz ni por API.
- **FR-010**: El sistema DEBE mostrar al auditor un indicador visible cuando hay conteos o fotos pendientes de sincronización.
- **FR-011**: El sistema DEBE ser instalable como aplicación en dispositivos móviles Android e iOS sin requerir descarga desde una tienda de aplicaciones.
- **FR-012**: El supervisor DEBE poder ver en tiempo real el estado del inventario auditado, las alertas críticas y las fotos de evidencia sin necesidad de que el auditor le envíe nada manualmente.
- **FR-013**: El admin DEBE poder cargar o actualizar el catálogo de piezas mediante la subida de un archivo Excel o CSV con columnas predefinidas (nombre, unidad de medida, referencia/código, stock_minimo, punto_reorden). Los cambios DEBEN estar disponibles para reconocimiento por voz y factura en menos de 10 minutos tras la carga.
- **FR-014**: El sistema DEBE validar el archivo cargado antes de procesarlo, informando al admin de filas con errores (columnas faltantes, valores no numéricos en umbrales) sin detener la importación de las filas válidas restantes.
- **FR-015**: Cuando dos auditores registran la misma pieza en una misma sesión, el sistema DEBE guardar ambos conteos como registros independientes y marcarlo como "conteo duplicado" en el dashboard del supervisor para su revisión.
- **FR-016**: Cuando no hay conexión al momento de capturar por voz, el sistema DEBE grabar el audio, guardarlo localmente junto con su `mimeType` (sin convertir el formato), y mostrar al auditor un estado explícito de "grabado — pendiente de procesar". La UI NUNCA debe mostrar una confirmación de registro exitoso hasta que el servicio de transcripción procese el audio.
- **FR-017**: La cola de audios pendientes DEBE vaciarse automáticamente al detectar el evento `online` del navegador y al abrir la app (flush en arranque). No depender únicamente de reintentos temporizados.
- **FR-018**: El sistema DEBE preservar el `mimeType` del audio grabado (webm/opus en Chrome, mp4/aac en Safari iOS) y enviarlo sin modificación al servicio de transcripción. No se realiza ninguna conversión de formato en el cliente.
- **FR-019**: El sistema DEBE registrar el estado físico de cada pieza contada (al menos: íntegra, deterioro menor, dañada/oxidada) como parte del conteo, ya que alimenta el color del semáforo.
- **FR-020**: AuditorIA DEBE operar sin modificar ni interrumpir el bot de Telegram existente de GMS. Ambos productos comparten el negocio (piezas, sedes, usuarios) y el mismo ledger `movimientos`, pero AuditorIA no altera el comportamiento del bot.
- **FR-021**: AuditorIA DEBE permitir registrar salidas/ventas de inventario además de la auditoría y la recepción, escribiendo sobre el mismo ledger `movimientos` que usa el bot de Telegram. El registro de salidas DEBE respetar las mismas reglas de negocio del ledger (stock disponible, `tienda_id` obligatorio) que aplica el bot, para que ambos canales sean consistentes.

### Key Entities *(include if feature involves data)*

- **Tenant**: Empresa (negocio de autopartes) que usa el sistema. Tiene catálogo propio, usuarios propios, sedes, sector configurado (`autopartes`) y datos completamente aislados de otros tenants.
- **Usuario**: Persona con acceso al sistema. Pertenece a un tenant. Tiene un rol (Auditor, Supervisor, Admin) que determina qué puede ver y hacer.
- **Sede**: Local o bodega física del tenant donde se realiza la auditoría. Un usuario opera dentro de una sede asignada.
- **Pieza (Producto)**: Ítem del catálogo del tenant. Tiene nombre, unidad de medida, referencia/código, stock mínimo, punto de reorden, y capacidad de ser reconocida por voz y por foto. La combinación `(tenant_id, referencia)` —o `(tenant_id, nombre, unidad_de_medida)` cuando no hay referencia— es la clave de unicidad.
- **Sesión de auditoría**: Período de conteo en una sede o zona específica. Tiene un estado (abierta/cerrada), un responsable supervisor y un conjunto de conteos.
- **Conteo**: Registro de una pieza auditada dentro de una sesión. Incluye cantidad contada, estado físico, observación, resultado del semáforo (color + razón + acción) y foto de evidencia opcional.
- **Recepción**: Evento de ingreso de mercadería, originado en una foto de factura. Contiene los ítems extraídos, sus estados de aprobación y la foto de respaldo.
- **Pieza pendiente**: Pieza detectada en una factura que no existe en el catálogo. Requiere aprobación de admin/supervisor para integrarse al sistema.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El auditor completa el registro de una pieza (desde presionar el botón de voz hasta confirmar el semáforo) en menos de 15 segundos en condiciones normales.
- **SC-002**: El 90% de las piezas dichas por voz son identificadas correctamente en el catálogo sin corrección manual del auditor.
- **SC-003**: El 85% de las piezas en una factura son identificadas y pre-asignadas correctamente antes de la revisión manual del auditor.
- **SC-004**: El flujo completo de auditoría (captura + semáforo) funciona sin internet el 100% del tiempo. Cero interrupciones por falta de conexión en el flujo principal.
- **SC-005**: Las fotos de evidencia tomadas offline se sincronizan exitosamente en el 100% de los casos al recuperar conexión, sin pérdida de datos.
- **SC-006**: El supervisor ve los conteos del auditor en el dashboard en menos de 30 segundos desde que el auditor los sincroniza.
- **SC-007**: El 100% de los datos de un tenant son inaccesibles para usuarios de otro tenant, verificable en auditoría de seguridad.
- **SC-008**: Un negocio nuevo puede tener su catálogo cargado y su primer auditor operativo en menos de 30 minutos desde el registro.
- **SC-009**: El sistema soporta hasta 2.000 piezas en el catálogo de un tenant y hasta 5 auditores activos simultáneos por sede sin degradación de rendimiento en el dashboard ni en el matching semántico.
- **SC-010**: El catálogo completo (con embeddings) cabe en el almacenamiento local del dispositivo y se sincroniza al iniciar sesión en menos de 60 segundos con conexión estándar.
- **SC-011**: El semáforo detecta el 100% de los quiebres de stock (piezas contadas por debajo de su mínimo definido) en el momento del conteo, sin conexión.

---

## Clarifications

### Session 2026-08-13

- Q: ¿Qué evalúa el semáforo del sector autopartes en la v1? → A: Combina **ambas** dimensiones — estado físico de la pieza (íntegra / deterioro menor / dañada-oxidada) **y** salud de inventario (stock vs mínimo/reorden + rotación / stock muerto). El color final es el peor de las dos dimensiones. Implica que el auditor marca el estado físico en cada conteo (FR-019) y que el catálogo carga umbrales de stock (FR-013).
- Q: ¿AuditorIA comparte la misma base de datos y catálogo que GMS o mantiene datos separados? → A: **Misma DB compartida.** AuditorIA lee/escribe sobre las tablas existentes de GMS (`productos`, `tiendas`, `usuarios`, `movimientos`) y agrega solo tablas nuevas propias (sesiones de auditoría, conteos, evidencia, piezas pendientes). El bot de Telegram sigue operando sin cambios sobre las mismas tablas.
- Q: ¿AuditorIA registra salidas/ventas o solo auditoría + recepción? → A: **También registra salidas/ventas.** El alcance v1 incluye auditoría (conteo + semáforo), recepción por factura Y registro de salidas/ventas. AuditorIA y el bot de Telegram escriben ambos sobre el mismo ledger `movimientos`; el bot sigue funcionando sin cambios.
- Q: ¿Cuántos meses sin movimiento de salida definen "stock muerto" (amarillo)? → A: **6 meses.** Una pieza sin salidas en los últimos 6 meses se marca amarillo por baja rotación. Umbral configurable por tenant a futuro.
- Q: ¿Cómo inician sesión los usuarios en la PWA de AuditorIA, si GMS los identifica por Telegram? → A: **Email + contraseña vía Supabase Auth**, el mismo sistema del dashboard actual de GMS. El admin invita/crea al usuario en Supabase Auth con `empresa_id`, `rol` y `tienda_id` en `app_metadata`. La tabla `usuarios` (de Telegram, sin columna email) **NO** se reutiliza para el login web; el vínculo entre GMS y AuditorIA es el **tenant (`empresa_id`)**, no la persona. La vinculación con `telegram_id` no es requisito de la v1.

## Assumptions

- Los auditores usan dispositivos móviles modernos (Android 10+ o iOS 14+) con micrófono funcional y cámara.
- El negocio tiene un catálogo de piezas digitalizable (lista en papel, Excel o sistema existente). El admin realiza la carga inicial —incluyendo stock mínimo y punto de reorden— antes de que los auditores empiecen a usar el sistema.
- **El semáforo de autopartes NO usa fecha de vencimiento ni criterio sanitario.** Su color surge de estado físico de la pieza y salud de inventario (stock vs umbrales, rotación). El detalle exacto se confirma en FR-003.
- La "estrategia de recuperación de valor" reemplaza a la "economía circular" de alimentos: reacondicionar, devolver a proveedor, o liquidar stock muerto. Es informativa; nunca bloquea una decisión operativa del supervisor.
- **Mapeo de roles desde GMS**: el `vendedor` actual de GMS corresponde al rol **Auditor** (captura en campo); el `admin` de GMS se desdobla en **Supervisor** (gestión/aprobaciones) y **Admin** (catálogo/usuarios/configuración). El mapeo definitivo de permisos se detalla en el plan.
- **AuditorIA reutiliza el negocio de GMS pero es un producto separado del bot de Telegram.** El bot sigue operando sin cambios; AuditorIA es la PWA nueva. AuditorIA y GMS comparten la **misma base de datos**: AuditorIA usa las tablas existentes (`productos`, `tiendas`, `usuarios`, `movimientos`) y agrega tablas nuevas propias para auditoría (sesiones, conteos, evidencia, piezas pendientes). No hay migración ni sincronización entre bases.
- La recepción de mercadería por foto de factura requiere conexión a internet (la extracción de texto de imágenes no funciona offline).
- Los usuarios se autentican con **email y contraseña vía Supabase Auth** (el mismo mecanismo del dashboard actual de GMS). El admin invita/crea al usuario en Supabase Auth con la identidad de tenant (`empresa_id`, `rol`, `tienda_id`) en `app_metadata`. La tabla `usuarios` (Telegram, sin email) **NO** se usa para el login web; el vínculo GMS↔AuditorIA es el `empresa_id`. Autenticación social y vínculo con Telegram son alcance futuro.
- Un usuario pertenece a un único tenant en v1.
- Las fotos de evidencia se comprimen automáticamente antes de guardarse (máximo 2MB por foto después de compresión) para no exceder los límites de almacenamiento local.
- La rotación / "stock muerto" se calcula a partir del historial de movimientos existente del negocio (ledger de GMS). Umbral: **6 meses sin salida** = stock muerto (amarillo), configurable por tenant a futuro.
