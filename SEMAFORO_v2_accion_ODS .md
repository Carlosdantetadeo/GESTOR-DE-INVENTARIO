# Semáforo sanitario con acción sugerida, economía circular y ODS

Versión ajustada del prompt original: además del color, la IA ahora sugiere una **acción operativa** y vincula la decisión con **estrategias de economía circular** y **Objetivos de Desarrollo Sostenible (ODS)**, para que el hotel no solo "detecte" el riesgo sino que **cierre el ciclo del producto** (uso, redistribución, valorización o disposición) de forma trazable.

---

## 1. Nuevos campos que devuelve la IA

Además de `categoria_asignada`, `dias_restantes`, `color` y `razon`, el output ahora incluye:

- **`accion_sugerida`**: qué debe hacer el personal con el producto (usar, priorizar consumo, reubicar, donar, valorizar, poner en cuarentena, desechar controladamente, etc.)
- **`estrategia_economia_circular`**: si aplica, qué ruta de circularidad se recomienda antes de descartar (donación, compostaje, subproducto animal, reaprovechamiento en cocina, devolución a proveedor, etc.)
- **`ods_relacionados`**: lista corta de ODS que la acción sugerida ayuda a cumplir, con el número y nombre.

Esto convierte el semáforo de una herramienta puramente de control de calidad en una herramienta de **gestión responsable de inventario** alineada con sostenibilidad.

---

## 2. Lógica de acción según color (nueva capa de decisión)

| Color | Objetivo de la acción | Acción sugerida por defecto |
| --- | --- | --- |
| Verde | Uso normal, rotación eficiente | Usar según orden FIFO/PEPS; no requiere intervención |
| Amarillo | Evitar que se convierta en pérdida | Priorizar su uso inmediato en menús del día, promociones internas, buffet de personal, o reubicar a punto de consumo más rápido |
| Rojo | Evitar riesgo sanitario, minimizar desperdicio si es posible | Retirar del circuito de consumo humano; evaluar cuarentena y, si aplica, ruta de valorización antes de disposición final |

**Importante:** rojo por *riesgo sanitario real* (empaque roto, hallazgo no conforme, vencido y no apto) nunca se reintroduce a consumo humano, pero sí puede evaluarse para rutas de circularidad seguras (ver sección 3) en vez de ir directo a relleno sanitario.

---

## 3. Estrategias de economía circular según categoría y motivo del color

La IA debe cruzar `color`, `categoria_asignada` y el motivo (empaque, fecha, observación) para sugerir la ruta más adecuada:

| Situación | Estrategia de economía circular sugerida | ODS asociados |
| --- | --- | --- |
| Amarillo por proximidad de vencimiento, producto apto para consumo | Redistribución interna (menú del día, comedor de personal) o donación a bancos de alimentos si el hotel tiene convenio | ODS 2 (Hambre cero), ODS 12 (Producción y consumo responsables) |
| Rojo por vencimiento pero sin riesgo microbiológico evidente en no perecederos (ej. empaque intacto, solo pasó fecha de "consumo preferente") | Evaluar si es apto para alimentación animal certificada o compostaje institucional, según normativa aplicable | ODS 12, ODS 13 (Acción por el clima) |
| Rojo por empaque roto/dañado en no perecederos secos | Separar para compostaje o valorización orgánica si el contenido lo permite; empaque a reciclaje según material | ODS 12, ODS 13 |
| Rojo por observación no conforme o riesgo microbiológico (cárnicos, lácteos, preparados) | Disposición controlada; **no** apto para donación ni compostaje abierto; considerar plantas de biodigestión certificadas si el hotel tiene ese convenio | ODS 3 (Salud y bienestar), ODS 12 |
| Verde en general | Mantener buenas prácticas de rotación para minimizar futuras pérdidas | ODS 12 |
| Cualquier caso con desperdicio evitable (mala planificación de compras, no rotación) | Retroalimentar al sistema de compras/inventario para ajustar frecuencia de pedido | ODS 12, ODS 17 (Alianzas para lograr los objetivos) |

Esta capa no reemplaza las reglas sanitarias (la seguridad alimentaria siempre tiene prioridad sobre la circularidad), pero asegura que **ningún descarte se decida "por defecto"** sin antes evaluar una alternativa de menor impacto ambiental.

---

## 3.1 Qué hacer cuando NO hay fecha de vencimiento (frutas, verduras y frescos sin rotulado)

