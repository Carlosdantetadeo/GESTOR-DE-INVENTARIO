# Contrato — Motor de Semáforo (on-device, determinista)

Función pura en `frontend/lib/auditoria/semaforo.js`. Sin I/O, sin red. 100% offline (FR-002).

## Firma

```
evaluarSemaforo(pieza, conteo, config) → Resultado
```

### Entrada

`pieza` (del catálogo local sincronizado):
| Campo | Tipo | Notas |
|-------|------|-------|
| `stock_minimo` | number | umbral rojo |
| `punto_reorden` | number | umbral amarillo (reposición) |
| `stock_maximo` | number \| null | umbral amarillo (sobrestock); null = sin control |
| `ultima_salida_at` | ISO string \| null | para rotación |

`conteo`:
| Campo | Tipo | Valores |
|-------|------|---------|
| `cantidad` | number | ≥ 0 |
| `estado_fisico` | enum | `integra` \| `deterioro_menor` \| `danada_oxidada` (ASCII; UI muestra "dañada/oxidada") |

`config` (por sector, `autopartes`):
| Campo | Tipo | Default |
|-------|------|---------|
| `meses_stock_muerto` | number | 6 |
| `ahora` | Date | now (inyectable para tests) |

### Salida `Resultado`

```
{
  color: 'verde' | 'amarillo' | 'rojo',
  razon: string,          // legible, ej. "quiebre de stock (bajo mínimo)"
  accion: string,         // ej. "reponer con urgencia / generar pedido"
  estrategia: string|null // recuperación de valor, informativa
}
```

## Reglas (el color final es el PEOR de las dos dimensiones)

**Dimensión estado físico**: `integra`→verde · `deterioro_menor`→amarillo · `danada_oxidada`→rojo.

**Dimensión inventario** (se omite si `stock_minimo`, `punto_reorden` y `stock_maximo` son todos 0/indefinidos). Se evalúan en este orden y gana el primero que aplica:
- `cantidad < stock_minimo` → **rojo** — "quiebre de stock (bajo mínimo)".
- `stock_minimo ≤ cantidad < punto_reorden` → **amarillo** — "stock bajo el punto de reorden".
- `ultima_salida_at` más antigua que `meses_stock_muerto` → **amarillo** — "baja rotación / stock muerto".
- `stock_maximo` definido y `cantidad > stock_maximo` → **amarillo** — "sobrestock (capital inmovilizado)".
- resto → **verde**.

Orden de severidad: rojo > amarillo > verde. `color = max(fisico, inventario)`.

## Casos de prueba obligatorios (unit)

| # | Entrada | Color esperado | Razón |
|---|---------|----------------|-------|
| 1 | íntegra, cantidad=2, min=5 | rojo | quiebre de stock |
| 2 | danada_oxidada, cantidad=100, min=5 | rojo | daño físico (gana sobre stock sano) |
| 3 | íntegra, cantidad=8, min=5, reorden=10 | amarillo | bajo punto de reorden |
| 4 | íntegra, cantidad=50, min=5, reorden=10, ultima_salida hace 8 meses | amarillo | stock muerto |
| 5 | íntegra, cantidad=50, min=5, reorden=10, ultima_salida hace 1 mes | verde | — |
| 6 | deterioro_menor, cantidad=50 sano | amarillo | deterioro menor |
| 7 | íntegra, sin umbrales, cantidad=0 | verde | inventario omitido (solo físico) |
| 8 | íntegra, cantidad=200, max=100 | amarillo | sobrestock (capital inmovilizado) |

Verificación de SC-011: caso 1 detecta el quiebre sin red, < 2s.
