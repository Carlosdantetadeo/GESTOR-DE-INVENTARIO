# SPECKIT — AuditorIA

Especificación del proyecto en formato Spec Kit (spec-driven development).
Proyecto nuevo, separado de ALMACENERO DIGITAL.
Última actualización: 2026-08-09.

---

## 1. Constitución (principios no negociables)

1. **Aislamiento multi-tenant es sagrado.** Todo dato pertenece a un `tenant`. Ningún cambio puede permitir lectura o escritura cross-tenant. `tenant_id` es obligatorio en todo INSERT.
2. **RLS no se toca sin instrucción explícita.** Las policies son el perímetro de seguridad. Las Edge Functions usan `SERVICE_ROLE_KEY` y deben validar `tenant_id` explícitamente.
3. **`app_metadata`, nunca `user_metadata`.** `user_metadata` es editable por el usuario y puede causar escalación cross-tenant.
4. **Offline-first no es opcional.** El flujo de auditoría (voz → semáforo) y las fotos de evidencia deben funcionar sin internet. La conectividad es oportunista: se usa cuando está disponible, nunca se bloquea cuando no lo está. Excepción aceptada: la recepción de mercadería por foto de factura requiere red (Groq Vision).
5. **La seguridad alimentaria siempre gana.** Ninguna sugerencia de economía circular puede anular una decisión de rojo por riesgo sanitario real. El semáforo local (determinista) corre siempre; Claude (insights) corre solo si hay red.
6. **El semáforo es por sector.** Las reglas de clasificación, umbrales y campos capturados cambian según el sector. Hoy implementamos solo `alimentos`. Nuevos sectores se agregan como configuración, no como código nuevo.
7. **Ningún producto nuevo entra al catálogo sin aprobación.** Productos detectados por Groq Vision que no existen en el catálogo quedan en estado `pendiente`. Solo admin o supervisor pueden aprobarlos. El auditor puede confirmar la descripción en pantalla pero no tiene poder de aprobación final.
8. **Un cambio a la vez, confirmado antes de continuar.** Proyecto comercial activo con clientes reales desde el primer deploy.
9. **Simplicidad primero.** Sin abstracciones especulativas ni features no pedidas.

---

## 2. Especificación funcional (el QUÉ)

### 2.1 Producto

**AuditorIA** es una PWA multi-tenant con dos módulos operativos: **auditoría de inventario** (qué hay en bodega y en qué estado) y **recepción de mercadería** (qué ingresa y qué dice la factura). Captura por voz y por foto, semáforo sanitario/sectorial con IA, matching semántico de productos y evidencia fotográfica de hallazgos.

Primer sector: **Alimentos y Bebidas en hotelería** (normas INVIMA/sanitarias colombianas).
Arquitectura preparada para escalar a ferretería, farmacia y otros sectores.

### 2.2 Actores

| Actor | Canal | Capacidades |
|-------|-------|-------------|
| **Auditor** | PWA móvil (campo) | Capturar por voz, recibir mercadería por foto de factura, tomar fotos de evidencia, ver semáforo por ítem, confirmar/corregir, trabajar offline |
| **Supervisor** | PWA desktop/tablet | Dashboard en tiempo real, aprobar productos nuevos, validar conteos, cerrar sesiones, ver KPIs y alertas |
| **Admin** | PWA desktop | Gestionar catálogo + embeddings, aprobar productos nuevos, gestionar usuarios, configurar sector y reglas |

### 2.3 Historias de usuario

**Módulo A — Auditoría de inventario**

