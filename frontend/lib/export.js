import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'

/**
 * Exportar datos a formato Excel (.xlsx)
 */
export function exportToExcel(data, sheetName = 'Reporte', fileName = 'reporte.xlsx') {
  const worksheet = XLSX.utils.json_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  XLSX.writeFile(workbook, fileName)
}

/**
 * Exportar reporte en PDF con diseño profesional
 */
export function exportToPDF(title, headers, rows, filename = 'reporte.pdf', empresaNombre = 'Empresa') {
  const doc = new jsPDF()
  
  // Header Corporativo
  doc.setFillColor(13, 148, 136) // Teal color
  doc.rect(0, 0, 210, 40, 'F')
  
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(255, 255, 255)
  doc.text(empresaNombre.toUpperCase(), 15, 25)
  
  doc.setFontSize(10)
  doc.text('REPORTE OFICIAL DE INVENTARIO Y MOVIMIENTOS', 15, 33)
  
  // Título del reporte
  doc.setFontSize(14)
  doc.setTextColor(15, 23, 42) // Slate color
  doc.text(title, 15, 55)
  
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text(`Fecha de Emisión: ${new Date().toLocaleString()}`, 15, 62)
  
  // Crear Tabla
  doc.autoTable({
    startY: 68,
    head: [headers],
    body: rows,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9
    },
    styles: {
      fontSize: 8,
      cellPadding: 4
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    }
  })
  
  doc.save(filename)
}
