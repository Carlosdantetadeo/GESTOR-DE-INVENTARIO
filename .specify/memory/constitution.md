<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Modified principles: n/a (adopción inicial — plantilla sin valores previos)
- Added sections:
  - Core Principles (7 principios: I–VII, tomados de SPECKIT.md §1)
  - Restricciones de Seguridad y Datos
  - Flujo de Trabajo y Entrega
  - Governance
- Removed sections: ninguna (se reemplazaron los placeholders de la plantilla)
- Templates requiring updates: ninguno (plan/spec/tasks templates leen la
  constitución en runtime; no contienen referencias hardcodeadas)
- Follow-up TODOs: ninguno
-->

# Constitución — Almacenero Digital

## Core Principles

### I. Aislamiento multi-tenant sagrado (NO NEGOCIABLE)

Todo dato pertenece a una `empresa`. Ningún cambio puede permitir lectura o escritura
cross-tenant, ni por API, ni por dashboard, ni por Edge Function. `empresa_id` y
`tienda_id` (según la tabla) DEBEN estar presentes en todo INSERT; su ausencia es un
bug bloqueante, no un detalle.

**Racional:** El sistema sirve a múltiples ferreterías sobre una misma base de datos.
Una fuga cross-tenant expone datos comerciales de un cliente a su competencia.

### II. RLS intocable sin instrucción explícita

Las policies de RLS existentes (migraciones 002/007) son el perímetro de seguridad del
frontend y NO DEBEN modificarse sin instrucción explícita del dueño del proyecto. Las
Edge Functions usan `SERVICE_ROLE_KEY` y bypasean RLS: todo chequeo de tenant dentro de
ellas DEBE ser explícito en el código (patrón: `handleUndo`, `handleJoin`).

**Racional:** RLS es la última línea de defensa; un cambio bien intencionado puede abrir
un agujero silencioso que ningún test de UI detecta.

### III. `app_metadata`, nunca `user_metadata`

La identidad de tenant (`empresa_id`, `rol`) DEBE leerse y escribirse exclusivamente en
`app_metadata` (solo modificable con service role). `user_metadata` NUNCA participa en
decisiones de autorización.

**Racional:** `user_metadata` es editable por el propio usuario vía
`supabase.auth.updateUser()` y permitió una escalación cross-tenant real (bug de la
migración 006, corregido en la 007). Este principio existe porque el incidente ocurrió.

### IV. `stock` es una tabla derivada

La tabla `stock` la mantiene únicamente el trigger `tr_actualizar_stock` sobre
`movimientos`. NUNCA escribir en `stock` directamente, ni desde SQL manual, ni desde
Edge Functions, ni desde el frontend. Ante discrepancia entre stock y ledger: comparar
el trigger vigente contra `migrations/005_trigger_null_guard.sql` y ejecutar
`SELECT recalcular_stock();` (migración 010).

**Racional:** Hubo un incidente en producción con un trigger editado a mano donde las
ventas sumaban stock. Una sola fuente de escritura hace el estado auditable y reparable.

### V. `movimientos` es un ledger append-only

Los movimientos se insertan o se eliminan (Undo); NUNCA se actualizan para "corregir"
cantidades o tipos. El Undo se implementa con DELETE + reversión automática del trigger
(factor -1). Cualquier corrección es un nuevo movimiento o un undo, nunca un UPDATE.

**Racional:** El ledger es la fuente de verdad de la que se reconstruye el stock; los
updates in-place romperían la trazabilidad y la función `recalcular_stock()`.

### VI. Producción activa: un cambio a la vez

Este es un producto comercial con clientes reales. Cada entrega contiene UN cambio,
verificado end-to-end en el flujo afectado (bot o dashboard), y se confirma con el dueño
antes de continuar con el siguiente. Cambios en Edge Functions REQUIEREN redeploy manual
(`supabase functions deploy <fn> --no-verify-jwt`) — un cambio no está "hecho" hasta que
está desplegado y probado.

**Racional:** Los errores en producción tienen impacto inmediato en la operación diaria
de las ferreterías; los cambios pequeños y confirmados acotan el radio de daño.

### VII. Simplicidad primero

Mínimo código que resuelve el problema. Sin features no pedidas, sin abstracciones para
código de un solo uso, sin configurabilidad especulativa, sin manejo de errores para
escenarios imposibles. Ante dos soluciones que funcionan, gana la más corta y directa.
Cambios quirúrgicos: no "mejorar" código adyacente ni refactorizar lo que no está roto.

**Racional:** El proyecto lo mantiene un equipo mínimo; cada línea especulativa es deuda
de mantenimiento sin retorno.

## Restricciones de Seguridad y Datos

- `SERVICE_ROLE_KEY` vive solo en secretos de Edge Functions; NUNCA en el frontend, en
  el repo, ni en logs.
- El webhook del bot es fail-closed: sin `TELEGRAM_WEBHOOK_SECRET` válido en el header,
  se rechaza con 401.
- Todo webhook reintentado por Telegram DEBE deduplicarse por `update_id`
  (tabla `telegram_updates`); un reintento nunca duplica movimientos.
- `frontend/lib/supabase.js` no se toca salvo pedido explícito.
- Si un cambio afecta `frontend/lib/queries.js`, listar las páginas impactadas antes de
  proceder.
- Migraciones SQL se aplican en orden numérico en el SQL Editor de Supabase; ninguna
  migración se edita después de aplicada en producción (se crea una nueva).

## Flujo de Trabajo y Entrega

- Antes de implementar: declarar supuestos; si hay varias interpretaciones, presentarlas
  en lugar de elegir en silencio.
- Toda tarea se transforma en un criterio verificable ("agregar validación" → "test que
  falla con input inválido, luego pasa").
- Frontend se despliega automáticamente en Vercel al hacer push a `main`; Edge Functions
  se despliegan a mano. La definición de "hecho" incluye el despliegue del componente
  tocado.
- Checklist por cambio (ver SPECKIT.md §4): tenant en INSERTs, sin cambios a RLS ni a
  `supabase.js`, impacto de `queries.js` listado, redeploy hecho, flujo end-to-end
  probado, un solo cambio por entrega.

## Governance

Esta constitución prevalece sobre cualquier otra práctica documentada del proyecto. Las
enmiendas requieren: (1) instrucción o aprobación explícita del dueño del proyecto,
(2) actualización de este archivo con incremento de versión semántica, y (3) propagación
a `SPECKIT.md` §1 si el cambio afecta los principios base.

Versionado: MAJOR para eliminación o redefinición incompatible de principios; MINOR para
principios o secciones nuevas o guía materialmente ampliada; PATCH para clarificaciones
y correcciones de redacción.

Cumplimiento: toda revisión de código (manual o con `/code-review`) DEBE verificar los
principios I–V explícitamente cuando el cambio toca datos, auth o Edge Functions. La
complejidad agregada DEBE justificarse contra el principio VII. `CLAUDE.md` y
`SPECKIT.md` sirven como guía operativa en runtime.

**Version**: 1.0.0 | **Ratified**: 2026-08-09 | **Last Amended**: 2026-08-09