- **US-01 — Captura por voz:** Como auditor en campo, presiono el botón de voz, digo el producto y cantidad ("20 litros de leche"), el sistema transcribe (Groq Whisper), identifica el producto en el catálogo (pgvector), muestra una tarjeta de confirmación con el semáforo y espera mi tap para confirmar.
- **US-02 — Semáforo inmediato:** Como auditor, al confirmar un ítem veo al instante el color (verde/amarillo/rojo), la razón, la acción sugerida y la estrategia de economía circular si aplica. Todo corre localmente sin internet.
- **US-03 — Trabajo offline:** Como auditor en área sin señal, capturo y confirmo ítems normalmente. El sistema encola y sincroniza al reconectar.
- **US-04 — Evidencia fotográfica:** Como auditor, al encontrar un ítem rojo o dudoso puedo adjuntar una foto (empaque roto, producto no conforme, etiqueta de caducidad como prueba). La foto se guarda localmente offline y se sube a Supabase Storage al reconectar. El supervisor la ve en el detalle del conteo.
- **US-05 — Sesión de auditoría:** Como supervisor, abro una sesión por bodega/área; el auditor captura durante el turno; al cerrar veo el resumen: ítems por color, acciones pendientes, fotos de evidencia e insights ejecutivos (IA).
- **US-06 — Dashboard supervisor:** Como supervisor, veo KPIs en tiempo real: total ítems por color, alertas críticas, progreso por bodega, comparativa respecto a sesiones anteriores.

**Módulo B — Recepción de mercadería**

- **US-07 — Recepción por foto de factura:** Como auditor, fotografío la factura de compra que llegó con la mercadería. El sistema envía la imagen a Groq Vision, extrae la lista de productos con cantidades y precios, y muestra una tarjeta de revisión por cada ítem extraído con el producto del catálogo que mejor hace match.
- **US-08 — Confirmación de ítems recibidos:** Como auditor, reviso cada ítem de la factura en pantalla: si el match es correcto lo confirmo; si no, lo corrijo antes de confirmar. Una vez confirmada la recepción completa, se registra como ingreso de mercadería.
- **US-09 — Productos nuevos en factura:** Como auditor, si Groq Vision detecta un producto que no existe en el catálogo del hotel, el sistema crea un borrador con la descripción extraída de la factura y lo marca como `pendiente_aprobacion`. Yo veo la propuesta en pantalla y confirmo que la descripción es correcta, pero el producto no entra al catálogo ni al inventario hasta que admin o supervisor lo aprueben.
- **US-10 — Aprobación de productos nuevos:** Como admin o supervisor, recibo una notificación de productos pendientes de aprobación. Reviso el borrador (nombre extraído, categoría sugerida, unidad), lo edito si es necesario y lo apruebo. Solo entonces el producto entra al catálogo y se genera su embedding.

**Módulo C — Catálogo y configuración**

- **US-11 — Catálogo con embeddings:** Como admin, cargo la lista de productos del hotel (nombre, unidad, subtipo, categoría). El sistema genera embeddings automáticamente. Desde ese momento, voz y fotos de facturas encuentran el producto correcto aunque no lo nombren exactamente igual.
- **US-12 — Alta de tenant:** Como admin nuevo, me registro con el nombre del hotel, sector y email; recibo acceso al panel donde configuro usuarios, catálogo y reglas del semáforo.
- **US-13 — Multi-sector (futuro):** Como admin, selecciono el sector de mi empresa y el semáforo adapta sus campos, umbrales y prompt de IA al sector correspondiente.

### 2.4 Criterios de aceptación transversales

- Un conteo confirmado offline nunca se duplica al sincronizar (dedupe por `local_id` único generado en cliente).
- El semáforo local (SEMAFORO_v2) corre en ≤100ms sin llamadas de red.
- El matching de voz devuelve el producto correcto con ≥90% de precisión contra el catálogo del tenant.
- El matching de factura (Groq Vision → pgvector) devuelve el producto correcto con ≥85% de precisión; el auditor valida el resto.
- Ningún producto nuevo entra al catálogo ni al inventario sin aprobación de admin/supervisor.
- Fotos de evidencia se guardan localmente (IndexedDB como blob) y sincronizan a Supabase Storage al reconectar; nunca se pierden.
- Ningún usuario ve datos de otro tenant, ni por API ni por dashboard.
- La PWA es instalable en Android/iOS y funciona sin internet para auditoría + evidencia fotográfica.

---

## 3. Plan técnico (el CÓMO)

