# Guía de Flujos — Agent GMS (bot de Telegram)

> Mapa de los flujos del bot tal como quedan tras el **sprint 018 (UX unificada)**.
> Fuente: `supabase/functions/telegram-bot/index.ts` + `tarjeta.ts` y la migración
> `migrations/018_ux_unificada.sql`. Reemplaza el flujo de foto 016/017.

---

## 0. Puerta de entrada (todo update pasa por acá)

1. **Solo POST.** Otro método → `200 ok`.
2. **Seguridad (fail-closed).** Header `X-Telegram-Bot-Api-Secret-Token` == `TELEGRAM_WEBHOOK_SECRET`, si no → `401`.
3. **Anti-duplicado.** `update_id` en `telegram_updates` (reintento → descarta).
4. **200 inmediato + trabajo en background** (`waitUntil`): STT + NLU corren por detrás.

Ruteo (el primero que matchea gana):

| Llega… | Va a… |
|--------|-------|
| Tap `confirmar:<id>` / `corregir:<id>` / `cancelar:<id>` | Tarjeta: confirmar / editar / cancelar |
| Tap `fototipo:compra:<id>` / `fototipo:venta:<id>` | Foto: fija tipo → Vision → tarjeta |
| Tap `adminmodo:…` / `adminsede:…` | Admin: elige modo / sede |
| Tap `editfield:…` / `editcancel:…` | Edición por campo / cancelar edición |
| Tap `undo_…` | Deshacer **legacy** (mensajes viejos con botón; se mantiene) |
| Tap `join_…` | Operario elige sede al registrarse |
| Texto `/start <token>` | Registro |
| Texto exacto `/cancelar` o "cancelar" | **/cancelar universal** (prioridad alta) |
| Texto exacto `/deshacer` o "deshacer" | **/deshacer** — revierte la última registración (5 min) |
| Nota de voz | STT → (¿/cancelar? ¿edición? ) → registro |
| Texto normal | (¿edición en curso? → corrección) si no → registro |
| Foto | Pregunta Compra/Venta (Vision NO se llama todavía) |

---

## 1. Registro de operario — `/start <token>`

```
/start <token>
  ├─ token de OPERARIO → botones de sede → handleJoin → rol=vendedor, tienda fija
  └─ token de ADMIN    → pregunta el MODO (ver Flujo 7)
```
Re-vinculación: un token de otra empresa cambia de empresa (no bloquea).

---

## 2. Tarjeta de revisión unificada (núcleo de 018)

Voz, texto y foto convergen en **la misma tarjeta** antes de registrar:

```
🧾 Revisa el registro

Tipo: Venta (salida)
─────────
1. Tubo PVC 1" — 5 × S/2.50 = S/12.50
2. Codo PVC 1" — 10 × S/0.80 = S/8.00
─────────
Total: S/ 20.50

[ ✏️ Corregir ] [ ✅ Confirmar ] [ ❌ Cancelar ]
```

- Construida por `construirTarjeta()` (módulo `tarjeta.ts`, con tests unitarios).
- El pendiente vive en `movimiento_pendiente` hasta confirmar o cancelar.
- `callback_data`: `corregir:<uuid>` / `confirmar:<uuid>` / `cancelar:<uuid>`.

---

## 3. Voz y texto → tarjeta

```
Voz: descarga audio → Groq Whisper → texto   |   Texto: directo
  ├─ ¿texto == "cancelar"? → /cancelar universal (Flujo 6)
  ├─ ¿hay edición de foto/registro en curso? (voz) → "estás en edición"
  └─ NLU → intención:
       · reporte → Flujo 8
       · registro:
           – admin en modo consulta → rechazado (Flujo 7)
           – si no, se crea movimiento_pendiente + tarjeta
```

- La tarjeta **siempre espera tap explícito en `[✅ Confirmar]`** (igual que foto).
  **No hay auto-confirmación** — nada se registra hasta el tap.
- **La transcripción nunca se ecoa al chat** (queda solo en backend, para auditar).

---

## 4. Foto → tipo upfront → Vision → tarjeta

```
Llega foto
  ├─ ¿edición en curso? → "estás en edición"
  ├─ admin modo consulta → rechazado
  └─ guarda solo el file_id en movimiento_pendiente (channel=foto, tipo=null)
     y manda: "📷 Foto recibida. ¿Es Compra o Venta?"  [📦 Compra][💰 Venta][❌ Cancelar]
        └─ Tap Compra/Venta (fototipo:):
             · recién acá se descarga la imagen y se llama a Groq Vision
               (el prompt sabe si es compra o venta)
             · NLU estructura los ítems
             · se reemplaza el mensaje por la TARJETA unificada (sin countdown)
             · el tipo queda BLOQUEADO: si se equivocó, Cancelar y reenviar
```

