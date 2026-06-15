# Flujos por Rol — Agent GMS

> Documento **de evaluación**. Lista TODOS los flujos que hoy existen, separados
> por rol (Operador / Administrador) y por canal (Telegram / Web).
> Fuente: `supabase/functions/telegram-bot/index.ts` y `frontend/` (según CLAUDE.md).
> Para cada flujo: **disparador · precondición · pasos · resultado · gating · casos borde**.
> No describe cambios propuestos, solo el estado actual.

---

## Mapa rápido de roles

| | Operador (`vendedor`) | Administrador (`admin`) |
|---|---|---|
| Se registra con | `telegram_token` (+ elige sede) | `telegram_token_admin` (sin sede, ve todas) |
| `tienda_id` | Una sede fija | `null` (todas las sedes) |
| Registrar por voz/texto/foto | ✅ | ✅ |
| Deshacer | ✅ | ✅ |
| Reportes por voz/texto (Telegram) | ❌ (recibe aviso de permiso) | ✅ |
| Cuenta web (Supabase Auth) | ❌ (no tiene; es solo-Telegram) | ✅ (creada en el onboarding) |
| Panel web (dashboard, movimientos, inventario, reportes, config, usuarios) | ❌ (no puede loguearse) | ✅ |
| Ajuste de inventario (web) | ❌ | ✅ (único web con gate por rol) |

> Notas:
> - En Telegram, **admin también puede registrar movimientos** (no está
>   restringido a reportes). El único gate por rol en el bot es el de reportes.
> - En la web, el `middleware.js` solo exige **estar logueado**, no chequea rol;
>   pero como el operador no tiene cuenta Auth, en la práctica la web es del admin.
>   El único gate por rol explícito es ocultar "Ajuste de inventario" a no-admins.

---

# PARTE A — OPERADOR (vendedor)

Canal: **solo Telegram**. El operador no usa el panel web.

## A1. Registro del operador — `/start <token de operador>`

- **Disparador:** el operador escribe `/start <token>` (token de operador).
- **Precondición:** el admin le pasó el `telegram_token` de la empresa.
- **Pasos:**
  1. Bot busca empresa por `telegram_token` o `telegram_token_admin`.
  2. Token de operador → muestra botones con las **sedes** de la empresa.
  3. El operador toca su sede (callback `join_<token>_<tiendaId>`).
  4. Bot valida que la sede pertenezca a esa empresa y crea el usuario
     (`rol=vendedor`, `tienda_id=<sede>`, `empresa_id`).
- **Resultado:** "✅ ¡Registrado!" con empresa + sede + rol. Ya puede operar.
- **Gating:** ninguno especial (cualquiera con el token entra).
- **Casos borde:**
  - Token inválido / empresa inactiva → "Token inválido".
  - Ya registrado en **esta** empresa → "Ya estás registrado" (no repite).
  - Registrado en **otra** empresa → re-vincula (cambia de empresa).
  - Token expirado al tocar la sede → "Token expirado".
  - **Punto a evaluar:** no hay verificación de identidad — cualquiera con el
    token se registra como operador.

## A2. Registrar movimiento por VOZ

- **Disparador:** el operador manda una nota de voz.
- **Precondición:** estar registrado.
- **Pasos:**
  1. Descarga audio → Groq Whisper → texto.
  2. Motor NLU interpreta y arma movimientos.
  3. **Inserta de inmediato** en `movimientos` (sin confirmación).
  4. Trigger actualiza `stock`.
- **Resultado:** confirmación con detalle + botón **↩️ Deshacer** por producto
  (y "Deshacer todo" si hay varios).
- **Gating:** ninguno (operador puede registrar).
- **Casos borde:**
  - No se entiende → "No entendí…" con ejemplo.
  - Producto no está en catálogo → se **auto-crea** (categoría General).
  - La sede por defecto del movimiento es la del operador.
  - **Punto a evaluar:** registra sin pedir confirmación; el único control es
    Deshacer a posteriori.

