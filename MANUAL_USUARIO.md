# Manual de Usuario — Agent GMS

Sistema de inventario por voz para ferreterías. Registrá ventas e ingresos en 2 segundos desde Telegram.

---

## 1. Registro de empresa (administrador)

### Paso 1 — Crear tu empresa

1. Entrá a: **https://gestor-de-inventario-one.vercel.app/registro**
2. Completá el formulario:
   - **Nombre de la empresa** — ej: `Ferretería Los Andes`
   - **Email del administrador** — tu email corporativo
   - **Sedes** — agregá todas las sucursales que tenés (podés agregar más después)
3. Hacé clic en **Crear empresa**

### Paso 2 — Guardá tus credenciales

Al registrarte exitosamente verás en pantalla:

```
Tu contraseña temporal: GMS-XXXXXXXX
```

> ⚠️ Guardá esta contraseña ahora. No se vuelve a mostrar.
> También llega un email a tu casilla con las credenciales y el token de Telegram.

### Paso 3 — Ingresá al dashboard

1. Andá a: **https://gestor-de-inventario-one.vercel.app/login**
2. Ingresá con tu email y la contraseña temporal
3. Cambiá la contraseña desde el perfil en tu primer acceso

---

## 2. Conectar empleados al bot de Telegram

Cada empleado que vaya a registrar ventas necesita vincularse al bot.

### Paso 1 — El administrador comparte el token

El `telegram_token` de tu empresa llegó en el email de bienvenida. También podés encontrarlo en el SQL Editor de Supabase:

```sql
SELECT nombre, telegram_token FROM empresas LIMIT 1;
```

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

El bot muestra un teclado con las sedes disponibles. El empleado toca la sede donde trabaja.

```
✅ ¡Registrado exitosamente!
🏢 Empresa: Ferretería Los Andes
📍 Sede: Sede Centro
```

Listo. Ya puede empezar a registrar movimientos.

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

Límite práctico: hasta **5-6 productos** por mensaje de voz.

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

El bot analiza la imagen y registra los movimientos que detecte.

---

## 4. Confirmación del bot

Después de cada registro el bot responde con el resumen:

```
✅ 2 movimientos registrados

💰 Bomba 2 pulgadas × 3 — S/. 15.00
   📍 Sede Centro

📦 Tubo PVC × 2
   📍 Sede Centro

💵 Total: S/. 15.00

¿Hubo un error? Pulsá Deshacer para revertir.

[↩️ Deshacer]
```

---

## 5. Deshacer un registro

Si cometiste un error, tocá el botón **↩️ Deshacer** que aparece debajo del mensaje de confirmación.

- El movimiento se elimina
- El stock se restaura automáticamente al valor anterior
- Podés volver a enviar el audio con el dato correcto

> El botón Deshacer funciona en cualquier momento, no solo inmediatamente después.

---

## 6. Productos nuevos

**No necesitás cargar el catálogo de antemano.** Si mencionás un producto que no existe, el bot lo crea automáticamente en la categoría `General`.

Luego podés editar el nombre, categoría o precio desde el dashboard.

---

## 7. Dashboard web

Accedé desde: **https://gestor-de-inventario-one.vercel.app**

### Secciones principales

| Sección | Qué muestra |
|---------|-------------|
| **Dashboard** | KPIs del día: ventas, ingresos, gastos. Últimos movimientos en tiempo real. |
| **Movimientos** | Historial completo con filtros por tipo, sede y búsqueda. Exportar a Excel o PDF. |
| **Inventario** | Stock actual por producto y sede. Alertas de stock bajo. |
| **Reportes** | Gráficos de ventas por período, producto y sede. |
| **Admin** | Gestión de productos, categorías, sedes y usuarios. |

### Filtros disponibles

- **Por sede** — ver solo los movimientos de una sucursal
- **Por tipo** — ventas / ingresos / gastos / traslados
- **Por período** — hoy / 7 días / 30 días
- **Por producto** — búsqueda por nombre

### Exportar datos

En la sección **Movimientos**, usá los botones:
- **Excel** — descarga `.xlsx` con todos los movimientos filtrados
- **PDF** — descarga PDF formateado para imprimir

### Revertir movimientos desde el dashboard

En la tabla de movimientos, cada fila tiene un botón **↩️ Deshacer** que hace lo mismo que el botón de Telegram.

---

## 8. Tipos de movimiento

| Tipo | Cuándo usarlo | Efecto en stock |
|------|--------------|-----------------|
| `venta` | Vendiste un producto a un cliente | Resta stock en tienda origen |
| `ingreso` | Llegó mercadería del proveedor | Suma stock en tienda destino |
| `gasto` | Usaste material interno (no venta) | Resta stock en tienda origen |
| `traslado` | Moviste stock entre sedes | Resta origen, suma destino |

---

## 9. Preguntas frecuentes

**¿Qué pasa si el bot no entiende el producto?**
El bot avisa cuántos productos no pudo registrar. Repetílos en un mensaje separado siendo más claro con el nombre.

**¿Puedo registrar en cualquier sede desde el mismo Telegram?**
Cada operario está vinculado a una sede fija. Si necesitás cambiarla, pedile al administrador que actualice tu sede en el panel.

**¿El stock se actualiza en tiempo real?**
Sí. El dashboard muestra los movimientos en tiempo real via websocket. No hace falta recargar la página.

**¿Puedo tener varios operarios en la misma empresa?**
Sí, sin límite. Cada uno se registra con `/start TOKEN` y elige su sede.

**¿Qué pasa si mando el audio y no llega confirmación?**
El bot siempre responde. Si no ves respuesta en 10 segundos, revisá tu conexión a internet y reenviá el mensaje.

**¿Cómo cambio la contraseña?**
En el dashboard, hacé clic en tu perfil → Cambiar contraseña. O desde el login con "Olvidé mi contraseña".
