# Guía de Flujos — Agent GMS (bot de Telegram)

> Documento de lectura para **evaluar** los flujos actuales tal como están en
> `supabase/functions/telegram-bot/index.ts` (estado: rama `feat/017-edicion-foto`).
> No es el código; es el mapa de qué pasa en cada caso, paso a paso, para
> detectar dónde están los problemas.

---

## 0. Puerta de entrada (todo update pasa por acá)

Cada vez que Telegram manda algo (mensaje o tap de botón) entra por el webhook:

1. **Solo POST.** Cualquier otro método → `200 ok` y nada más.
2. **Seguridad (fail-closed).** Se exige el header `X-Telegram-Bot-Api-Secret-Token`
   igual a `TELEGRAM_WEBHOOK_SECRET`. Si no coincide (o el secret no está
   configurado) → `401`. Sin esto, el bot **rechaza todo**.
3. **Anti-duplicado.** Inserta `update_id` en `telegram_updates`. Si ya existía
   (Telegram reintentó) → `200` y se descarta. Esto evita registrar dos veces.
4. **Respuesta inmediata + trabajo en background.** Responde `200` enseguida y
   procesa STT/NLU por detrás (`waitUntil`), para que Telegram no reintente
   mientras la IA tarda.

Luego, según lo que llegó, se rutea a UN handler (el primero que matchea gana):

| Llega… | Va a… |
|--------|-------|
| Tap botón `undo_…` | Deshacer |
| Tap botón `join_…` | Elegir sede al registrarse |
| Tap botón `fotocompra_…` / `fotoventa_…` | Foto: fijar Compra/Venta |
| Tap botón `fotoedit_…` | Foto: editar un producto |
| Tap botón `fotook_…` | Foto: confirmar y registrar |
| Tap botón `fotono_…` | Foto: eliminar todo / cancelar |
| Texto `/start …` | Registro |
| Nota de voz | Voz → transcribir → registrar |
| Texto normal | (si hay edición de foto en curso → corrección) si no → registrar |
| Foto | Foto → leer → preguntar Compra/Venta |

> ⚠️ **Punto de evaluación:** el orden importa. El texto normal SIEMPRE pasa
> primero por "¿hay una edición de foto pendiente?". Si quedó una edición
> colgada, el siguiente texto del operario se interpreta como corrección, no
> como movimiento nuevo. (Ver Flujo 5, sección "Gotchas".)

---

## 1. Registro de operario — `/start <token>`

```
Operario escribe: /start <token>
  │
  ├─ Sin token → instrucciones de cómo registrarse. Fin.
  │
  ├─ Busca empresa por telegram_token O telegram_token_admin
  │     └─ No existe / empresa inactiva → "Token inválido". Fin.
  │
  ├─ ¿El token es el de ADMIN?
  │     SÍ → registra DIRECTO como rol=admin, tienda_id=null (ve todas las sedes).
  │          No pregunta sede. Fin.
  │
  └─ Token de OPERARIO (vendedor):
        ├─ ¿Ya registrado en ESTA misma empresa? → "Ya estás registrado". Fin.
        ├─ ¿Registrado en OTRA empresa? → permite cambiar (re-vinculación).
        └─ Muestra botones con las sedes → (sigue en Flujo 2)
```

**Casos especiales que ya están contemplados:**
- `/start` con token de otra empresa → **re-vincula** (no bloquea).
- Admin que quedó atado a una sede por error → reenvía `/start` con token admin
  y se corrige a `tienda_id=null`.

---

## 2. Elegir sede — tap en un botón de sede (`join_…`)

```
Operario toca el botón de su sede
  │
  ├─ Re-valida el token (pudo expirar) → si no, "Token expirado". Fin.
  ├─ Deriva rol (admin o vendedor) según qué token coincidió.
  ├─ ¿Ya estaba en esta empresa? → "Ya tenés cuenta acá". Fin.
  ├─ Valida que la sede pertenezca a la empresa del token (seguridad).
  └─ Crea (INSERT) o re-vincula (UPDATE) el usuario → "¡Registrado!". Fin.
```

A partir de acá el operario ya puede mandar voz / texto / foto.

---

