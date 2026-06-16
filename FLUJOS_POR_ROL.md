# Flujos por Rol — Agent GMS

> Documento de referencia. Flujos por rol (Operador / Administrador) y por canal
> (Telegram / Web), **actualizado al sprint 018 (UX unificada)**.
> Fuente: `supabase/functions/telegram-bot/index.ts` + `tarjeta.ts`, `migrations/`,
> y `frontend/`. Para cada flujo: **disparador · pasos · resultado · gating · casos borde**.

---

## Mapa rápido de roles

| | Operador (`vendedor`) | Administrador (`admin`) |
|---|---|---|
| Se registra con | `telegram_token` (+ elige sede) | `telegram_token_admin` (elige **modo** al registrarse) |
| `tienda_id` | Una sede fija | `null` (modo consulta) o una sede (modo con_sede) |
| `modo_admin` | — | `consulta` o `con_sede` |
| Registrar (voz/texto/foto) | ✅ | ✅ solo en modo `con_sede` |
| Reportes por voz/texto | ✅ **scoped a su sede** | ✅ consolidado (respeta sede mencionada) |
| Cuenta/panel web | ❌ (solo Telegram) | ✅ |

> Todos los registros pasan por la **tarjeta de revisión unificada** (018) antes de
> tocar el ledger `movimientos`. El único gate por rol en el bot es: admin en modo
> consulta no registra.

---

# PARTE A — OPERADOR (vendedor)

Canal: **solo Telegram**.

## A1. Registro — `/start <token de operador>`
- **Pasos:** bot busca empresa por token → muestra botones de sede → el operario
  toca su sede (`join_<token>_<tiendaId>`) → valida que la sede sea de esa empresa
  → crea usuario (`rol=vendedor`, `tienda_id`, `empresa_id`).
- **Casos borde:** token inválido → aviso; ya registrado en esta empresa → no repite;
  token de otra empresa → re-vincula (cambia de empresa).

## A2. Registrar por VOZ → tarjeta
- **Disparador:** nota de voz.
- **Pasos:**
  1. Groq Whisper transcribe (la transcripción **no** se muestra en el chat).
  2. El NLU clasifica intención y devuelve `{tipo, items, …}`.
  3. Se crea `movimiento_pendiente` y se muestra la **tarjeta de revisión**
     (tipo, ítems, total) con `[✏️ Corregir] [✅ Confirmar] [❌ Cancelar]`.
  4. **Espera tap explícito en `[✅ Confirmar]`** — no hay auto-confirmación; nada
     se registra hasta el tap.
- **Gating:** ninguno (el vendedor registra).
- **Casos borde:** "cancelar" por voz → /cancelar (A6); voz durante una edición →
  "estás en modo edición".

## A3. Registrar por TEXTO → tarjeta
- **Igual que A2** desde el paso 2 (sin STT).
- **Casos borde:** si hay una **edición en curso**, el texto es la corrección del
  ítem (A5), NO un movimiento nuevo. Texto exacto `/cancelar` → A6.

## A4. Registrar por FOTO → tipo upfront → Vision → tarjeta (018)
- **Disparador:** foto (factura/boleta/remito).
- **Pasos:**
  1. **No se llama a Vision todavía.** Se guarda el `file_id` y se pregunta:
     "📷 Foto recibida. ¿Es Compra o Venta?" `[📦 Compra] [💰 Venta] [❌ Cancelar]`.
  2. Tap Compra/Venta → recién ahí se descarga la imagen y corre **Groq Vision**
     (el prompt ya sabe el tipo); el NLU estructura los ítems.
  3. Se reemplaza el mensaje por la **tarjeta unificada** (sin countdown; espera tap).
  4. El **tipo queda bloqueado**: si se equivocó, Cancelar y reenviar la foto.
- **Gating:** admin modo consulta → rechazado (es un registro).
- **Casos borde:** imagen sin inventario → aviso y se descarta; edición en curso →
  "estás en modo edición".

