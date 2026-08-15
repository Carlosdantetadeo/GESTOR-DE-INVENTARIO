// Motor de semáforo de AuditorIA (sector autopartes). Función pura, determinista,
// sin I/O ni red — corre en el dispositivo, offline (FR-002).
// Ver contrato: specs/002-auditoria-autopartes/contracts/semaforo.md
//
// El color final es el PEOR de dos dimensiones:
//  A) estado físico (lo marca el auditor)
//  B) salud de inventario (stock vs mínimo/reorden/máximo + rotación)

export const SEVERIDAD = { verde: 0, amarillo: 1, rojo: 2 }

const MS_POR_MES = 1000 * 60 * 60 * 24 * 30.4375

function evaluarFisico(estadoFisico) {
  switch (estadoFisico) {
    case 'danada_oxidada':
      return {
        color: 'rojo',
        razon: 'daño físico / oxidación',
        accion: 'separar del stock vendible',
        estrategia: 'reacondicionar o devolver a proveedor',
      }
    case 'deterioro_menor':
      return {
        color: 'amarillo',
        razon: 'deterioro menor recuperable',
        accion: 'revisar y priorizar uso',
        estrategia: 'reacondicionar',
      }
    default: // 'integra'
      return { color: 'verde', razon: null, accion: null, estrategia: null }
  }
}

function evaluarInventario(pieza, conteo, cfg) {
  const stockMinimo = pieza.stock_minimo ?? 0
  const puntoReorden = pieza.punto_reorden ?? 0
  const stockMaximo = pieza.stock_maximo ?? null
  const ultimaSalida = pieza.ultima_salida_at ?? null
  const cantidad = conteo.cantidad

  const aplica = stockMinimo > 0 || puntoReorden > 0 || stockMaximo != null
  if (!aplica) return { color: 'verde', razon: null, accion: null, estrategia: null }

  if (stockMinimo > 0 && cantidad < stockMinimo) {
    return {
      color: 'rojo',
      razon: 'quiebre de stock (bajo mínimo)',
      accion: 'reponer con urgencia / generar pedido a proveedor',
      estrategia: null,
    }
  }
  if (puntoReorden > 0 && cantidad < puntoReorden) {
    return {
      color: 'amarillo',
      razon: 'stock bajo el punto de reorden',
      accion: 'reponer',
      estrategia: null,
    }
  }
  if (ultimaSalida) {
    const meses = (cfg.ahora.getTime() - new Date(ultimaSalida).getTime()) / MS_POR_MES
    if (meses >= cfg.meses_stock_muerto) {
      return {
        color: 'amarillo',
        razon: 'baja rotación / stock muerto',
        accion: 'liquidar o promocionar',
        estrategia: 'remate o descuento',
      }
    }
  }
  if (stockMaximo != null && cantidad > stockMaximo) {
    return {
      color: 'amarillo',
      razon: 'sobrestock (capital inmovilizado)',
      accion: 'frenar compras / promocionar',
      estrategia: 'remate o descuento',
    }
  }
  return { color: 'verde', razon: null, accion: null, estrategia: null }
}

// evaluarSemaforo(pieza, conteo, config?) → { color, razon, accion, estrategia }
export function evaluarSemaforo(pieza, conteo, config = {}) {
  const cfg = {
    meses_stock_muerto: config.meses_stock_muerto ?? 6,
    ahora: config.ahora ?? new Date(),
  }

  const fisico = evaluarFisico(conteo.estado_fisico)
  const inventario = evaluarInventario(pieza, conteo, cfg)

  const fSev = SEVERIDAD[fisico.color]
  const iSev = SEVERIDAD[inventario.color]
  const color = fSev >= iSev ? fisico.color : inventario.color

  if (color === 'verde') {
    return { color: 'verde', razon: 'stock sano y pieza íntegra', accion: 'sin acción', estrategia: null }
  }

  // Empate de severidad: si es rojo, gana el daño físico (seguridad); si es
  // amarillo, gana la dimensión de inventario (más accionable operativamente).
  let elegido
  if (fSev > iSev) elegido = fisico
  else if (iSev > fSev) elegido = inventario
  else elegido = color === 'rojo' ? fisico : inventario

  return { color, razon: elegido.razon, accion: elegido.accion, estrategia: elegido.estrategia ?? null }
}