### 3.1 Stack

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Frontend/PWA | Next.js 15 (App Router) + `next-pwa` | Instalable, offline, App Router nativo en Vercel |
| UI | TailwindCSS + shadcn/ui | Mismo que SmartCapture AI (referencia de diseño) |
| Offline storage | Dexie.js (IndexedDB) | Catálogo, conteos, fotos de evidencia (blob), cola de sync |
| Voz (STT) | Groq Whisper `whisper-large-v3-turbo` | Mismo que ALMACENERO DIGITAL |
| Visión (facturas) | Groq Vision `llama-4-scout-17b-16e-instruct` | Igual que ALMACENERO DIGITAL; requiere red |
| Semáforo local | Lógica TypeScript determinista | Implementa `SEMAFORO_v2_accion_ODS.md` sin red |
| Semáforo IA (insights) | Claude `claude-haiku-4-5` | Solo online; fallback a null si no hay red |
| Embeddings (generación) | `text-embedding-3-small` (OpenAI) | Se genera en servidor al aprobar/cargar productos |
| Matching semántico | Supabase pgvector (`vector_cosine_ops`) | Para voz y para ítems de facturas |
| Almacenamiento de fotos | Supabase Storage | Bucket privado por tenant; fotos de evidencia y facturas |
| Backend | Supabase Edge Functions (Deno/TS) | STT relay, visión, semáforo IA, embeddings, sync |
| DB | Supabase PostgreSQL + pgvector + RLS | Nuevo proyecto, separado de ALMACENERO DIGITAL |
| Auth | Supabase Auth + `app_metadata` (rol + tenant_id) | Multi-tenant con RLS |
| Deploy | Vercel (nuevo proyecto) | Push a main → deploy automático |

### 3.2 Estructura de archivos (objetivo)

```
auditoria/                              ← raíz del nuevo repo
├── app/                                ← Next.js App Router
│   ├── (auth)/login/
│   ├── (app)/
│   │   ├── captura/                    ← auditor: voz + semáforo (offline)
│   │   ├── recepcion/                  ← auditor: foto de factura + revisión ítems
│   │   ├── sesion/[id]/                ← detalle de sesión con evidencias
│   │   ├── dashboard/                  ← supervisor: KPIs, alertas, aprobaciones
│   │   ├── catalogo/                   ← admin: productos + embeddings
│   │   └── admin/                      ← admin: usuarios, configuración de sector
│   └── api/
│       ├── voz/                        ← relay Groq Whisper
│       ├── vision/                     ← relay Groq Vision (facturas)
│       ├── semaforo/                   ← Claude haiku insights (online)
│       ├── match/                      ← pgvector similarity search
│       └── embeddings/                 ← generación al aprobar productos
├── lib/
│   ├── semaforo.ts                     ← lógica local determinista (SEMAFORO_v2)
│   ├── offline.ts                      ← Dexie schemas + sync queue + foto blobs
│   ├── supabase.ts                     ← cliente Supabase (no tocar salvo pedido)
│   └── queries.ts                      ← todas las queries (listar impacto antes de tocar)
├── components/
│   ├── captura/                        ← VoiceButton, ConfirmCard, SemaforoCard, EvidenceCamera
│   ├── recepcion/                      ← InvoiceCamera, ItemReviewCard, PendingApprovalBadge
│   ├── dashboard/                      ← KPICard, AlertList, SessionProgress, ApprovalQueue
│   └── catalogo/                       ← ProductTable, EmbeddingStatus
├── supabase/
│   └── functions/
│       ├── voz/
│       ├── vision/
│       ├── semaforo-ia/
│       └── embeddings/
└── migrations/                         ← SQL numeradas 001, 002, …
```

### 3.3 Modelo de datos