## A5. Corregir por campo ([✏️ Corregir]) — decisión #6 (migración 019)
- **Pasos:**
  1. Tap Corregir → elegir ítem por número (si hay varios; con uno solo se salta).
  2. Muestra "Ítem N: … ¿Qué corregís?" con `[📝 Nombre] [🔢 Cantidad] [💲 Precio] [❌ Cancelar]`.
  3. Toca un campo → "<Campo> actual: <valor> — Enviá el nuevo valor:".
  4. Envía **solo el dato** → valida ese campo, recalcula total, **vuelve a la tarjeta**.
- Cada paso **edita el mismo mensaje**.
- **Casos borde:** valor inválido → "Valor inválido para <Campo>…"; texto en el paso de
  campo → "Tocá un campo…". `[❌ Cancelar]` / `/cancelar` → vuelve a la tarjeta **sin descartar**.

## A6. `/cancelar` universal — decisión #7 (edit-aware)
- **Disparador:** texto exacto `/cancelar`/`cancelar`, o voz transcrita "cancelar".
- **Acción:** en medio de una edición → vuelve a la tarjeta sin descartar; en estado neutro →
  marca `cancelled` todos los pendientes → "✅ Cancelado. Estás en estado neutro."

## A7. Confirmar → `/deshacer` (ventana 5 min) — decisión #10
- **Confirmar** (tap `[✅ Confirmar]`): mapea `compra→ingreso`, registra en
  `movimientos` (auto-crea productos), el trigger actualiza stock, y la tarjeta se
  edita a **"✅ Registrado"** (sin botones).
- **Deshacer:** el operario escribe **`/deshacer`** → revierte su última
  registración (el último lote) dentro de **5 min** (trigger con factor -1).
- **Pasados 5 min** → "Ventana de reversión vencida. Pedile al admin que lo
  revierta desde el dashboard."

## A8. Reportes por voz/texto — **scoped a su sede** (decisión #9)
- **Disparador:** "¿cuánto vendí hoy?", "stock de cemento", etc.
- **Pasos:** el NLU detecta reporte → se atiende **forzando su sede**
  (ignora cualquier "todas las sedes"; no se menciona la restricción).
- **Resultado:** stock de un producto en su sede, o ventas del período de su sede.
- **Cambio vs versiones previas:** ya **no** recibe "los reportes son solo para admin".

---

# PARTE B — ADMINISTRADOR

Dos canales: Telegram (registrar + reportes) y Web (panel).

## B-Telegram

### B1. Registro — `/start <token admin>` → elige modo (decisión #8)
- **Pasos:** el token admin **no** registra directo: pregunta
  `[📊 Solo consulta]` (`tienda_id=null`, `modo_admin=consulta`) o
  `[📦 Con sede asignada]` (elige sede, `modo_admin=con_sede`).
- **Re-vínculo:** reenviar `/start <token_admin>` vuelve a preguntar el modo.

### B2. Registrar por voz/texto/foto
- **Modo con_sede:** igual que A2/A3/A4 (pasa por la tarjeta).
- **Modo consulta:** si intenta registrar → "Tu cuenta está en modo consulta.
  No registrás movimientos. Reenviá /start para cambiar de modo."

### B3. Reportes por voz/texto
- **Consolidado** por defecto; si el NLU menciona una sede, la respeta.
- Mismos modos que A8 (stock puntual / ventas del período) sin el forzado de sede.
- Deep-link al dashboard al final (**dormido** hasta `DASHBOARD_BASE_URL`).

### B4. Deshacer — igual que A7 (scoped a su empresa, ventana 5 min).

## B-Web (panel de administración, Next.js) — sin cambios en 018

> **Quién entra:** `middleware.js` solo exige estar logueado (Supabase Auth con
> `empresa_id` en `app_metadata`); no filtra por rol. En la práctica solo el admin
> tiene cuenta web (el operario es solo-Telegram). Sidebar: Dashboard · Movimientos ·
> Inventario · Reportes · Usuarios · Configuración · (Ajuste solo si `rol==='admin'`).

### B7. Onboarding — `/registro` (público)
- Form: empresa, **rubro**, email admin, **1..20 sedes**. `POST` a Edge `onboarding`
  → crea empresa + sedes + usuario Auth + `telegram_token`/`telegram_token_admin` +
  email (Resend). Muestra la **contraseña temporal** en pantalla.
- **Puntos a evaluar:** sin captcha/rate-limit; URL del endpoint hardcodeada.

