// Compresión de imágenes en el cliente antes de encolar/subir (Assumptions:
// máx 2MB por foto). Redimensiona y re-encoda a JPEG bajando calidad si hace falta.

function cargarImagen(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = reject
    img.src = url
  })
}

function toBlob(canvas, calidad) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad))
}

export async function comprimirImagen(file, maxBytes = 2 * 1024 * 1024, maxLado = 1600) {
  const img = await cargarImagen(file)
  const escala = Math.min(1, maxLado / Math.max(img.width, img.height))
  const width = Math.round(img.width * escala)
  const height = Math.round(img.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(img, 0, 0, width, height)

  let calidad = 0.8
  let blob = await toBlob(canvas, calidad)
  while (blob && blob.size > maxBytes && calidad > 0.3) {
    calidad -= 0.15
    blob = await toBlob(canvas, calidad)
  }
  return blob
}