Para productos como frutas y verduras frescas sin procesar, la norma colombiana (INVIMA) exime del requisito de fecha de vencimiento. El semáforo original resolvía esto asignando `verde` automático si `requiere_fecha_según_norma = "no"`, pero eso ignora que estos productos sí se deterioran — solo que no tienen fecha impresa.

**Solución: reemplazar la fecha impresa por una fecha de referencia + una vida útil estimada por subtipo, y reutilizar exactamente los mismos rangos de días que ya existen para cada categoría.** Así no se crean umbrales nuevos, solo una forma alterna de llegar a `días_restantes`.

### Nuevo input necesario

- **`fecha_recepcion_o_compra`**: string `YYYY-MM-DD` o `null`. Fecha en que el producto ingresó a cocina/bodega. Es lo único que el personal necesita registrar (no requiere leer ninguna fecha impresa).

### Cómo se calcula días_restantes cuando no hay fecha de vencimiento

1. Si `fecha_vencimiento` existe → se usa el cálculo normal (sin cambios).
2. Si `fecha_vencimiento = null` y `requiere_fecha_según_norma = "si"` → sigue siendo `rojo` automático (falta de trazabilidad obligatoria, sin cambios).
3. Si `fecha_vencimiento = null` y `requiere_fecha_según_norma = "no"` (caso típico de frutas/verduras):
   - Buscar `subtipo_producto` en la tabla de vida útil estimada (sección siguiente) → obtener `vida_util_estimada_dias`.
   - Si no hay `fecha_recepcion_o_compra` tampoco → asumir `fecha_recepcion_o_compra = fecha_hoy` (producto recién ingresado) solo si el `observacion_visual = "normal"`; si es `"dudoso"` o `"no_conforme"`, esas reglas ya fuerzan amarillo/rojo por sí solas y no requieren estimación.
   - `días_transcurridos = fecha_hoy - fecha_recepcion_o_compra`
   - `días_restantes_estimados = vida_util_estimada_dias - días_transcurridos`
   - Este valor entra al **mismo cálculo de color_base** que ya existe para su categoría (perecedero_intermedio en la mayoría de frutas/verduras), sin crear una regla nueva de color.
4. Marcar `metodo_calculo = "estimado_por_recepcion"` en el output, para que el equipo sepa que es una estimación y no una fecha oficial.

### Tabla de vida útil estimada por subtipo (frutas, verduras y frescos sin fecha)

Rangos orientativos de conservación en condiciones normales de refrigeración/almacenamiento de cocina de hotel. Se pueden ajustar según política interna, igual que los umbrales originales.

| Subtipo | Categoría (ya existente) | Vida útil estimada (días) | Umbral verde reutilizado | Umbral amarillo reutilizado |
| --- | --- | --- | --- | --- |
| hojas_verdes (lechuga, espinaca, rúgula) | perecedero_intermedio | 5–7 | ≥7 días restantes | 1–6 |
| hierbas_frescas (cilantro, perejil, albahaca) | perecedero_intermedio | 4–6 | ≥7 días restantes* | 1–6 |
| tomate | perecedero_intermedio | 7–10 | ≥7 días restantes | 1–6 |
| pepino, pimentón, calabacín | perecedero_intermedio | 7–10 | ≥7 días restantes | 1–6 |
| zanahoria, remolacha (raíces) | perecedero_intermedio | 14–21 | ≥7 días restantes | 1–6 |
| papa, cebolla, ajo | perecedero_intermedio | 21–30 | ≥7 días restantes | 1–6 |
| banano | perecedero_intermedio | 5–7 | ≥7 días restantes | 1–6 |
| cítricos (naranja, limón, mandarina) | perecedero_intermedio | 14–21 | ≥7 días restantes | 1–6 |
| manzana, pera | perecedero_intermedio | 21–30 | ≥7 días restantes | 1–6 |
| mango, papaya, piña (enteros, sin cortar) | perecedero_intermedio | 5–7 | ≥7 días restantes | 1–6 |
| berries (fresa, mora, arándano) | perecedero_intermedio | 3–5 | ≥7 días restantes* | 1–6 |
| aguacate | perecedero_intermedio | 4–7 (según punto de maduración) | ≥7 días restantes* | 1–6 |
| fruta_verdura_cortada_o_pelada | perecedero_critico | 1–3 | ≥5 días restantes* | 1–4 |
| huevos | perecedero_intermedio | 21–28 | ≥7 días restantes | 1–6 |

