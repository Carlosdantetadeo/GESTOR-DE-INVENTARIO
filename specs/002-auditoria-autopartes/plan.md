# Implementation Plan: AuditorIA — PWA de Auditoría de Inventario (Sector Autopartes)

**Branch**: `002-auditoria-autopartes` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-auditoria-autopartes/spec.md`

## Summary

AuditorIA es una PWA offline-first que se agrega **dentro de la app Next.js existente** (`frontend/`) y reutiliza la **misma base de datos** de GMS/Almacenero Digital (`empresas`, `tiendas`, `usuarios`, `productos`, `stock`, `movimientos`). Aporta tres capacidades para el sector autopartes: (1) auditoría de inventario por voz con **semáforo determinista** (estado físico + salud de stock), (2) recepción de mercadería por foto de factura, y (3) registro de salidas/ventas — todo escribiendo sobre el **ledger `movimientos` existente** (sin tocar el trigger de stock ni el bot de Telegram). Las capacidades nuevas se apoyan en tablas nuevas propias (`sesiones_auditoria`, `conteos`, `evidencias`, `piezas_pendientes`) y en columnas aditivas sobre `productos` (`referencia`, `unidad_medida`, `punto_reorden`). El diferenciador —el semáforo— corre **en el dispositivo** para garantizar operación sin conexión.

## Technical Context

**Language/Version**: JavaScript/TypeScript, Next.js 14.2.3 (App Router), React 18.3 — el stack ya existente del `frontend/`.

**Primary Dependencies**: `@supabase/ssr` + `@supabase/supabase-js` (ya presentes); Groq (Whisper para voz, Vision para facturas — mismo proveedor que ya usa el bot); IndexedDB vía librería mínima (`idb`) para cola offline; Service Worker + Web App Manifest para PWA instalable. `jspdf`/`xlsx` ya presentes para exportación.

**Storage**: PostgreSQL (Supabase) — mismas tablas de GMS + tablas nuevas de auditoría. Supabase Storage (bucket nuevo `evidencias`) para fotos. IndexedDB en el cliente para catálogo sincronizado, cola de conteos y cola de fotos.

**Testing**: Playwright (ya presente en el repo raíz) para E2E de los flujos PWA; tests unitarios del motor de semáforo (función pura, determinista) con el runner de Deno/Node ya usado en `telegram-bot/tarjeta.test.ts` como referencia de estilo.

**Target Platform**: Navegadores móviles modernos instalables como PWA (Android 10+ Chrome, iOS 14+ Safari) + escritorio para Supervisor/Admin. Desplegado en Vercel (push a `main`).

**Project Type**: Web application (PWA) dentro del monorepo `frontend/` existente.

**Performance Goals**: Registro de una pieza < 15s (SC-001); semáforo < 2s en dispositivo, offline (SC-011/US2); dashboard del supervisor refleja conteos < 30s tras sync (SC-006); sync del catálogo (hasta 2.000 piezas) < 60s (SC-010).

**Constraints**: Offline-first no negociable en el flujo de auditoría (FR-001/002); el bot de Telegram NO se toca (FR-020); no escribir en `stock` directamente (Constitución IV); `movimientos` append-only (Constitución V); `app_metadata` para identidad de tenant (Constitución III); RLS no se modifica en tablas existentes (Constitución II).

**Scale/Scope**: Hasta 2.000 piezas por tenant, 5 auditores simultáneos por sede (SC-009). ~6 pantallas nuevas (login reutilizado, captura por voz, tarjeta de semáforo, recepción por factura, dashboard supervisor, catálogo/usuarios).

## Constitution Check

*GATE: Debe pasar antes de Phase 0. Re-evaluado tras Phase 1.*

| Principio | Cumplimiento en este plan |
|-----------|---------------------------|
| **I. Aislamiento multi-tenant** | Todas las tablas nuevas llevan `empresa_id UUID NOT NULL` y RLS. Todo INSERT incluye `empresa_id` (y `tienda_id` donde aplica). ✅ |
| **II. RLS intocable** | No se modifican policies existentes. Las tablas nuevas reciben policies **nuevas** siguiendo el patrón vigente del frontend (scoped por `empresa_id` desde `app_metadata`). ✅ |
| **III. `app_metadata`** | Los usuarios de AuditorIA son usuarios de Supabase Auth; `empresa_id`, `rol` y `tienda_id` viven en `app_metadata`. Ninguna decisión de autorización lee `user_metadata`. ✅ |
| **IV. `stock` derivado** | AuditorIA NUNCA escribe en `stock`. Las salidas/ventas (FR-021) y recepciones se registran como INSERT en `movimientos`; el trigger `tr_actualizar_stock` hace el resto. ✅ |
| **V. `movimientos` append-only** | Registrar = INSERT; deshacer = DELETE (reversión por trigger). Ninguna corrección es UPDATE. ✅ |
| **VI. Producción activa, un cambio a la vez** | AuditorIA es un producto nuevo aislado; no altera el bot ni el dashboard actual. El plan se entrega en incrementos desplegables (ver Fases). Migraciones aditivas, numeradas después de la 023. ✅ |
| **VII. Simplicidad** | Matching offline por fuzzy string sobre el catálogo sincronizado (sin pgvector en v1). Semáforo = función pura determinista. Sin abstracciones especulativas. ✅ (ver research.md para el tradeoff pgvector) |

**Resultado del gate: PASA.** Sin violaciones que justificar en Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-auditoria-autopartes/
├── plan.md              # Este archivo
├── research.md          # Phase 0 — decisiones técnicas
├── data-model.md        # Phase 1 — entidades y migraciones
├── quickstart.md        # Phase 1 — guía de validación end-to-end
├── contracts/           # Phase 1 — contratos cliente/servidor
│   ├── sync-offline.md      # Cola offline, idempotencia, flush
│   ├── semaforo.md          # Contrato del motor de semáforo (entrada/salida)
│   └── data-operations.md   # Operaciones sobre tablas/Storage (lo que expone el server)
├── checklists/
│   └── requirements.md  # Checklist de calidad del spec (ya existe)
└── tasks.md             # Phase 2 (/speckit-tasks — NO lo crea /speckit-plan)
```