## A3. Registrar movimiento por TEXTO

- **Disparador:** el operador escribe un texto (que no empiece con `/`).
- **Pasos:** idénticos a A2 desde el paso 2 (sin STT).
- **Casos borde:**
  - **Importante:** si el operador tenía una **edición de foto en curso**, su
    texto se interpreta como la corrección de ese producto (Flujo A4.3), NO como
    un movimiento nuevo. (Ver gotcha en A4.)

## A4. Registrar movimiento por FOTO (flujo 016 + 017)

El flujo más largo. Tres etapas.

### A4.1 — Llega la foto
- **Disparador:** el operador manda una foto (factura/boleta/remito).
- **Pasos:**
  1. Descarga imagen → Groq Vision → transcribe los renglones (línea por línea).
  2. Motor NLU arma los movimientos.
  3. **No inserta**: estaciona en `foto_pendiente` y muestra el **PREVIEW**.
- **Casos borde:** si la imagen no tiene inventario → "No encontré productos".

### A4.2 — Preview: elegir Compra o Venta
```
🖼️ Revisá lo que entendí de la foto
🗒️ <transcripción>
• Producto × cantidad · precio
¿Es una compra o una venta?
[📦 Compra] [💰 Venta]
[❌ Cancelar]
```
- `❌ Cancelar` → borra la pendiente, nada se registra.
- `📦 Compra` / `💰 Venta` → fija la dirección (compra=ingreso, venta=venta),
  guarda, y pasa al detalle editable. **Todavía no registra.** (Idempotente:
  puede cambiar de opinión y tocar el otro botón.)

### A4.3 — Detalle editable
```
📦 Compra — revisá el detalle:
1. Producto A | Cantidad: 5 | Precio unitario: S/.2.00 | Total: S/.10.00
2. Producto B | ...
💵 Total: S/. ...
[✏️ Editar Producto A]
[✏️ Editar Producto B]
[✅ Confirmar y registrar]
[🗑️ Eliminar todo]
```
- **✏️ Editar `<producto>`** → bot pide `nombre, cantidad, precio`. El siguiente
  **texto** del operador corrige ese ítem, refresca el detalle y confirma.
- **✅ Confirmar y registrar** → recién acá inserta en `movimientos`
  (auto-crea productos, trigger actualiza stock) y manda confirmación con
  botones **Deshacer**.
- **🗑️ Eliminar todo** → borra la pendiente, nada se registra.

- **Gating:** ninguno (operador puede usar foto).
- **Casos borde / PUNTOS A EVALUAR:**
  1. **2 taps mínimo** para registrar (Compra/Venta → Confirmar).
  2. **Edición colgada:** si toca "✏️ Editar" y no manda la corrección, su
     próximo texto se toma como corrección (no como movimiento nuevo). No hay
     botón "cancelar edición"; sale tocando otra opción del detalle.
  3. **Sin tocar Confirmar, la foto nunca se registra.**
  4. Editar el nombre → el producto se re-resuelve/crea al confirmar.
  5. Varias fotos pendientes a la vez → la corrección agarra la más reciente.
  6. Foto estacionada antes de un deploy conserva botones viejos.

## A5. Deshacer un registro — `↩️ Deshacer`

- **Disparador:** el operador toca Deshacer en la confirmación.
- **Pasos:**
  1. Verifica que los movimientos sean de **su empresa** (seguridad).
  2. DELETE → el trigger revierte el stock.
  3. Edita el mensaje: "↩️ Registro(s) revertido(s)".
- **Casos borde:** si el registro ya no existe / no es de su empresa → aviso.

## A6. Intento de REPORTE (bloqueado para operador)

- **Disparador:** el operador pregunta algo tipo "¿cuánto vendí hoy?".
- **Pasos:** el NLU detecta intención de reporte → como **no es admin**, recibe:
  "🔒 Los reportes están disponibles solo para administradores."
- **Punto a evaluar:** el bloqueo es intencional; el operador no ve ventas.