## 3. Nota de VOZ

```
Llega audio
  ├─ Descarga el audio de Telegram
  ├─ Groq Whisper (whisper-large-v3-turbo) → texto transcrito
  └─ Pasa el texto al motor común (Flujo 6, modo "registrar directo")
```

La voz **registra de inmediato** (no pide confirmación). Es el camino rápido.

---

## 4. TEXTO normal

```
Llega texto (no empieza con /)
  ├─ ¿El operario tiene una edición de foto en curso?
  │     SÍ → el texto es la corrección de ese producto (Flujo 5). Fin.
  └─ NO → pasa el texto al motor común (Flujo 6, modo "registrar directo")
```

El texto, igual que la voz, **registra de inmediato**.

---

## 5. FOTO (factura / boleta / remito) — flujo NUEVO (016 + 017)

Este es el flujo que más cambió y el que conviene mirar con lupa.

### 5.1 Llega la foto

```
Llega foto
  ├─ Descarga la imagen
  ├─ Groq Vision (llama-4-scout) → transcribe los renglones (prosa, línea por línea)
  │     └─ Si no hay info de inventario → "No encontré productos". Fin.
  └─ Pasa esa prosa al motor común (Flujo 6, modo "confirmar")
        └─ En modo confirmar NO inserta: estaciona en `foto_pendiente`
           y muestra el PREVIEW.
```

### 5.2 Preview — el operario elige dirección

```
Mensaje PREVIEW:
   🖼️ "Revisá lo que entendí de la foto"
   🗒️ <transcripción de la imagen>
   • Producto × cantidad · precio
   ¿Es una compra o una venta?

   [📦 Compra]  [💰 Venta]
   [❌ Cancelar]
```

- `❌ Cancelar` → borra la foto pendiente. Nada se registra. Fin.
- `📦 Compra` / `💰 Venta` → fija la dirección en los ítems (compra = ingreso,
  venta = venta), **lo guarda** y pasa al DETALLE editable. **Todavía no registra.**

> Idempotente: el operario puede cambiar de opinión y tocar el otro botón.

### 5.3 Detalle editable (017) — el corazón del cambio

```
Mensaje DETALLE (reemplaza al preview):
   📦 Compra — revisá el detalle:

   1. Producto A
      Cantidad: 5
      Precio unitario: S/. 2.00
      Total: S/. 10.00
   2. Producto B
      ...
   💵 Total: S/. ...

   [✏️ Editar Producto A]
   [✏️ Editar Producto B]
   [✅ Confirmar y registrar]
   [🗑️ Eliminar todo]
```

Tres acciones posibles:

- **`✏️ Editar <producto>`** → el bot pide por mensaje:
  `nombre, cantidad, precio` (ej: `Tubo PVC 1", 6, 2.50`).
  El **siguiente texto** del operario corrige ESE producto, refresca el detalle
  (totales y botones) y confirma "✅ Actualizado → …".
- **`✅ Confirmar y registrar`** → recién acá se insertan en `movimientos`
  (auto-crea productos nuevos, actualiza stock por trigger) y manda el mensaje
  final con botones de **Deshacer**.
- **`🗑️ Eliminar todo`** → borra la foto pendiente. Nada se registra. Fin.

**Por qué editar ANTES de registrar:** `movimientos` es un ledger append-only y
el stock se mantiene por trigger en INSERT/DELETE (no en UPDATE). Editar antes de
confirmar evita tocar el stock dos veces.

### 5.4 Gotchas de la foto (PUNTOS DE EVALUACIÓN)

1. **Edición colgada.** Si el operario toca `✏️ Editar` y luego NO manda la
   corrección (se va, manda una voz, otra foto…), queda `editando_index` seteado.
   Su próximo **texto** se tomará como corrección, no como movimiento nuevo.
   Salidas: tocar otra opción del detalle (Confirmar / Eliminar todo) o tocar
   Editar en otro producto. **No hay un "cancelar edición" explícito.**
2. **Sin "Confirmar" la foto no se registra nunca.** El paso extra (Compra/Venta
   → Confirmar) son **dos taps** antes de que entre al inventario. Evaluar si es
   la fricción deseada.