### B8. Login — `/login`
- `signInWithPassword` (exige `empresa_id` en `app_metadata`) + flujo de
  **recuperación** de contraseña (`resetPasswordForEmail`).

### B9. Dashboard — `/`
- KPIs (Ventas, Stock recibido, Gastos, Operaciones por voz), filtros sede + rango,
  indicador realtime, alertas de stock (`stock_minimo`, negativos), tabla de últimos
  20 movimientos con transcripción.
- **A evaluar:** el gráfico "Ventas vs Gastos" es un SVG decorativo (no datos reales).

### B10. Inventario — `/inventario`
- KPIs (valor total, nº productos, alertas), filtros, **tabla pivote** stock por
  tienda, edición inline de `stock_minimo`, **alta manual de producto** (modal),
  export Excel.

### B11. Movimientos — `/movimientos`
- Últimos 100 con filtros (incluye `ajuste`), **Undo por fila** (deshacer web, no
  caduca), export Excel/PDF (PDF con nombre de empresa + `rubro`).

### B12. Reportes — `/reportes`
- Centro de descargas: Ventas / Valorización de almacén / Historial, en Excel o PDF,
  por sede + rango.

### B13. Configuración — `/admin/config`
- Editar `rubro`, elegir modelo NLU (`groq-llama`/`anthropic-haiku`/`anthropic-sonnet`),
  ver consumo IA (`consumo_ia`).

### B14. Usuarios — `/admin/usuarios`
- Muestra ambos tokens (operario y admin), **rota** el token admin, lista operarios.
- **A evaluar:** no permite desvincular operarios ni rotar el token de operario.

### B15. Ajuste de inventario — `/admin/ajuste` (único web admin-only)
- Conteo físico por tienda + motivo → movimientos `tipo='ajuste'` (firmados),
  reversibles desde `/movimientos`. El bot **nunca** genera ajustes.

---

# PARTE C — Motor común y reglas transversales (018)

## C1. Puerta de entrada
Solo POST · header secret fail-closed (401) · anti-duplicado por `update_id` ·
200 inmediato + background (`waitUntil`).

## C2. NLU (contrato 018)
Devuelve `{intent, tipo, items, …}` (o `{intent:reporte,…}`). Mantiene
`tipo_explicito`/`confianza` por compatibilidad, pero **ya no gobiernan nada**
(la auto-confirmación se eliminó; siempre se espera tap).
- Parser **tolerante** a respuestas viejas (`movimientos` → se mapea a `items`).

## C3. Pendiente (`movimiento_pendiente`)
Una fila por registro en revisión: `channel`, `tipo`, `items` (JSONB), `total`,
`card_message_id`, `editing_state`, `editing_field`, `file_id`, `transcripcion`,
`cancelled`. La confirmación reclama la fila atómicamente (evita doble registro
ante doble tap). (La columna `auto_confirm_at` quedó pero ya no se usa.)

## C4. Matriz de gating por rol

| Acción | Operador | Admin consulta | Admin con_sede |
|---|---|---|---|
| Registrar (voz/texto/foto) | ✅ | ❌ aviso | ✅ |
| Reporte por voz/texto | ✅ (su sede) | ✅ (consolidado) | ✅ (consolidado) |
| Deshacer (5 min) | ✅ | — | ✅ |
| Panel web | ❌ | ✅ | ✅ |
| Ajuste de inventario (web) | ❌ | ✅ | ✅ |

## C5. Riesgos / puntos abiertos
- Foto: 2 taps (Compra/Venta → Confirmar) antes de registrar.
- Edición colgada: durante `editing_state`, el siguiente **texto** es la corrección
  (voz/foto se rechazan con aviso).
- NLU ante duda asume **registro**.
- `auditoria_reversiones.revertido_por` = NULL hasta resolver el mapeo auth↔usuarios
  del admin web (epic dashboard).
- Deep-link de reportes **dormido** hasta `DASHBOARD_BASE_URL` + `JWT_SECRET`.
- `traslado` no captura sede origen/destino desde voz (default lo resuelve el insert).
- Gate web real = "tener cuenta Auth con `empresa_id`", no el rol (hoy solo admins la tienen).