---

# PARTE B — ADMINISTRADOR

El admin opera en **dos canales**: Telegram (registrar + reportes) y Web (panel).

## B-Telegram

### B1. Registro del admin — `/start <token admin>`
- **Disparador:** `/start <telegram_token_admin>`.
- **Pasos:** registra DIRECTO como `rol=admin`, `tienda_id=null`. **No pregunta
  sede** (ve todas). Upsert por `telegram_id`.
- **Casos borde:**
  - Admin ya registrado que reenvía `/start` admin → se re-aplica `rol=admin`,
    `tienda_id=null` (sirve para corregir un admin atado a una sede).
  - Token admin de otra empresa → re-vincula.

### B2 / B3 / B4. Registrar por voz / texto / foto
- **Igual que A2 / A3 / A4** — el admin también registra movimientos.
- Diferencia: como `tienda_id=null`, la resolución de sede por defecto del
  movimiento puede comportarse distinto que para un operador con sede fija.
  **Punto a evaluar:** ¿a qué sede se imputan los movimientos que registra un
  admin sin sede?

### B5. Deshacer — igual que A5 (scoped a su empresa).

### B6. REPORTES por voz o texto (solo admin)
- **Disparador:** el admin pregunta por voz/texto (ej: "reporte de la semana",
  "stock de cemento", "ventas de la sede Centro").
- **Pasos:** el NLU clasifica intención de reporte y:
  - **Modo stock puntual** (mencionó un producto) → stock actual de ese producto
    por sede, con total.
  - **Modo ventas del período** → `hoy` / `semana` / `mes` (hora Perú UTC-5):
    total vendido, ticket promedio y **top-5 productos** por venta. Opcional:
    filtrar por una sede mencionada.
- **Gating:** solo `rol=admin`. (Operador → aviso de permiso, ver A6.)
- **Casos borde:**
  - Producto/sede no encontrado → aviso de "no encontré…".
  - Sin datos en el período → mensaje claro (no ceros).
  - **Punto a evaluar:** ambigüedad reporte vs registro — ante la duda el NLU
    asume **registro**, así que una pregunta mal redactada podría registrar.

## B-Web (panel de administración, Next.js) — verificado contra `frontend/`

> **Quién entra a la web:** el `middleware.js` solo exige estar **logueado**
> (sesión de Supabase Auth con `empresa_id` en `app_metadata`); **no** filtra por
> rol. En la práctica, **solo el admin** tiene cuenta web: el usuario Auth se crea
> en el onboarding. El operador (vendedor) se crea **solo en Telegram** (fila en
> `usuarios`, sin cuenta Auth), así que **no puede loguearse en la web**.
>
> **Navegación (Sidebar):** Dashboard · Movimientos · Inventario · Reportes, y bajo
> "ADMINISTRACIÓN": Usuarios · Configuración · (Ajuste de inventario solo si
> `app_metadata.rol === 'admin'`). **Punto a evaluar:** Usuarios y Configuración
> se muestran a cualquier logueado; solo "Ajuste" se oculta a no-admins (y aun así
> la ruta `/admin/ajuste` no está protegida por rol en el middleware).

### B7. Onboarding de empresa — `/registro` (público)
- **Disparador:** un cliente nuevo completa el formulario.
- **Campos del form:** nombre de empresa, **rubro**, email del admin, y **1..20
  sedes** (agregar/quitar dinámicamente, mínimo 1).
- **Pasos:** `POST` a la Edge Function `onboarding` (URL **hardcodeada** en el
  código) → crea empresa + sedes + usuario Auth (rol admin) + genera
  `telegram_token` y `telegram_token_admin` + email vía Resend.