| Tabla | Rol |
|-------|-----|
| `tenants` | Raíz multi-tenant: `nombre`, `sector`, `plan` |
| `users` | `rol` ∈ {auditor, supervisor, admin} + `tenant_id` |
| `sectors` | Config del semáforo por sector: umbrales, campos, prompt IA |
| `products` | Catálogo por tenant: `nombre`, `subtipo`, `unidad`, `requiere_fecha_segun_norma`, `embedding vector(1536)`, `estado` ∈ {activo, pendiente_aprobacion} |
| `audit_sessions` | Sesiones de auditoría: `tenant_id`, `bodega`, `estado` ∈ {abierta, cerrada}, `supervisor_id` |
| `product_counts` | Conteos en sesión: `producto_id`, `cantidad`, `fecha_vencimiento`, `fecha_recepcion`, `estado_empaque`, `observacion_visual`, `local_id`, `foto_evidencia_url` |
| `semaphore_log` | Resultado por conteo: `color`, `razon`, `accion_sugerida`, `estrategia_economia_circular`, `ods_relacionados`, `metodo_calculo` |
| `recepciones` | Recepciones de mercadería: `tenant_id`, `auditor_id`, `foto_factura_url`, `estado` ∈ {borrador, confirmada} |
| `recepcion_items` | Ítems extraídos de la factura: `recepcion_id`, `producto_id` (null si pendiente), `descripcion_extraida`, `cantidad`, `precio_unitario`, `match_score`, `estado` ∈ {confirmado, corregido, pendiente_aprobacion} |
| `productos_pendientes` | Borradores para aprobación: `tenant_id`, `nombre_sugerido`, `subtipo_sugerido`, `unidad_sugerida`, `origen` ∈ {factura, manual}, `aprobado_por`, `recepcion_item_id` |
| `offline_queue` | Solo IndexedDB (no en DB remota): conteos + fotos pendientes de sync |

### 3.4 Flujo A — Auditoría de inventario (online + offline)

```
[Auditor presiona botón de voz]
    → graba audio en cliente
    → con red: POST /api/voz → Groq Whisper → transcripción
      sin red: encola en IndexedDB, indica "modo offline"
    → POST /api/match → pgvector busca en catálogo del tenant
      sin red: matching local contra catálogo cacheado en IndexedDB
    → muestra ConfirmCard (producto + semáforo ya calculado localmente)
    → Auditor confirma (o corrige)
    → semaforo.ts corre localmente → color + acción + ODS
    → guarda en IndexedDB (con local_id para dedupe)
    → con red: sync inmediato a Supabase
      sin red: sync al reconectar
    → con red: /api/semaforo → Claude haiku → insight ejecutivo (opcional)

[Si auditor adjunta foto de evidencia]
    → captura foto en cliente
    → guarda como blob en IndexedDB
    → con red: sube a Supabase Storage → actualiza foto_evidencia_url en product_counts
      sin red: encola junto al conteo, sube al reconectar
```

### 3.5 Flujo B — Recepción de mercadería (requiere red)

```
[Auditor fotografía factura]
    → POST /api/vision → Groq Vision extrae lista de ítems
    → por cada ítem extraído: POST /api/match → pgvector busca en catálogo
    → muestra InvoiceReviewCard con todos los ítems:
        - match_score ≥ 0.85: producto sugerido pre-confirmado (auditor puede cambiar)
        - match_score < 0.85: auditor elige manualmente entre top 3 o escribe
        - sin match: muestra descripción extraída, estado "pendiente aprobación"
    → Auditor confirma la recepción completa
    → ítems confirmados → INSERT en recepcion_items (estado: confirmado/corregido)
    → ítems sin match → INSERT en productos_pendientes + recepcion_items (estado: pendiente_aprobacion)
    → foto de factura → sube a Supabase Storage

[Admin o Supervisor recibe notificación de pendientes]
    → revisa productos_pendientes: edita nombre, subtipo, unidad si es necesario
    → aprueba → INSERT en products → genera embedding → recepcion_item se vincula al producto
    → rechaza → recepcion_item queda sin producto_id, se notifica al auditor
```

### 3.6 Lógica del semáforo local (`lib/semaforo.ts`)

Implementa exactamente las reglas de `SEMAFORO_v2_accion_ODS.md`:
- Clasificación por subtipo → categoría (perecedero_crítico / intermedio / no_perecedero)
- Cálculo de `días_restantes` (por fecha oficial o estimado por recepción)
- Árbol de decisión: empaque → observación → fecha → color_base → ajustes finales
- Output: `{ color, dias_restantes, metodo_calculo, razon, accion_sugerida, estrategia_economia_circular, ods_relacionados }`
- **Sin llamadas de red. Determinista y testeable con jest/vitest.**

### 3.7 Embeddings y matching semántico