**Por qué:** no se gasta Vision en fotos canceladas (decisión #4).

---

## 5. Modo edición por campo ([Corregir]) — migración 019

```
Tap [✏️ Corregir]
  → elegir ítem (si hay varios): "¿Qué ítem? Enviá el número (1, 2, 3…)"  [❌ Cancelar]
       (con un solo ítem se salta este paso)
  → "Ítem N: <nombre> — <cant> × S/<precio>   ¿Qué corregís?"  [📝 Nombre][🔢 Cantidad][💲 Precio][❌ Cancelar]
  → toca un campo → "<Campo> actual: <valor>   Enviá el nuevo valor:"  [❌ Cancelar]
  → el operario envía SOLO el dato (sin formato)
       · inválido → "Valor inválido para <Campo>. Enviá solo el dato o /cancelar."
       · OK → actualiza ese campo, recalcula total, vuelve a la TARJETA completa
```

Estados: `asking_item_number → asking_field → asking_value` (+ `editing_field`).
Cada paso **edita el mismo mensaje** (cero mensajes nuevos).

- `/cancelar` (o `[❌ Cancelar]`) **durante la edición vuelve a la tarjeta sin cambios**
  (NO descarta el registro; ver Flujo 6).
- Durante la edición, **una voz o foto no se interpreta** como nuevo registro:
  "Estás en modo edición… Terminá o /cancelar."

---

## 6. `/cancelar` universal (decisión #7)

Comando de escape desde cualquier estado de espera. Dispara por:
- Texto exacto `/cancelar` o `cancelar` (case-insensitive, tolera puntuación).
- Nota de voz cuya transcripción normalizada sea "cancelar".

Acción (edit-aware):
- **En medio de una edición** → vuelve a la tarjeta **sin descartar** (limpia el estado de edición).
- **En estado neutro / tarjeta sin editar** → marca `cancelled` **todos** los pendientes
  activos y responde "✅ Cancelado. Estás en estado neutro."

---

## 7. Admin — modo al registrarse (decisión #8)

```
/start <token_admin>  (nuevo o re-vínculo)
  → "¿Qué modo de admin usarás?"
       [📊 Solo consulta]   → rol=admin, tienda_id=null, modo_admin=consulta
       [📦 Con sede asignada] → elige sede → modo_admin=con_sede, tienda_id=<sede>
```

- **Modo consulta**: ve reportes consolidados, **no registra**. Si intenta registrar
  (voz/texto/foto) → "Tu cuenta está en modo consulta…".
- **Con sede**: registra movimientos y ve reportes.
- Reenviar `/start <token_admin>` vuelve a preguntar el modo (actualiza).

---

## 8. Reportes (decisión #9: vendedor también)

```
NLU detecta intención de reporte
  ├─ vendedor → SIEMPRE scoped a SU sede (ignora override del NLU, sin avisar la restricción)
  └─ admin    → consolidado por defecto; respeta sede mencionada por el NLU
```
Modos: **stock** de un producto puntual, o **ventas** del período (hoy/semana/mes,
hora Perú), con total, ticket promedio y top-5.

Al final del reporte se anexa un **deep-link al dashboard** — *dormido* hasta que
`DASHBOARD_BASE_URL` esté seteado (si está vacío, el link no se incluye).

---

## 9. Confirmar y Deshacer

```
Tap [✅ Confirmar]
  → mapea tipo (compra→ingreso) y registra en movimientos (auto-crea productos)
  → trigger actualiza stock
  → la MISMA tarjeta se edita a "✅ Registrado" (sin botones, sin mensaje nuevo)
```

**Deshacer con `/deshacer` (decisión #10):** ya NO hay botón. El operario escribe
`/deshacer` en el chat y se revierte su **última registración** (el último lote).
- Dentro de **5 minutos** → borra esos movimientos, el trigger revierte el stock
  ("↩️ Registro(s) revertido(s). El stock fue restaurado.").
- Pasados 5 min → "Ventana de reversión vencida. Pedile al admin que lo revierta
  desde el dashboard." (infra: tabla `auditoria_reversiones` + RPC
  `revertir_movimiento_admin`, que usará el dashboard, no el bot).
- El lote es el cluster más reciente de movimientos del operario (creados juntos
  en <3s al confirmar).

---

## Resumen de confirmación por canal

Los tres canales son iguales: **siempre** esperan tap explícito en `[✅ Confirmar]`
(no hay auto-confirmación).

| Canal | Registra | Corrección antes de registrar | Tras registrar |
|-------|----------|-------------------------------|----------------|
| Voz   | Solo con tap `[✅ Confirmar]` | [Corregir] / [Cancelar] | `/deshacer` (5 min) |
| Texto | Solo con tap `[✅ Confirmar]` | [Corregir] / [Cancelar] | `/deshacer` (5 min) |
| Foto  | Solo con tap `[✅ Confirmar]` | [Corregir] / [Cancelar] | `/deshacer` (5 min) |

---

## Dónde mirar si algo falla

- **Bot mudo** → `TELEGRAM_WEBHOOK_SECRET` (paso 0.2).
- **No se registra una foto** → ¿se tocó [Confirmar]? ¿se aplicó migración 018?
- **Un texto se "comió" como corrección** → había una edición en curso (Flujo 5).
- **Nada se registra** → la tarjeta espera tap en `[✅ Confirmar]` (no auto-confirma).
- **Stock no cuadra con el ledger** → `SELECT recalcular_stock();` (ver CLAUDE.md).
