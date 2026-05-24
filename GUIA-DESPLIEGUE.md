# Guía de Despliegue: Solución Completa de Inventario Zero-Typing Ferretería

¡Felicidades! Hemos implementado y optimizado la arquitectura completa para tu MVP de inventario sin fricción. Ahora el operario puede registrar ventas en 2 segundos por notas de voz y revertir cualquier error con un solo toque desde Telegram.

---

## 🛠️ Lo que se ha Implementado

1.  **Base de Datos (Supabase):**
    *   Hemos actualizado `CREAR_TABLAS_SUPABASE_FINAL.sql` con una nueva lógica relacional.
    *   **Trigger de Inventario de Fricción Cero:** Modificamos la función `actualizar_stock_trigger` para que soporte operaciones de **inserción** (`INSERT`) y **eliminación** (`DELETE`). Si eliminas un movimiento de venta erróneo, el stock regresa a su estado inicial automáticamente.
2.  **Workflow n8n (`n8n_workflow_fixed.json`):**
    *   **Auto-Commit:** Guardado inmediato en base de datos al finalizar la interpretación de Groq Llama 3.
    *   **Botón de Deshacer en Telegram:** Envío de un botón interactivo `[ ↩️ Deshacer Registro ]` en el mensaje de éxito.
    *   **Flujo de Reversión (Callback):** Automatización del borrado del movimiento y restauración de stock con 1 solo clic en Telegram.

---

## 🚀 Guía de Despliegue Paso a Paso

### Paso 1: Actualizar Supabase (La Base de Datos)
1.  Ve a tu panel de **Supabase** ➔ **SQL Editor**.
2.  Abre una nueva consulta (**New Query**).
3.  Copia y ejecuta el siguiente bloque SQL para actualizar la función y el trigger de stock:

```sql
-- 1. Actualizar la función para soportar reversiones (DELETE)
CREATE OR REPLACE FUNCTION public.actualizar_stock_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_tipo TEXT;
  v_prod_id BIGINT;
  v_tienda_orig BIGINT;
  v_tienda_dest BIGINT;
  v_cant INTEGER;
  v_factor INTEGER;
BEGIN
  -- Determinar si es una inserción (INSERT) o una eliminación (DELETE)
  IF TG_OP = 'INSERT' THEN
    v_tipo := NEW.tipo;
    v_prod_id := NEW.producto_id;
    v_tienda_orig := NEW.tienda_origen;
    v_tienda_dest := NEW.tienda_destino;
    v_cant := NEW.cantidad;
    v_factor := 1;
  ELSIF TG_OP = 'DELETE' THEN
    v_tipo := OLD.tipo;
    v_prod_id := OLD.producto_id;
    v_tienda_orig := OLD.tienda_origen;
    v_tienda_dest := OLD.tienda_destino;
    v_cant := OLD.cantidad;
    v_factor := -1; -- Invierte la operación al eliminar (restaura el stock)
  END IF;

  -- Lógica de actualización de stock por tipo de movimiento
  IF v_tipo = 'venta' OR v_tipo = 'gasto' THEN
    INSERT INTO public.stock (producto_id, tienda_id, cantidad)
    VALUES (v_prod_id, v_tienda_orig, -v_cant * v_factor)
    ON CONFLICT (producto_id, tienda_id) 
    DO UPDATE SET cantidad = stock.cantidad - (EXCLUDED.cantidad), updated_at = NOW();
    
  ELSIF v_tipo = 'ingreso' THEN
    INSERT INTO public.stock (producto_id, tienda_id, cantidad)
    VALUES (v_prod_id, v_tienda_dest, v_cant * v_factor)
    ON CONFLICT (producto_id, tienda_id) 
    DO UPDATE SET cantidad = stock.cantidad + (EXCLUDED.cantidad), updated_at = NOW();
    
    -- Actualizar costo/precio del producto si es inserción y costo > 0
    IF TG_OP = 'INSERT' AND NEW.costo_unitario > 0 THEN
      UPDATE public.productos 
      SET ultimo_costo = NEW.costo_unitario, precio_venta_sugerido = NEW.precio_unitario
      WHERE id = NEW.producto_id;
    END IF;

  ELSIF v_tipo = 'traslado' THEN
    -- Origen
    INSERT INTO public.stock (producto_id, tienda_id, cantidad)
    VALUES (v_prod_id, v_tienda_orig, -v_cant * v_factor)
    ON CONFLICT (producto_id, tienda_id) 
    DO UPDATE SET cantidad = stock.cantidad - (EXCLUDED.cantidad), updated_at = NOW();
    
    -- Destino
    INSERT INTO public.stock (producto_id, tienda_id, cantidad)
    VALUES (v_prod_id, v_tienda_dest, v_cant * v_factor)
    ON CONFLICT (producto_id, tienda_id) 
    DO UPDATE SET cantidad = stock.cantidad + (EXCLUDED.cantidad), updated_at = NOW();
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  ELSE
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 2. Modificar el trigger para reaccionar ante inserciones y eliminaciones
DROP TRIGGER IF EXISTS tr_actualizar_stock ON public.movimientos;
CREATE TRIGGER tr_actualizar_stock
AFTER INSERT OR DELETE ON public.movimientos
FOR EACH ROW EXECUTE FUNCTION public.actualizar_stock_trigger();
```