\* En subtipos donde la vida útil estimada es menor al umbral verde de su categoría (ej. hierbas frescas con 5 días de vida útil en categoría con umbral verde ≥7), el producto **nunca llegará a verde por fecha** — esto es correcto y esperado: significa que ese subtipo depende más de la `observacion_visual` que de los días transcurridos, y el sistema debe dar más peso al chequeo visual diario para esos casos.

**Nota clave:** esta tabla no reemplaza el criterio del personal de cocina. Si `observacion_visual = "dudoso"` o `"no_conforme"`, esa regla siempre prevalece sobre la estimación por días (ver reglas de ajuste final, sección 4).

---

## 4. Prompt completo ajustado (listo para producción)

```
Eres un motor de decisión de semáforo sanitario para alimentos y bebidas en hotelería, 
con enfoque adicional en economía circular y Objetivos de Desarrollo Sostenible (ODS).

Recibes los siguientes datos en JSON:
- subtipo_producto: texto (ej. "carne", "lacteo", "fruta_verdura", "harina", "arroz_pasta", 
  "conserva", "agua", "bebida_estable", "bebida_refrigerada", "hielo")
- fecha_vencimiento: string o null (YYYY-MM-DD)
- fecha_hoy: string (YYYY-MM-DD)
- requiere_fecha_según_norma: "si" | "no"
- estado_empaque: "intacto" | "dano_leve" | "roto_abierto_fuga"
- observacion_visual: "normal" | "dudoso" | "no_conforme"
- fecha_recepcion_o_compra: string o null (YYYY-MM-DD) — fecha en que el producto ingresó 
  a cocina/bodega. Solo relevante cuando fecha_vencimiento = null y 
  requiere_fecha_según_norma = "no" (típico de frutas y verduras frescas sin rotulado).

Tu tarea:

1. Clasificar el subtipo_producto en una de estas categorías internas:
   - "perecedero_critico"
   - "perecedero_intermedio"
   - "no_perecedero"

   Reglas de clasificación por subtipo:
   - "perecedero_critico": carnes, pollo, pescado, mariscos, lacteos_frescos, 
     comidas_preparadas, hielo_a_granel_o_riesgoso
   - "perecedero_intermedio": frutas_verduras, huevos, panaderia_vida_corta, 
     jugos_refrigerados, bebidas_refrigeradas
   - "no_perecedero": harinas, arroz_pasta, legumbres, azucar_sal, cafe_te, aceite, 
     conservas, galletas_cereales, leche_en_polvo, agua, bebida_estable, hielo_empaquetado

2. Calcular días_restantes:
   a) Si fecha_vencimiento existe → días_restantes = fecha_vencimiento - fecha_hoy; 
      metodo_calculo = "fecha_documentada".
   b) Si fecha_vencimiento = null y requiere_fecha_según_norma = "no" (ej. frutas/verduras 
      sin rotulado): buscar vida_util_estimada_dias en la tabla de referencia por subtipo 
      (usar el punto medio del rango si no se especifica otro criterio). Si 
      fecha_recepcion_o_compra existe: días_transcurridos = fecha_hoy - fecha_recepcion_o_compra, 
      días_restantes = vida_util_estimada_dias - días_transcurridos. Si 
      fecha_recepcion_o_compra = null, asumir días_transcurridos = 0 (producto recién 
      ingresado) solo si observacion_visual = "normal". metodo_calculo = "estimado_por_recepcion".
   c) Si fecha_vencimiento = null y requiere_fecha_según_norma = "si" → días_restantes = null; 
      metodo_calculo = "no_aplica" (se resuelve directo a rojo en el paso 3.c).

3. Aplicar reglas de semáforo en este orden:
   a) Si estado_empaque = "roto_abierto_fuga" → color = "rojo".
   b) Si observacion_visual = "no_conforme" → color = "rojo".
   c) Si requiere_fecha_según_norma = "si" y fecha_vencimiento = null → color = "rojo".
   d) Si días_restantes (documentado o estimado) ≤ 0 → color = "rojo".
   e) Calcular color_base según categoría y días_restantes (documentado o estimado, 
      se usa el mismo umbral sin distinción):
      - "perecedero_critico": días_restantes ≥ 5 → verde; 1-4 → amarillo
      - "perecedero_intermedio": días_restantes ≥ 7 → verde; 1-6 → amarillo
      - "no_perecedero": días_restantes ≥ 30 → verde; 1-29 → amarillo
      - Si no hay fecha_vencimiento y requiere_fecha_según_norma = "no" → color_base = "verde"
   f) Ajustes finales:
      - Si estado_empaque = "dano_leve" y color_base = "verde" → color = "amarillo"
      - Si observacion_visual = "dudoso" y color_base = "verde" → color = "amarillo"
      - En cualquier otro caso, color = color_base

4. Determinar accion_sugerida según el color final y el motivo que lo originó:
   - Verde → "usar_segun_rotacion_fifo"
   - Amarillo → "priorizar_uso_inmediato" (menú del día, buffet de personal, promoción interna)
   - Rojo por riesgo sanitario real (empaque comprometido u observación no conforme) 
     → "retirar_consumo_humano_disposicion_controlada"
   - Rojo solo por vencimiento en no_perecederos sin riesgo microbiológico evidente 
     → "retirar_consumo_humano_evaluar_valorizacion"

5. Determinar estrategia_economia_circular (null si no aplica) según la tabla:
   - Amarillo, producto apto → "redistribucion_interna_o_donacion"
   - Rojo por vencimiento en no_perecederos sin riesgo → "evaluar_compostaje_o_alimentacion_animal_certificada"
   - Rojo por empaque dañado en secos, contenido no comprometido → "separar_compostaje_o_reciclaje_empaque"
   - Rojo por riesgo microbiológico real → "disposicion_controlada_sin_valorizacion" (o 
     "biodigestion_certificada" si el hotel tiene convenio)
   - Verde → null (mantener rotación)

6. Asociar ods_relacionados (lista de strings, formato "ODS N: Nombre"), usando como 
   referencia:
   - "ODS 2: Hambre cero"
   - "ODS 3: Salud y bienestar"
   - "ODS 12: Producción y consumo responsables"
   - "ODS 13: Acción por el clima"
   - "ODS 17: Alianzas para lograr los objetivos"

7. Devolver únicamente un JSON con esta estructura:
{
  "categoria_asignada": "perecedero_critico | perecedero_intermedio | no_perecedero",
  "dias_restantes": número o null,
  "metodo_calculo": "fecha_documentada | estimado_por_recepcion | no_aplica",
  "color": "verde | amarillo | rojo",
  "razon": "texto muy corto (máx. 150 caracteres)",
  "accion_sugerida": "texto corto en snake_case",
  "estrategia_economia_circular": "texto corto en snake_case o null",
  "ods_relacionados": ["ODS N: Nombre", "..."]
}
```

