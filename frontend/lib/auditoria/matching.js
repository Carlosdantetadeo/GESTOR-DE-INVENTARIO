// Matching de piezas on-device (offline). Similitud por trigramas sobre el
// nombre y la referencia. Sin red, sin pgvector (research R4). Devuelve las
// mejores coincidencias del catálogo local para desambiguar por voz o texto.

export function normalizar(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar acentos (marcas combinantes)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trigramas(s) {
  const t = `  ${s} `
  const set = new Set()
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3))
  return set
}

// Índice de similitud de Jaccard sobre trigramas: 0 (nada) a 1 (idéntico).
export function similitud(a, b) {
  const A = trigramas(normalizar(a))
  const B = trigramas(normalizar(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

// buscar(texto, catalogo, { limite }) → [{ pieza, score }] ordenado desc.
// La referencia exacta gana (score 1) como desempate.
export function buscar(texto, catalogo, { limite = 3 } = {}) {
  const q = normalizar(texto)
  if (!q) return []
  const scored = catalogo.map((p) => {
    const refExacta = p.referencia && normalizar(p.referencia) === q
    const score = refExacta
      ? 1
      : Math.max(similitud(q, p.nombre), p.referencia ? similitud(q, p.referencia) : 0)
    return { pieza: p, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
}
