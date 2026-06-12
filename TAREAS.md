# Tareas Completadas: Implementación de Inventario Zero-Typing Ferretería

> 📜 **Documento histórico (mayo 2026).** Lista las tareas del MVP original
> basado en **n8n**, que ya no existe en el proyecto (el archivo
> `n8n_workflow_fixed.json` fue eliminado al migrar a Supabase Edge Functions).
> Para el estado actual ver `MANUAL.md` sección 10.

Organización del trabajo paso a paso para el MVP de inventario optimizado.

---

## 📋 Lista de Tareas

- [x] **Fase 1: Corrección e Integridad de Base de Datos**
  - [x] Modificar `CREAR_TABLAS_SUPABASE_FINAL.sql` para añadir soporte de `DELETE` en la función `actualizar_stock_trigger` y en el trigger `tr_actualizar_stock`.
  - [x] Validar sintaxis del script SQL.
  - [x] Preparar instrucciones claras para ejecutar el script corregido en el editor SQL de Supabase.

- [x] **Fase 2: Reestructuración del Workflow de n8n**
  - [x] Modificar `n8n_workflow_fixed.json` para implementar la lógica de **Auto-Commit** (guardar directo tras el mapeo semántico).
  - [x] Configurar el nodo de Telegram para enviar mensaje interactivo con el botón inline `[ ↩️ Deshacer ]` (callback `deshacer_[movimiento_id]`).
  - [x] Añadir e implementar el disparador de Telegram Callback en el workflow para capturar el clic en "Deshacer".
  - [x] Añadir un nodo Postgres para borrar el movimiento de la base de datos tras pulsar "Deshacer".
  - [x] Configurar nodo de Telegram de respuesta para confirmar la reversión exitosa.

- [x] **Fase 3: Pruebas y Validación**
  - [x] Realizar una simulación de venta y verificar que el stock en la tabla `stock` disminuya automáticamente.
  - [x] Realizar una simulación de "Deshacer" y verificar que el registro en la tabla `movimientos` se elimine y el stock vuelva a su valor original.
  - [x] Escribir el documento final `walkthrough.md` (ahora `GUIA-DESPLIEGUE.md`) resumiendo las mejoras y cómo importarlo en tu n8n y Supabase.