---

## 5. Ejemplos actualizados

### Ejemplo 1: bebida refrigerada próxima a vencer (amarillo)

**Entrada**
```json
{
  "subtipo_producto": "bebida_refrigerada",
  "fecha_vencimiento": "2026-08-10",
  "fecha_hoy": "2026-08-07",
  "requiere_fecha_según_norma": "si",
  "estado_empaque": "intacto",
  "observacion_visual": "normal"
}
```

**Salida esperada**
```json
{
  "categoria_asignada": "perecedero_intermedio",
  "dias_restantes": 3,
  "color": "amarillo",
  "razon": "Bebida refrigerada perecedera, vence en 3 días, empaque íntegro, sin hallazgos.",
  "accion_sugerida": "priorizar_uso_inmediato",
  "estrategia_economia_circular": "redistribucion_interna_o_donacion",
  "ods_relacionados": ["ODS 2: Hambre cero", "ODS 12: Producción y consumo responsables"]
}
```

### Ejemplo 2: hielo con empaque roto (rojo por riesgo real)

**Entrada**
```json
{
  "subtipo_producto": "hielo_empaquetado",
  "fecha_vencimiento": "2027-01-01",
  "fecha_hoy": "2026-08-07",
  "requiere_fecha_según_norma": "si",
  "estado_empaque": "roto_abierto_fuga",
  "observacion_visual": "normal"
}
```

**Salida esperada**
```json
{
  "categoria_asignada": "no_perecedero",
  "dias_restantes": 147,
  "color": "rojo",
  "razon": "Hielo empaquetado con empaque comprometido, riesgo de contaminación.",
  "accion_sugerida": "retirar_consumo_humano_disposicion_controlada",
  "estrategia_economia_circular": "separar_compostaje_o_reciclaje_empaque",
  "ods_relacionados": ["ODS 3: Salud y bienestar", "ODS 12: Producción y consumo responsables"]
}
```

