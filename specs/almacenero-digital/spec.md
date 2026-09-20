# Spec — Almacenero Digital

**Versión:** 2.0 · **Fecha:** 2026-09

---

## 1. Qué es

Almacenero Digital es una plataforma SaaS de control de inventario y ventas para comercios de cualquier rubro: ferreterías, abarrotes, autopartes, distribuidoras, tiendas de ropa, etc.

Es una herramienta **multi-producto**: cada empresa registrada tiene su propio **system prompt** que configura cómo interpreta la IA los registros de voz, foto y búsqueda. Nada en el código asume un rubro fijo — el rubro viene del campo `rubro` en la tabla `empresas` y del system prompt asociado.

Es **multi-tenant**: cada empresa está aislada por RLS en Supabase. No hay ningún dato compartido entre empresas.

---

## 2. Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend / PWA | Next.js (App Router) — desplegado en Vercel |
| Base de datos | Supabase (PostgreSQL) con RLS |
| Funciones de backend | Supabase Edge Functions (Deno/TypeScript) |
| Transcripción de voz | Groq Whisper |
| Búsqueda semántica | HuggingFace embeddings (384-dim) + pgvector |
| Búsqueda fallback | Trigramas (pg_trgm) |
| OCR de facturas | IA via Edge Function |
| Email transaccional | Resend API |
| Bot de mensajería | Telegram Bot API |
| Dominio | almacenero.digital |

---

## 3. Multi-tenancy

- Cada empresa tiene su propio `empresa_id` (UUID) asignado al registrarse.
- Todo usuario tiene `empresa_id` en `app_metadata` del JWT de Supabase Auth.
- RLS en todas las tablas filtra por `empresa_id` — no existe consulta válida entre empresas.
- El **system prompt** de cada empresa se almacena en la tabla `empresas` (campo `system_prompt` o equivalente) y determina cómo la IA interpreta voz y foto para ese rubro específico.
- El campo `tienda_id` (sede) es `NOT NULL` en todos los movimientos de stock.

---

## 4. Roles

| Rol | Acceso | Descripción |
|-----|--------|-------------|
| `admin` | App web | Configura empresa, catálogo, sedes, usuarios; ve reportes completos; vincula Telegram |
| `supervisor` | App web | Ingresa mercadería, cuenta stock, recepciona facturas, ve el panel de sesiones/alertas |
| `vendedor` | App web | Registra ventas de su sede (texto, voz o foto) |
| *(sin usuario)* | Bot Telegram | El admin recibe el reporte del día via `/reporte` |

### Permisos por función

| Función | Vendedor | Supervisor | Admin |
|---------|:--------:|:----------:|:-----:|
| Registrar ventas | ✅ | ✅ | ✅ |
| Ingreso de mercadería | | ✅ | ✅ |
| Contar stock (auditoría por voz) | | ✅ | ✅ |
| Recepción (factura por foto) | | ✅ | ✅ |
| Panel de sesiones y alertas | | ✅ | ✅ |
| Reportes | | | ✅ |
| Administración | | | ✅ |

---

## 5. Flujos principales

### 5.1 Venta

El vendedor (o supervisor/admin) registra una salida de stock.

1. Selecciona producto por texto, voz o foto.
   - **Voz:** "3 caños de 2 pulgadas a 5 soles" → Groq Whisper transcribe → IA interpreta según system prompt de la empresa → prellena producto/cantidad/precio.
   - **Foto:** foto de boleta/factura → OCR → primer ítem detectado.
2. Confirma o corrige cantidad y precio unitario.
3. Toca "Registrar venta" → INSERT en `movimientos` (tipo: venta, resta stock en `inventario` de la sede).
4. Puede deshacer dentro de los 5 minutos.

Restricción: si la cantidad supera el stock disponible, el sistema bloquea el registro.

### 5.2 Ingreso

Supervisor/admin carga mercadería recibida del proveedor → suma stock en la sede.
INSERT en `movimientos` (tipo: ingreso).

### 5.3 Contar

Supervisor/admin audita stock físico por voz. El sistema arma una **sesión de conteo**:
- El usuario va diciendo productos y cantidades.
- Al cerrar la sesión, el sistema compara contra el stock del sistema y muestra diferencias.
- El ajuste resultante genera un movimiento de tipo `ajuste`.

### 5.4 Recepción

Supervisor/admin fotografía la factura/remito del proveedor → OCR extrae los ítems → se precargan para confirmar o corregir antes de registrar el ingreso.

### 5.5 Panel

