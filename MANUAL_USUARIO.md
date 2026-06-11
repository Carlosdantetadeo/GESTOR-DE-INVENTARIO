# Manual de Usuario — Agent GMS

Sistema de inventario por voz para ferreterías. Registrá ventas e ingresos en 2 segundos desde Telegram.

**Dashboard web:** https://gestor-de-inventario-one.vercel.app

---

## 1. Registro de empresa (administrador)

### Paso 1 — Crear tu empresa

1. Entrá a: **https://gestor-de-inventario-one.vercel.app/registro**
2. Completá el formulario:
   - **Nombre de la empresa** — ej: `Ferretería Los Andes`
   - **Email del administrador** — tu email corporativo
   - **Sedes** — agregá tus sucursales (mínimo 1, máximo 20)
3. Hacé clic en **Crear empresa**

### Paso 2 — Guardá tus credenciales

Al registrarte exitosamente verás en pantalla:

```
Tu contraseña temporal: GMS-XXXXXXXX
```

> ⚠️ Guardá esta contraseña ahora. No se vuelve a mostrar.
> También llega un email a tu casilla con las credenciales y el **token de Telegram** de tu empresa.

### Paso 3 — Ingresá al dashboard

1. Andá a: **https://gestor-de-inventario-one.vercel.app/login**
2. Ingresá con tu email y la contraseña temporal
3. Para cambiar la contraseña usá **"¿Olvidaste tu contraseña?"** en la pantalla de login: te llega un email con un link para crear una nueva

---

## 2. Conectar empleados al bot de Telegram

Cada empleado que vaya a registrar ventas necesita vincularse al bot.

### Paso 1 — El administrador comparte el token

El token de tu empresa está en el dashboard, sección **Usuarios**: ahí ves el comando `/start TOKEN` listo para copiar y compartir. También llegó en el email de bienvenida.

Guardalo en un lugar seguro: es único para tu empresa y es lo que vincula a tus empleados con tus datos.

### Paso 2 — El empleado envía el comando al bot

En Telegram, el empleado busca el bot y envía:

```
/start TOKEN_DE_LA_EMPRESA
```

Ejemplo:
```
/start fae26c3e-1716-40a4-8090-aa605d513ec3
```

### Paso 3 — Elegir sede

El bot muestra botones con las sedes disponibles. El empleado toca la sede donde trabaja.

```
✅ ¡Registrado exitosamente!
🏢 Empresa: Ferretería Los Andes
📍 Sede: Sede Centro
```

Listo. Ya puede empezar a registrar movimientos.

> La sede elegida queda fija para ese empleado: todos sus registros se asignan
> a esa sede por defecto (ver sección 8). Si envía `/start` de nuevo, el bot
> le confirma que ya está registrado — una cuenta de Telegram solo puede
> pertenecer a una empresa.

---

## 3. Registrar movimientos desde Telegram

El bot acepta **voz**, **texto** e **imágenes**.

### 3.1 Nota de voz (recomendado)

Grabá un mensaje de voz en Telegram. Hablá claro y mencioná:
- Qué tipo de movimiento (vendí, entró, gasté, trasladé)
- El producto
- La cantidad
- El precio (opcional)

**Ejemplos de frases:**

| Lo que decís | Lo que registra |
|---|---|
| `"Vendí 3 caños de 2 pulgadas a 5 soles"` | Venta × 3, S/. 15.00 |
| `"Entró una caja de tornillos de 1 pulgada"` | Ingreso × 1 |
| `"Gasté 2 latas de pintura a 25 soles"` | Gasto × 2, S/. 50.00 |
| `"Trasladé 5 bombas a la sede norte"` | Traslado × 5 |
| `"Vendí 3 bombas a 5 soles y 2 codos a 3 soles"` | 2 movimientos en un solo audio |

Podés mencionar varios productos en un mismo mensaje: el bot crea un movimiento por cada uno.

### 3.2 Mensaje de texto

Escribí directamente en el chat del bot, igual que hablarías:

```
Vendí 2 llaves de paso a 8 soles
```

```
Ingresé 10 tubos PVC media pulgada
```

### 3.3 Foto o imagen

Enviá una foto de:
- Una factura o remito
- Una pizarra con productos y cantidades
- Una etiqueta de stock

El bot responde "🔍 Analizando imagen...", interpreta lo que ve y registra los movimientos que detecte. Si la imagen no tiene información de inventario, te lo avisa.

---

## 4. Confirmación del bot

Después de cada registro el bot responde con el resumen y **un botón Deshacer por cada producto**. Si registraste más de un producto, agrega también un botón **"Deshacer todo"**:

```
✅ 2 movimientos registrados

💰 Bomba 2 pulgadas × 3 — S/. 15.00
   📍 Sede Centro

📦 Tubo PVC × 2
   📍 Sede Centro

💵 Total: S/. 15.00

Deshacer individual o todo desde los botones.

[ ↩️ Bomba 2 pulgadas ]
[ ↩️ Tubo PVC ]
[ ↩️ Deshacer todo ]
```

Si algún producto no se entendió, el mensaje lo indica:

```
⚠️ 1 producto(s) no se entendieron — repetílos en un nuevo mensaje.
```

---

## 5. Deshacer un registro

Si cometiste un error, usá los botones debajo del mensaje de confirmación:

- **↩️ [nombre del producto]** — revierte solo ese movimiento
- **↩️ Deshacer todo** — revierte todos los movimientos de ese mensaje

En ambos casos:
- El movimiento se elimina
- El stock se restaura automáticamente al valor anterior
- Podés volver a enviar el mensaje con el dato correcto

> El botón Deshacer funciona en cualquier momento, no solo inmediatamente después.
> Solo podés deshacer movimientos de tu propia empresa.