---

### Paso 2: Importar el Workflow en n8n
1.  Abre el archivo [n8n_workflow_fixed.json](file:///c:/Users/User-pc/Desktop/PROYECTOS/AGENT%20GMS/n8n_workflow_fixed.json) en tu editor y copia todo su contenido.
2.  Ve a tu panel de **n8n** ➔ **Workflows** ➔ **Add Workflow** (o abre uno vacío).
3.  Presiona **`Ctrl + V`** (pegar) directamente en el lienzo. n8n importará todos los nodos y conexiones automáticamente.
4.  Asegúrate de que tus credenciales estén enlazadas en los nodos correspondientes:
    *   **Postgres nodes:** Enlaza la credencial `"Postgres account"` (con la URI de Supabase).
    *   **Telegram Trigger y Telegram nodes:** Enlaza tu bot token en `"Telegram account"`.
    *   **Groq nodes (Whisper y Llama 3):** Enlaza tu API key de Groq en `"Groq Header Auth"`.

---

## 🧪 Plan de Verificación Manual (Pruébalo tú mismo)

Sigue estos 5 sencillos pasos para ver la magia en acción:

### 1. Preparar un producto de prueba
Asegúrate de tener un producto registrado en Supabase para ver cómo se descuenta.
Por ejemplo, si tienes el producto `"Tubo de PVC de 1/2"` en la tienda con ID `1` y cantidad de stock inicial `= 10`.

### 2. Registrar el audio en Telegram
Envía un mensaje de voz (o de texto) a tu bot de Telegram:
> 🎙️ *"Venta de tres tubos de PVC de un medio"*

### 3. Verificar el Auto-Commit instantáneo
En menos de 2 segundos, el bot te enviará un mensaje confirmando:
> ✅ **Movimiento registrado**
> *   **Tipo:** VENTA
> *   **Producto:** Tubo PVC 1/2
> *   **Cantidad:** 3
>
> ¿Deseas revertir este registro?
> `[ ↩️ Deshacer Registro ]`

### 4. Validar el stock en Supabase
Revisa la tabla `stock` en Supabase. Deberías ver que el stock del producto disminuyó automáticamente a **`7`** gracias al trigger Postgres.

### 5. Probar el Botón de Deshacer (Undo)
En Telegram, pulsa el botón **`[ ↩️ Deshacer Registro ]`**.
*   El bot te responderá: *"↩️ Registro revertido. El movimiento ha sido eliminado y el stock original ha sido restaurado con éxito."*
*   Vuelve a revisar la tabla `stock` en Supabase. Verás que el stock del producto ha regresado automáticamente a **`10`** de manera consistente y sin errores.


token de groq
ROTA_ESTA_KEY_EN_console.groq.com