### Ejemplo 3 (nuevo): conserva vencida, empaque intacto, sin hallazgos visuales

**Entrada**
```json
{
  "subtipo_producto": "conserva",
  "fecha_vencimiento": "2026-07-20",
  "fecha_hoy": "2026-08-07",
  "requiere_fecha_según_norma": "si",
  "estado_empaque": "intacto",
  "observacion_visual": "normal"
}
```

**Salida esperada**
```json
{
  "categoria_asignada": "no_perecedero",
  "dias_restantes": -18,
  "color": "rojo",
  "razon": "Conserva vencida hace 18 días; empaque íntegro, sin hallazgos visuales.",
  "accion_sugerida": "retirar_consumo_humano_evaluar_valorizacion",
  "estrategia_economia_circular": "evaluar_compostaje_o_alimentacion_animal_certificada",
  "ods_relacionados": ["ODS 12: Producción y consumo responsables", "ODS 13: Acción por el clima"]
}
```

### Ejemplo 4 (nuevo): lechuga sin fecha de vencimiento, estimada por recepción

**Entrada**
```json
{
  "subtipo_producto": "hojas_verdes",
  "fecha_vencimiento": null,
  "fecha_hoy": "2026-08-07",
  "requiere_fecha_según_norma": "no",
  "estado_empaque": "intacto",
  "observacion_visual": "normal",
  "fecha_recepcion_o_compra": "2026-08-04"
}
```

**Cálculo**: vida_util_estimada_dias (hojas_verdes) = 6 (punto medio de 5–7). días_transcurridos = 3. días_restantes_estimados = 3. Categoría perecedero_intermedio: 1–6 días restantes → amarillo.

**Salida esperada**
```json
{
  "categoria_asignada": "perecedero_intermedio",
  "dias_restantes": 3,
  "metodo_calculo": "estimado_por_recepcion",
  "color": "amarillo",
  "razon": "Hojas verdes sin fecha oficial; estimado 3 días de vida útil restante desde recepción.",
  "accion_sugerida": "priorizar_uso_inmediato",
  "estrategia_economia_circular": "redistribucion_interna_o_donacion",
  "ods_relacionados": ["ODS 2: Hambre cero", "ODS 12: Producción y consumo responsables"]
}
```

*Nota sobre el Ejemplo 3: ilustra el matiz clave de la v2 — rojo por sola caducidad de un enlatado con empaque íntegro y sin señales de deterioro no se trata igual que rojo por riesgo microbiológico. El primero abre puerta a valorización; el segundo va directo a disposición controlada.*

*Nota sobre el Ejemplo 4: muestra cómo un producto sin fecha oficial (frutas/verduras) entra al mismo semáforo que los demás, sin crear una categoría nueva ni umbrales nuevos — solo cambia el origen del dato `días_restantes`.*

---

## 6. Nota de implementación

- La seguridad alimentaria **siempre** tiene prioridad: ninguna estrategia de economía circular puede anular una decisión de rojo por riesgo sanitario real (empaque comprometido, observación no conforme).
- La distinción entre "rojo por riesgo" y "rojo por sola fecha en producto íntegro" es la que le da valor añadido a este prompt: sin ella, todo rojo terminaría en basura sin diferenciar el potencial de valorización.
- Si el hotel no tiene convenios de donación, compostaje o biodigestión, el campo `estrategia_economia_circular` puede devolverse igual (como recomendación) y el equipo de sostenibilidad decide si lo activa o no — no depende de que exista la infraestructura para que la IA lo sugiera.
- Para productos sin fecha oficial (frutas, verduras, hierbas frescas), `dias_restantes` es una **estimación**, no un dato oficial. El campo `metodo_calculo = "estimado_por_recepcion"` debe mostrarse siempre en la interfaz del personal para que sepan que ese número no es tan firme como una fecha impresa.
- La tabla de vida útil por subtipo es un punto de partida editable: cada hotel puede recalibrarla según su rotación real de proveedores, altitud/clima de la ciudad y tipo de almacenamiento (refrigerado vs. temperatura ambiente).
- Para subtipos cuya vida útil estimada es menor al umbral verde de su categoría (hierbas frescas, berries, aguacate, fruta cortada), el sistema nunca mostrará verde por días — es intencional, y refuerza que el chequeo visual diario (`observacion_visual`) es el control primario para esos productos, no la fecha.
