# Manual de Usuario — Almacenero Digital

Sistema de inventario para comercios (ferreterías, abarrotes, autopartes y más).
El registro de ventas e inventario se hace desde la **app web/móvil** por texto, **voz** o **foto**.
El **bot de Telegram** se usa solo para recibir el **reporte del día**.

**App / dashboard:** https://dashboard.almacenero.digital

---

## Acceso rápido

| | |
|---|---|
| **App** | https://dashboard.almacenero.digital |
| **Ingresar** | https://dashboard.almacenero.digital/login — con tu **email** y **contraseña** |
| **Empresa nueva** | https://dashboard.almacenero.digital/registro — genera tu usuario y una contraseña temporal `AD-XXXXXXXX` |
| **Olvidé mi contraseña** | En `/login` → **"¿Olvidaste tu contraseña?"** → te llega un email con el link |
| **No tengo usuario** | Te lo crea el **administrador** de tu empresa (Administración → Usuarios) |

> Tu **usuario es tu email**. La contraseña la definís vos (o te la entrega el administrador). Nadie puede ver tu contraseña: si la perdés, se recupera con el link de `/login`.

---

## 1. Registro de la empresa (administrador)

### Paso 1 — Crear tu empresa

1. Entrá a **https://dashboard.almacenero.digital/registro**
2. Completá el formulario:
   - **Nombre de la empresa** — ej: `Ferretería Los Andes`
   - **Rubro del negocio** — ej: `ferretería`, `abarrotes`, `autopartes`
   - **Email del administrador** — tu email (será tu usuario)
   - **Sedes / sucursales** — agregá las que tengas (mínimo 1, máximo 20)
3. Hacé clic en **Crear empresa**

### Paso 2 — Guardá tus credenciales

Al registrarte exitosamente verás en pantalla tu **contraseña temporal**:

```
Tu contraseña temporal: AD-XXXXXXXX
```

> ⚠️ Guardala ahora: no se vuelve a mostrar.
> También llega un email con las credenciales y los **tokens de Telegram** de tu empresa.

### Paso 3 — Ingresá a la app

1. Andá a **https://dashboard.almacenero.digital/login**
2. Ingresá con tu email y la contraseña temporal
3. Cambiá la contraseña la primera vez desde **"¿Olvidaste tu contraseña?"**: te llega un email con un link para crear una nueva

Al ingresar, la app te lleva a la pantalla principal de **Almacenero Digital**, con los accesos según tu rol.

---

## 2. Accesos y roles

Hay dos formas de entrar al sistema y cuatro tipos de acceso:

| Acceso | Para qué | Cómo se obtiene |
|---|---|---|
| **Administrador** (app web) | Configurar todo, ver reportes, crear usuarios | Se crea al registrar la empresa. Usuario = email, clave = `AD-XXXXXXXX` |
| **Supervisor** (app web) | Ingresos, conteos, recepción y panel de una sede | El administrador lo crea en **Administración → Usuarios** |
| **Vendedor** (app web) | Registrar ventas de su sede | El administrador lo crea en **Administración → Usuarios** |
| **Reporte por Telegram** (admin) | Recibir el reporte del día en el celular | El admin vincula su Telegram con el **token admin** (ver sección 6) |

### Qué puede hacer cada rol en la app

| Función | Vendedor | Supervisor | Administrador |
|---|:--:|:--:|:--:|
| Registrar **ventas** | ✅ | ✅ | ✅ |
| **Ingreso** de mercadería | | ✅ | ✅ |
| **Contar** (auditar stock por voz) | | ✅ | ✅ |
| **Recepción** (leer factura por foto) | | ✅ | ✅ |
| **Panel** de sesiones y alertas | | ✅ | ✅ |
| **Reportes** | | | ✅ |
| **Administración** (catálogo, sedes, usuarios) | | | ✅ |

---

## 3. La app web/móvil

Es una **PWA**: podés usarla desde el navegador del celular o instalarla como app. En la barra superior se muestra el estado de conexión (**En línea** / **Sin conexión**) y un contador de registros **pendientes** de sincronizar cuando trabajás sin señal.

> La **voz** y la **foto** necesitan conexión (se procesan con IA en el servidor).
> Si estás sin conexión, buscá el producto por nombre; algunos registros quedan
> en cola y se sincronizan solos al volver la señal.

### 3.1 Venta

Para el **vendedor** (y también supervisor/admin). Registra una salida de stock.

1. Encontrá el producto de tres formas:
   - **Escribiendo** el nombre en el buscador
   - **🎤 Voz** — decí la venta, ej: *"3 caños de 2 pulgadas a 5 soles"*. El sistema interpreta producto, cantidad y precio, y prellena la tarjeta.
   - **📷 Foto** — sacale una foto a la boleta/factura y toma el primer ítem.
2. Confirmá o corregí **cantidad** y **precio unitario** (el total se calcula solo).
3. Tocá **💰 Registrar venta**.

> Si la cantidad supera el stock disponible, el sistema avisa y no deja registrar.
> Después de registrar podés **↩️ Deshacer** la última venta dentro de los **5 minutos**.

### 3.2 Ingreso