### Source Code (repository root)

```text
frontend/
├── app/
│   └── auditoria/                 # NUEVO — sección PWA de AuditorIA
│       ├── layout.js                 # Shell PWA (registro de service worker, estado online)
│       ├── page.js                   # Home del auditor: sesión activa + botón de voz
│       ├── captura/                  # Captura por voz + tarjeta de semáforo
│       ├── recepcion/                # Recepción por foto de factura
│       ├── salidas/                  # Registro de salidas/ventas (FR-021)
│       ├── supervisor/               # Dashboard tiempo real + aprobaciones
│       └── catalogo/                 # Carga de catálogo + gestión de usuarios (admin)
├── lib/
│   └── auditoria/                 # NUEVO — lógica de AuditorIA
│       ├── semaforo.js               # Motor determinista (función pura) — testeable
│       ├── matching.js               # Fuzzy match on-device sobre catálogo local
│       ├── offline/                  # IndexedDB: catálogo, cola de conteos, cola de fotos
│       │   ├── db.js
│       │   ├── syncEngine.js         # flush en `online` + en arranque, idempotente
│       │   └── queue.js
│       └── queries.js                # Queries de AuditorIA a Supabase (NO toca lib/queries.js)
├── public/
│   ├── auditoria-manifest.json    # NUEVO — Web App Manifest (instalable)
│   └── auditoria-sw.js            # NUEVO — Service Worker (app shell + offline)
└── ...                            # Todo lo existente permanece intacto

migrations/                        # NUEVAS migraciones aditivas (numeradas 024+)
├── 024_autopartes_producto_campos.sql   # referencia, unidad_medida, punto_reorden en productos
├── 025_auditoria_sesiones.sql
├── 026_auditoria_conteos.sql
├── 027_auditoria_evidencias.sql
├── 028_auditoria_piezas_pendientes.sql
├── 029_auditoria_rls.sql                 # RLS de las tablas nuevas (policies nuevas)
└── 030_movimientos_client_op_id.sql      # idempotencia del ledger (columna aditiva)

supabase/functions/               # Edge Functions (Deno) — solo si se necesita server-side
└── auditoria-ocr/                # NUEVO (opcional) — proxy a Groq Vision para facturas
```

**Structure Decision**: AuditorIA vive **dentro del `frontend/` existente** como un route group `app/auditoria/` con su propio manifest y service worker, y su lógica aislada en `lib/auditoria/`. Esto reutiliza el cliente Supabase, la auth y el pipeline de despliegue de Vercel sin duplicar infraestructura, y respeta la regla de no tocar `frontend/lib/supabase.js` ni `frontend/lib/queries.js`. El bot de Telegram (`supabase/functions/telegram-bot/`) queda intacto. La OCR de facturas se resuelve preferentemente desde el cliente autenticado o con una Edge Function nueva y aislada (`auditoria-ocr`) si se requiere ocultar la API key.

## Complexity Tracking

> Sin violaciones a la constitución. Sección no aplica.