- Generación: al aprobar un producto → `POST /api/embeddings` → `text-embedding-3-small` → guarda en `products.embedding`
- Matching online: transcripción de voz o descripción de factura → embedding del texto → `SELECT ... ORDER BY embedding <=> $1 LIMIT 5`
- Matching offline: catálogo con embeddings precalculados cacheado en IndexedDB al login; distancia coseno en cliente. Límite recomendado: ≤2000 productos por tenant.
- Si score < 0.75 (voz) o < 0.85 (factura): el auditor elige manualmente

### 3.8 Seguridad

- RLS activo en todas las tablas con `tenant_id`; función `get_my_tenant_id()` SECURITY DEFINER desde `app_metadata`.
- Supabase Storage: bucket privado por tenant; acceso mediante URLs firmadas con expiración.
- `SERVICE_ROLE_KEY` solo en Edge Functions; nunca en cliente ni en repo.
- Secretos: `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — solo en Vercel/Supabase env.

### 3.9 Despliegue

```bash
# Edge Functions (manual tras cada cambio)
supabase functions deploy voz           --no-verify-jwt
supabase functions deploy vision        --no-verify-jwt
supabase functions deploy semaforo-ia   --no-verify-jwt
supabase functions deploy embeddings    --no-verify-jwt

# Frontend PWA: push a main → Vercel despliega automáticamente
# Migraciones: aplicar en orden en SQL Editor de Supabase (001 → ...)
```

### 3.10 Riesgos conocidos

- **Matching offline con embeddings pesados:** vectores de 1536 dimensiones son costosos en cliente. Para tenants con >2000 productos, el matching offline usa fuzzy (nombre exacto/parcial); el semántico requiere red.
- **Groq Whisper en iOS Safari:** restricciones de background audio — el botón debe mantenerse presionado mientras graba.
- **Calidad de foto de factura:** facturas arrugadas, con mala iluminación o en papel térmico desvanecido reducen la precisión de Groq Vision. Mostrar siempre el resultado para revisión del auditor; nunca auto-confirmar sin su tap.
- **Claude haiku como insights:** paso opcional. Si falla o no hay red, el semáforo local ya entregó todo lo esencial. Nunca bloquea la captura.
- **Sectores futuros:** la tabla `sectors` existe desde el día 1 pero solo tiene configuración para `alimentos`. Agregar `ferretería` es configuración + nuevo prompt IA, sin cambio de esquema.
- **Fotos de evidencia offline:** se guardan como blob en IndexedDB. Si el usuario borra datos del navegador antes de sincronizar, las fotos se pierden. Avisar en UI cuando hay fotos pendientes de sync.

---

## 4. Definición de "hecho" (checklist por cambio)

- [ ] `tenant_id` presente en todo INSERT nuevo
- [ ] Sin cambios en RLS ni en `lib/supabase.ts` (salvo pedido explícito)
- [ ] Si se tocó `lib/queries.ts`: componentes/páginas impactados listados y revisados
- [ ] Si se tocó una Edge Function: redeploy manual ejecutado
- [ ] El flujo de auditoría funciona offline (testeado con red desconectada)
- [ ] `lib/semaforo.ts` no hace llamadas de red (test unitario)
- [ ] Ningún producto nuevo entra al catálogo sin aprobación (verificado en RLS + lógica)
- [ ] Fotos de evidencia pendientes de sync muestran aviso en UI
- [ ] Probado el flujo end-to-end afectado
- [ ] Un solo cambio por entrega, confirmado antes de continuar

---

## 5. Fuera de alcance (v1)

- Integración con Oracle Inventory
- Exportación a Excel/PDF (post-launch)
- Bot de Telegram (canal eliminado en este producto)
- Sector ferretería (segunda iteración)
- App nativa (React Native) — la PWA cubre el caso de uso móvil
- Órdenes de pedido / compras planificadas (solo recepción de lo que ya llegó)

---

## 6. Referencias

- `SEMAFORO_v2_accion_ODS.md` — fuente de verdad para `lib/semaforo.ts`
- `github.com/Gei-del/Smartcapture-ai` — flujo de captura, componentes UI, patrón offline
- ALMACENERO DIGITAL — arquitectura multi-tenant, Supabase + RLS, Groq Whisper + Vision