> Nota: en mensajes con muchos productos el botón "Deshacer todo" puede no
> aparecer (límite técnico de Telegram). Los botones individuales están siempre.

---

## 6. Productos nuevos

**No necesitás cargar el catálogo de antemano.** Si mencionás un producto que no existe, el bot lo crea automáticamente en la categoría `General`, con el precio y costo que hayas mencionado.

Si el producto ya existía con otra escritura (mayúsculas, etc.), el bot lo reconoce y usa el existente en vez de duplicarlo.

> Por ahora la edición de productos (nombre, categoría, precios) no está
> disponible desde el dashboard. El precio sugerido y el último costo se
> actualizan automáticamente con cada **ingreso** que registre un costo.

---

## 7. Dashboard web

Accedé desde: **https://gestor-de-inventario-one.vercel.app**

### Secciones del menú

| Sección | Qué muestra |
|---------|-------------|
| **Dashboard** | KPIs del período (ventas, stock recibido, gastos, operaciones), alertas de stock bajo y los últimos movimientos en tiempo real con su transcripción de audio. |
| **Movimientos** | Historial completo con filtros por producto, tipo y sede. Exportar a Excel o PDF. Botón Deshacer por fila. |
| **Inventario** | Stock actual por producto y sede (una columna por sede), valor total del inventario, alertas de quiebre. Exportar a Excel. |
| **Reportes** | Tres reportes descargables: Ventas, Valorización de almacén e Historial de transacciones. Filtros por sede y período, en Excel o PDF. |
| **Usuarios** | Token de Telegram de tu empresa (con botón de copiado) y lista de operarios conectados con su sede y fecha de vinculación. |
| **Configuración** | Elegir el modelo de IA que procesa los mensajes del bot y ver el consumo acumulado (llamadas, tokens, costo). |

### Filtros disponibles

- **Por sede** — ver solo los movimientos o stock de una sucursal
- **Por tipo** — ventas / ingresos / gastos / traslados
- **Por período** — hoy / últimos 7 días / último mes
- **Por producto** — búsqueda por nombre

### Exportar datos

- En **Movimientos**: botones **Excel** (`.xlsx`) y **Descargar PDF** con los datos filtrados
- En **Inventario**: botón **Exportar Inventario (.xlsx)** con stock por sede y valorización
- En **Reportes**: cada reporte se descarga en Excel o PDF con los filtros elegidos

### Revertir movimientos desde el dashboard

En la tabla de **Movimientos**, cada fila tiene un botón **Undo**. Pide confirmación antes de revertir y restaura el stock automáticamente, igual que el botón de Telegram.

### Configuración del modelo de IA (administrador)

En **Configuración** podés elegir qué modelo interpreta los mensajes de tus operarios:

| Modelo | Perfil | Costo aproximado |
|--------|--------|------------------|
| **Groq Llama 3.3** (recomendado) | Rápido y económico, ideal para el día a día | ~$0.37 / 1,000 mensajes |
| **Claude Haiku** | Mayor precisión para descripciones complejas | ~$0.80 / 1,000 mensajes |
| **Claude Sonnet** | Máxima precisión, para operaciones de alto valor | ~$3.00 / 1,000 mensajes |

Debajo del selector se muestra el **consumo acumulado** de tu empresa: cantidad de llamadas, tokens y costo total en USD por modelo.

---

## 8. Tipos de movimiento

| Tipo | Cuándo usarlo | Efecto en stock |
|------|--------------|-----------------|
| `venta` | Vendiste un producto a un cliente | Resta stock en tu sede |
| `ingreso` | Llegó mercadería del proveedor | Suma stock en tu sede |
| `gasto` | Usaste material interno (no venta) | Resta stock en tu sede |
| `traslado` | Moviste stock entre sedes | Resta en tu sede, suma en la sede destino |

> Por defecto todo se registra en **tu sede** (la que elegiste al vincularte).
> Si el movimiento es en otra sede, mencionala: *"vendí 2 tubos en la sede norte"*.
> En los **traslados** mencioná siempre la sede destino: *"trasladé 5 bombas a la sede norte"*.

---

## 9. Preguntas frecuentes

**¿Qué pasa si el bot no entiende el producto?**
El bot avisa cuántos productos no pudo registrar. Repetílos en un mensaje separado siendo más claro con el nombre.

**¿Puedo registrar en cualquier sede desde el mismo Telegram?**
Tu sede por defecto es fija, pero podés registrar en otra sede mencionándola en el mensaje: *"vendí 3 codos en la sede sur"*.

**¿El stock se actualiza en tiempo real?**
Sí. El dashboard muestra los movimientos en tiempo real. No hace falta recargar la página — el indicador verde arriba a la derecha confirma la conexión.

**¿Puedo tener varios operarios en la misma empresa?**
Sí, sin límite. Cada uno se registra con `/start TOKEN` y elige su sede.

**¿Qué pasa si mando el audio y no llega confirmación?**
Esperá unos segundos: el procesamiento de voz puede demorar. Si no llega respuesta, revisá tu conexión y reenviá el mensaje. Si por error quedó registrado dos veces, usá el botón **Deshacer** del mensaje duplicado.

**¿Cómo cambio la contraseña?**
Desde el login, con **"¿Olvidaste tu contraseña?"**: te llega un email con el link para crear una nueva.

**¿Puedo deshacer un movimiento de otro empleado?**
Desde Telegram solo se pueden deshacer movimientos de tu empresa (cualquier operario de la empresa puede tocar los botones de un mensaje). Desde el dashboard, el administrador puede revertir cualquier movimiento de la empresa con el botón **Undo**.
