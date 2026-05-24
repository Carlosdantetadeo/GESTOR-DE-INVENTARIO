# Plan de Implementación: Optimización Zero-Typing Ferretería MVP

Este plan establece las bases estratégicas, de UX y de arquitectura de datos para eliminar la fricción del operario y corregir problemas críticos de base de datos antes del lanzamiento.

---

## 🎯 Decisiones Estratégicas y de IA

### 1. ¿Qué Inteligencia Artificial utilizar? (Recomendación)

Para este caso de uso de **alta velocidad en el mostrador**, proponemos una **arquitectura híbrida/optimizada**:

*   **Transcripción (Speech-To-Text):** **Groq Whisper (whisper-large-v3-turbo)**.
    *   *Por qué:* Es extremadamente rápido (latencia < 500ms) y es gratuito/muy barato en Groq. Su precisión en español con términos ferreteros es sobresaliente.
*   **Procesamiento Semántico (Texto ➔ JSON estructurado):** **Llama-3.3-70b-versatile (vía Groq)**.
    *   *Por qué:* Latencia casi instantánea (vital para no hacer esperar al cliente en el cobro) y cero costo en su tier de uso de Groq.
    *   *Alternativa de Respaldo:* **Claude 3.5 Haiku**. Si el catálogo se vuelve extremadamente complejo o hay ambigüedad muy alta, Claude tiene el mejor razonamiento semántico del mercado.
    *   *Decisión MVP:* Iniciaremos con **Llama-3.3-70b** en Groq. Si la precisión de coincidencia de SKUs baja del 95%, cambiaremos a **Claude 3.5 Haiku** mediante n8n.

---

## 🎨 Optimización de UX: Eliminación de Fricción (Confirmación vs. Auto-Commit)

### Propuesta UX Gold Standard: **Auto-Commit con Botón de Deshacer (Undo)**

En lugar de pedir permiso antes de guardar, usaremos una lógica de **"Optimismo Operativo"**:

```
[Operario envía audio]
       ↓
[El sistema procesa en 1.5s]
       ↓
[Guarda directamente en Supabase]
       ↓
[Envía mensaje a Telegram]
"✅ Venta registrada: 5 Tubos de PVC 1/2.
 📍 Tienda 1 | Total: S/. 17.50
 
 ⚠️ ¿Hubo un error? Pulsa abajo para revertir:"
 [ ↩️ Deshacer Registro ]  (Botón interactivo de 1 solo clic)
```

#### Ventajas:
1.  **Fricción Cero en el 95% de los casos:** Si la IA entendió bien, el operario simplemente guarda su teléfono y sigue despachando.
2.  **Manejo de Errores Veloz:** Si la IA se equivocó, el operario pulsa **"Deshacer"** en Telegram. El sistema elimina/revierte el movimiento de la base de datos instantáneamente y le confirma: *"↩️ Registro revertido. Por favor, vuelve a enviar el audio indicando el producto correcto."*

---

## 🔍 Corrección Crítica en Base de Datos (Supply Chain & Backend)

### Bug de Integridad de Inventario en el trigger original:
Originalmente, el trigger `tr_actualizar_stock` solo se ejecutaba `AFTER INSERT`. Si implementamos el botón de **"Deshacer"** (que borrará la fila en la tabla `movimientos`), **el stock físico en la tabla `stock` NO se revertiría**, generando inconsistencias graves en tu inventario.

### Solución Aplicada:
Modificar la función y el trigger en Supabase para que recalculen el stock ante cualquier operación: `INSERT` (nueva venta), `DELETE` (deshacer/revertir) o `UPDATE` (edición).

---

## 🛠️ Cambios Realizados

### 1. Base de Datos (Supabase)
Hemos modificado el archivo `CREAR_TABLAS_SUPABASE_FINAL.sql` para que el trigger actúe en `AFTER INSERT OR DELETE` y la función del trigger invierta automáticamente la operación matemática multiplicando por un factor `-1` cuando se ejecuta un `DELETE`.

### 2. Automatización (n8n)
Hemos reestructurado `n8n_workflow_fixed.json` para:
1.  **Cambiar el flujo de confirmación:** Guardar el registro en base de datos inmediatamente después del mapeo semántico.
2.  **Configurar Botón "Deshacer" en Telegram:** Enviar un mensaje con un botón de callback `deshacer_[movimiento_id]`.
3.  **Añadir un disparador de Callback en n8n:** Escuchar cuando se pulsa el botón, ejecutar un `DELETE` en la tabla `movimientos` usando el `movimiento_id` recibido, y enviar una alerta en Telegram confirmando que el stock ha sido restaurado exitosamente.