3. **Foto vieja con botones viejos.** Una foto estacionada antes de un deploy
   conserva los botones del flujo anterior; hay que mandar una foto nueva.
4. **Editar cambia el nombre →** el producto se re-resuelve/crea al confirmar
   (se desvincula del `producto_id` que había adivinado la IA).
5. **Múltiples fotos pendientes a la vez.** La corrección de texto agarra la más
   reciente que tenga edición en curso; con varias fotos abiertas puede confundir.

---

## 6. Motor común NLU (lo comparten voz, texto y foto)

```
Texto/prosa entra
  ├─ Busca al usuario por telegram_id + el modelo NLU de su empresa
  │     └─ No registrado → "Tu cuenta no está registrada". Fin.
  ├─ Carga catálogo de productos y tiendas de la empresa
  ├─ Llama al NLU (groq-llama / anthropic-haiku / anthropic-sonnet) que decide:
  │
  │   A) ¿Es un REPORTE? (pregunta: "¿cuánto vendí hoy?", "stock de cemento")
  │        → Flujo 7 (solo admins; vendedor recibe aviso de permiso)
  │
  │   B) ¿Es un REGISTRO? (afirmación: "vendí 3 tubos")
  │        → arma lista de movimientos
  │
  ├─ ¿Modo "confirmar" (foto)? → estaciona en foto_pendiente + preview (Flujo 5)
  └─ ¿Modo "directo" (voz/texto)? → inserta movimientos ya (abajo)
```

**Al insertar (`insertarMovimientos`):**
- Auto-crea productos que no estén en el catálogo (categoría "General").
- Resuelve la tienda por defecto (la del operario; ingreso/traslado tienen reglas).
- Inserta en `movimientos` → el trigger actualiza `stock`.
- Manda confirmación con un botón **Deshacer** por producto (+ "Deshacer todo"
  si hay varios y la lista de ids entra en el límite de 64 bytes de Telegram).

> ⚠️ **Punto de evaluación:** ante la duda entre reporte y registro, el NLU
> asume REGISTRO. Una pregunta mal redactada puede registrar un movimiento.

---

## 7. REPORTES (solo admin) — por voz o texto

```
NLU detecta intención de reporte
  ├─ ¿El usuario es admin? NO → "Los reportes son solo para administradores". Fin.
  └─ SÍ:
       ├─ ¿Pidió stock de un producto puntual? → muestra stock actual por sede.
       └─ Si no, reporte de ventas del período (hoy / semana / mes, hora Perú):
            total, ticket promedio y top-5 productos por venta
            (opcionalmente filtrado por sede).
```

---

## 8. DESHACER (`undo_…`) — disponible tras registrar

```
Operario toca "↩️ Deshacer"
  ├─ Verifica que los movimientos sean de SU empresa (seguridad)
  ├─ DELETE de esos movimientos → el trigger revierte el stock
  └─ Edita el mensaje: "↩️ Registro(s) revertido(s)"
```

Aplica a lo registrado por voz, texto y **foto confirmada** (no a la foto en
preview/detalle: ahí se usa "Eliminar todo").

---

## Resumen de "momentos de confirmación" por canal

| Canal | ¿Pide confirmación antes de registrar? | ¿Cómo se corrige? |
|-------|----------------------------------------|-------------------|
| Voz   | No, registra directo                   | Botón Deshacer |
| Texto | No, registra directo                   | Botón Deshacer |
| Foto  | Sí: Compra/Venta → (editar) → Confirmar | Editar en el detalle, o Deshacer ya registrado |

---

## Dónde mirar si algo falla

- **El bot no responde a nada** → revisar `TELEGRAM_WEBHOOK_SECRET` (paso 0.2).
- **Registra dos veces** → revisar `telegram_updates` / trigger de stock.
- **Foto no registra** → ¿llegaron a tocar "✅ Confirmar"? ¿se aplicó la
  migración 017? (columnas `editando_index`, `detalle_message_id`).
- **Un texto se "comió" como corrección** → había una edición de foto colgada
  (gotcha 5.4.1).
- **Stock no cuadra con el ledger** → `SELECT recalcular_stock();` (ver CLAUDE.md).