- **Pantalla de éxito:** muestra la **contraseña temporal** (con aviso "no se
  vuelve a mostrar"), 3 próximos pasos y botón "Ir al dashboard".
- **Casos borde / PUNTOS A EVALUAR:** sin captcha ni rate-limit; la contraseña
  temporal se muestra en pantalla (además del email); URL del endpoint hardcodeada.

### B8. Login — `/login`
- **Modo login:** `signInWithPassword`; tras autenticar, exige `empresa_id` en
  `app_metadata` (si falta → cierra sesión y avisa). Redirige a `?redirect` o `/`.
- **Modo recuperación:** "¿Olvidaste tu contraseña?" → `resetPasswordForEmail`
  (manda link al email) → pantalla "Revisá tu correo".
- **Punto a evaluar:** mensaje de error genérico ("correo o contraseña
  incorrectos") — correcto por seguridad.

### B9. Dashboard — `/` (`app/page.js`)
- **KPIs (4 tarjetas):** Ventas, Stock recibido (valor de ingresos), Gastos,
  Operaciones por voz (conteo de movimientos).
- **Filtros:** sucursal (todas / una) + rango (Hoy / 7 días / 30 días).
- **Indicador realtime:** "TELEGRAM VINCULADO REALTIME" / "SIN CONEXIÓN" según el
  hook de realtime; los movimientos nuevos entran en vivo a la tabla y suman KPIs.
- **Alertas de stock:** top 4 productos bajo su `stock_minimo`; el negativo se
  marca aparte ("revisar movimientos").
- **Tabla:** últimos 20 movimientos con tipo, producto, cantidad, total, sucursal,
  hora relativa y la **transcripción** del audio.
- **Punto a evaluar:** el gráfico "Evolución de Ventas vs Gastos" es un **SVG
  estático/decorativo** (no refleja datos reales).

### B10. Inventario — `/inventario`
- **KPIs:** valor total del inventario (stock × costo), nº de productos, nº de
  alertas de quiebre.
- **Filtros:** búsqueda por nombre, categoría, tienda.
- **Tabla pivote:** una fila por producto con stock **por cada tienda**, total,
  stock mínimo, costo, precio sugerido y valorización.
- **Edición inline** del `stock_minimo` por producto (lápiz; Enter guarda, Escape
  cancela).
- **Alta manual de producto (modal "Nuevo Producto"):** nombre*, categoría
  (datalist), costo, precio venta, stock mín. → crea el producto en el catálogo
  (aparece en la tabla recién cuando tenga su primer movimiento de stock).
- **Exportar** a Excel (.xlsx).

### B11. Movimientos — `/movimientos`
- **Lista** de los últimos 100 movimientos (tipo, producto, cantidad, P. unit.,
  total, sucursal, fecha) con filtros (búsqueda, tipo —incluye `ajuste`—, tienda).
- **Undo por fila** ("Control"): pide confirmación (`confirm()`), borra el
  movimiento (el trigger revierte stock) y muestra un toast. **Es el equivalente
  web del Deshacer de Telegram** (no caduca como el botón inline).
- **Exportar:** Excel y **PDF** (el PDF lleva nombre de empresa + `rubro` en el
  encabezado).
- Para `ajuste` muestra el **motivo** debajo del badge.

### B12. Reportes — `/reportes`
- **Centro de descargas.** Parámetros: sucursal + rango (Hoy / 7d / 30d /
  Histórico). Tres reportes, cada uno en **Excel o PDF**:
  1. **Ventas** (solo tipo `venta`).
  2. **Valorización de almacén** (stock pivoteado por tienda × costo).
  3. **Historial de transacciones** (todos los movimientos).
- **Punto a evaluar:** es solo exportación (no muestra gráficos/tablas en
  pantalla); se solapa parcialmente con los export de B10/B11.

### B13. Configuración — `/admin/config`
- **Rubro del negocio:** editar el `rubro` (afecta prompts del bot y encabezado
  de PDFs).
- **Modelo NLU:** elegir entre `groq-llama` (Recomendado), `anthropic-haiku`
  (Balanceado), `anthropic-sonnet` (Premium); guarda en `empresas.nlu_model`.
- **Consumo acumulado:** tabla agregada de `consumo_ia` (llamadas, tokens, costo
  USD por modelo) + total.

### B14. Usuarios — `/admin/usuarios`
- **Token de operario:** muestra `/start <telegram_token>` (copiar comando o solo
  el token) para repartir al equipo.
- **Token de administrador:** muestra `/start <telegram_token_admin>` con aviso de
  "no compartir", y botón **"generar nuevo"** que **rota** el token admin
  (`crypto.randomUUID()` → UPDATE; invalida el anterior).
- **Operarios conectados:** tabla de `usuarios` (nombre, rol, sede, fecha de
  vínculo).
- **Punto a evaluar:** no hay forma de **desvincular/eliminar** un operario desde
  acá, ni de rotar el token de operario (solo el admin).

### B15. Ajuste de inventario — `/admin/ajuste` (único web **admin-only**)
- **Disparador:** conteo físico. El admin elige tienda + escribe **motivo
  obligatorio**, ingresa la **cantidad contada** por producto.
- **Pasos:** el sistema calcula la **diferencia con signo** (contado − sistema);
  solo los productos con diferencia ≠ 0 generan un movimiento `tipo='ajuste'`
  (firmado) sobre esa tienda. El trigger ajusta el stock; cada ajuste es
  **reversible** desde `/movimientos`.
- **Canal exclusivo:** el bot de Telegram **nunca** genera ajustes (solo la web).
- **Gating:** oculto en el sidebar para no-admins (es el único con gate por rol).

---

# PARTE C — Motor común y reglas transversales

## C1. Puerta de entrada (todo update)
1. Solo POST; resto → 200.
2. Seguridad fail-closed: header secret debe igualar `TELEGRAM_WEBHOOK_SECRET`,
   si no → 401.
3. Anti-duplicado por `update_id` (tabla `telegram_updates`).
4. Responde 200 inmediato y procesa en background (STT/NLU pueden tardar >5s).

## C2. Motor NLU (compartido por voz, texto, foto)
- Resuelve usuario por `telegram_id` → si no existe, "no registrado".
- Carga catálogo (productos + tiendas) de la empresa.
- El NLU decide intención: **reporte** (Flujo B6) o **registro**.
- En foto = modo "confirmar" (estaciona); en voz/texto = inserta directo.
- Al insertar: auto-crea productos faltantes, resuelve sede por defecto, inserta,
  trigger actualiza stock, manda confirmación con Deshacer.

## C3. Matriz de gating por rol (resumen)

| Acción | Operador | Admin |
|---|---|---|
| Registrar (voz/texto/foto) en Telegram | ✅ | ✅ |
| Deshacer en Telegram | ✅ | ✅ |
| Reporte por voz/texto (Telegram) | ❌ aviso | ✅ |
| Loguearse en la web | ❌ (sin cuenta Auth) | ✅ |
| Dashboard / Movimientos / Inventario / Reportes / Config / Usuarios (web) | ❌ | ✅ |
| Ajuste de inventario (web) | ❌ (gate por rol) | ✅ |

> Matiz de seguridad a evaluar: el gate real de la web es "tener cuenta Auth con
> `empresa_id`", no el rol. Si algún día se le creara cuenta Auth a un vendedor,
> entraría a casi todo el panel (salvo Ajuste). Hoy no pasa porque los operarios
> son solo-Telegram.

## C4. Riesgos / puntos abiertos para evaluar
- Foto: 2 taps antes de registrar; edición colgada secuestra el siguiente texto.
- NLU ante duda asume registro (puede registrar una pregunta).
- Registro sin verificación de identidad (cualquiera con el token).
- `/registro` sin captcha/rate-limit.
- Imputación de sede cuando el que registra es un admin (`tienda_id=null`).
- Stock se mantiene por trigger (INSERT/DELETE); editar filas no lo recalcula
  (por eso la foto edita ANTES de registrar).

---

> Para evaluar: marcá en cada flujo qué querés cambiar (fricción, gating,
> mensajes, orden de pasos) y lo abordamos uno por uno.