Vista del supervisor/admin con:
- **Progreso** de la sesión de conteo activa.
- **Alertas de stock**: productos agotados o bajo mínimo.
- **Sin vender**: productos parados más de N días (configurable).
- **Más vendidos**: ranking del período.

### 5.6 Reportes

Solo admin. Muestra ventas en el tiempo, por sede y por vendedor, con gráficos. Incluye ventas históricas.

### 5.7 Administración

Solo admin. Secciones:

- **Catálogo**: importar productos desde Excel/CSV con plantilla (`nombre`, `unidad_medida`, `referencia`, `stock_minimo`, `punto_reorden`, `stock_maximo`). Generar embeddings para búsqueda semántica por voz/foto.
- **Sedes**: crear, renombrar, activar/desactivar sucursales (desactivar no elimina historial).
- **Ubicaciones**: pasillos, estantes o zonas dentro de cada sede.
- **Usuarios**: crear vendedores y supervisores con nombre, email, contraseña, rol y sede.
- **Configuración**: parámetros como meses para considerar stock muerto.
- **Bot de Telegram**: mostrar el token de admin para vincular.

---

## 6. Bot de Telegram

El bot **solo entrega reportes**. No registra ventas ni inventario.

- El admin lo vincula enviando `/start TOKEN_DE_ADMIN` al bot.
- Luego envía `/reporte` para recibir el total del día + desglose por sede y vendedor.
- Cualquier otro mensaje recibe una respuesta indicando que el registro se hace desde la app.

Implementado en `supabase/functions/telegram-bot/index.ts`.

---

## 7. Onboarding

`supabase/functions/onboarding/index.ts`:

1. El futuro admin completa el formulario en `/registro` (nombre empresa, rubro, email, sedes).
2. La Edge Function crea la empresa en `empresas`, el usuario admin en Supabase Auth con `empresa_id` en `app_metadata`, las sedes en `tiendas`.
3. Genera contraseña temporal `AD-XXXXXXXX` y la muestra en pantalla.
4. Envía email con credenciales y tokens de Telegram via Resend.

---

## 8. PWA y offline

- La app es una PWA instalable desde el navegador móvil.
- La barra superior muestra el estado de conexión y un contador de registros pendientes de sincronizar.
- Sin conexión: búsqueda por texto disponible; algunos registros quedan en cola y se sincronizan al volver la señal.
- Voz y foto requieren conexión (se procesan en el servidor).

---

## 9. Tablas clave (Supabase)

| Tabla | Propósito |
|-------|-----------|
| `empresas` | Una fila por empresa; incluye `rubro`, `system_prompt`, `activa` |
| `tiendas` | Sedes de cada empresa; `empresa_id NOT NULL` |
| `productos` | Catálogo de productos por empresa |
| `inventario` | Stock por producto y sede (`producto_id`, `tienda_id`, `empresa_id`) |
| `movimientos` | Registro histórico de ventas, ingresos, ajustes, traslados, gastos |
| `sesiones_conteo` | Sesiones de auditoría de stock por supervisor |

Tipos de movimiento: `venta`, `ingreso`, `gasto`, `traslado`, `ajuste`.

---

## 10. Invariantes críticos

- `tienda_id` es `NOT NULL` en todos los INSERT de `movimientos` e `inventario`.
- `empresa_id` debe estar presente en `app_metadata` del JWT — si falta, el login rechaza al usuario.
- RLS nunca se modifica sin instrucción explícita.
- El rubro del negocio es siempre una variable por empresa, nunca hardcodeado en el código.
- Cambios en Edge Functions requieren `supabase functions deploy` manual.

---

## 11. Archivos clave

```
frontend/
  app/
    login/page.js           — login con detección de cuenta baneada
    registro/page.js        — onboarding de nueva empresa
    auditoria/
      venta/page.js         — registro de ventas
      ingreso/page.js       — carga de mercadería
      contar/page.js        — auditoría de stock por voz
      recepcion/page.js     — OCR de facturas
      supervisor/page.js    — panel de sesiones y alertas
      inventario/page.js    — vista de stock con alertas de color
      reportes/page.js      — reportes del admin
      catalogo/page.js      — catálogo, sedes, usuarios (administración)
  lib/
    supabase.js             — cliente Supabase (no tocar salvo instrucción)
    auditoria/queries.js    — todas las queries; re-exporta supabase

supabase/functions/
  telegram-bot/index.ts     — bot de Telegram (solo /reporte)
  onboarding/index.ts       — alta de nuevas empresas
```