Para **supervisor/admin**. Carga mercadería que llega del proveedor y suma stock a la sede.

### 3.3 Contar

Para **supervisor/admin**. Auditoría de stock: vas contando productos por **voz** y el sistema arma la sesión de conteo para detectar diferencias con el stock del sistema.

### 3.4 Recepción

Para **supervisor/admin**. Sacás una **foto de la factura/remito** del proveedor y el sistema lee los ítems para acelerar la carga.

### 3.5 Panel

Para **supervisor/admin**. Muestra las **sesiones** de conteo y las **alertas** (por ejemplo, stock por debajo del mínimo).

### 3.6 Reportes

Solo **administrador**. Ventas **en el tiempo**, **por sede** y **por vendedor**, con gráficos. Incluye tanto las ventas de la app como las históricas.

### 3.7 Administración

Solo **administrador**. Desde acá configurás toda la empresa:

- **Cargar catálogo (Excel/CSV)** — subí tu lista de productos. Podés bajar una **plantilla** con las columnas correctas (`nombre`, `unidad_medida`, `referencia`, `stock_minimo`, `punto_reorden`, `stock_maximo`).
- **Generar embeddings** — activa la búsqueda inteligente por voz/foto. Corrélo después de importar productos nuevos.
- **Sedes** — agregar, renombrar y activar/desactivar sucursales (desactivar no borra el historial).
- **Ubicaciones / Secciones** — pasillos, estantes o zonas dentro de cada sede.
- **Usuarios** — crear vendedores y supervisores (ver sección 4).
- **Configuración** — meses para considerar "stock muerto".
- **Bot de Telegram (reportes)** — el token de administrador para recibir el reporte del día.

---

## 4. Crear usuarios (vendedores y supervisores)

El registro crea **solo al administrador**. Los demás usuarios los crea el admin desde la app:

1. Ingresá como administrador y entrá a **Administración**.
2. En el panel **Usuarios**, completá:
   - **Nombre del vendedor** (para identificarlo en los reportes)
   - **Email** y **Contraseña** (con estos ingresa a la app)
   - **Rol**: Vendedor, Supervisor o Admin
   - **Sede** (opcional): la sucursal donde trabaja
3. Tocá **Crear usuario**.

Entregale a cada persona su email y contraseña. Ingresan en **https://dashboard.almacenero.digital/login** y ven solo lo que su rol permite.

> Poné siempre un **nombre** a cada vendedor: así los reportes muestran quién vendió qué.

---

## 5. Tipos de movimiento

| Tipo | Cuándo se usa | Efecto en stock |
|------|--------------|-----------------|
| **Venta** | Vendiste un producto a un cliente | Resta stock en la sede |
| **Ingreso** | Llegó mercadería del proveedor | Suma stock en la sede |
| **Gasto** | Usaste material interno (no venta) | Resta stock en la sede |
| **Traslado** | Moviste stock entre sedes | Resta en origen, suma en destino |
| **Ajuste** | Corrección tras un conteo | Ajusta el stock al valor real |

---

## 6. Bot de Telegram — reporte del día

> **Importante:** el bot **ya no registra ventas ni inventario**. Todo el registro se
> hace desde la app web. El bot solo entrega el **reporte del día** al administrador.

### Vincular tu Telegram (una sola vez)

1. En la app, entrá a **Administración → Bot de Telegram (reportes)** y **copiá el token de administrador**.
2. En Telegram, buscá el bot y enviá:

   ```
   /start TOKEN_DE_ADMIN
   ```

   > 🔒 No compartas este token: quien lo tenga puede ver los reportes de tu empresa.

### Pedir el reporte

Una vez vinculado, escribí al bot:

```
/reporte
```

Recibís el total del día, el desglose **por sede** y **por vendedor**, con un link para ver el detalle completo en el dashboard.

> Si enviás voz, foto o cualquier otro mensaje, el bot responde recordándote que
> el registro se hace desde la app web y que use `/reporte`.

---

## 7. Preguntas frecuentes

**¿Dónde registro las ventas ahora?**
Desde la app web/móvil, en **Venta**. El bot de Telegram ya no registra: solo da el reporte del día.

**¿Necesito cargar el catálogo antes de vender?**
Cargarlo (Administración → Cargar catálogo) mejora la búsqueda por voz y foto. Podés importar tu lista en Excel/CSV con la plantilla incluida.

**¿La voz o la foto no funcionan?**
Ambas necesitan conexión a internet. Sin señal, buscá el producto por nombre. Si el problema persiste, avisá al administrador (puede faltar configurar la IA).

**¿Puedo deshacer una venta?**
Sí, con **↩️ Deshacer** dentro de los 5 minutos de registrarla.

**¿Cómo cambio mi contraseña?**
Desde el login, con **"¿Olvidaste tu contraseña?"**: te llega un email con el link.

**¿Cuántos vendedores puedo tener?**
Sin límite. El administrador los crea desde Administración → Usuarios.

**¿Quién puede ver los reportes?**
Solo el administrador, tanto en la app (sección Reportes) como por Telegram (`/reporte`).

**¿Puede un vendedor ver el inventario o los reportes?**
No. El vendedor solo registra ventas de su sede. El resto lo ven supervisor y admin.
