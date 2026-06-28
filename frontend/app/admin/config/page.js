'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import {
  Check, Save, Plus, Search, Pencil, Trash2, Upload, X, FileSpreadsheet,
} from 'lucide-react'
import {
  getEmpresaId, getCategorias, createProducto, getCatalogo,
  updateProductoCatalogo, deleteProducto, importProductosCatalogo,
} from '@/lib/queries'

const UNIDADES = ['und', 'kg', 'm', 'm²', 'litro', 'caja', 'bolsa', 'otro']
const PAGE_SIZE = 20
const NUEVO_VACIO = { nombre: '', categoria: '', unidad: 'und', precioReferencial: '' }

// --- Parseo de Excel/CSV -----------------------------------------------------
function normalizeKey(k) {
  return String(k).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
    .replace(/\s+/g, '_')
}
function parseNum(v) {
  if (v === null || v === undefined || v === '') return undefined
  const n = parseFloat(String(v).replace(',', '.'))    // acepta coma decimal
  return Number.isFinite(n) ? n : undefined
}
async function parseCatalogFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
  return json.map(raw => {
    const row = {}
    Object.entries(raw).forEach(([k, v]) => { row[normalizeKey(k)] = v })
    return {
      nombre:            String(row.nombre ?? '').trim(),
      categoria:         String(row.categoria ?? '').trim() || undefined,
      unidad:            String(row.unidad ?? '').trim() || undefined,
      precioReferencial: parseNum(row.precio_referencial ?? row.precio ?? ''),
    }
  }).filter(r => r.nombre)
}

function fmtPrecio(v) {
  if (v === null || v === undefined || v === '') return '—'
  return `S/ ${Number(v).toFixed(2)}`
}

export default function ConfigPage() {
  const [empresaId, setEmpresaId] = useState(null)
  const [loading,   setLoading]   = useState(true)

  // Rubro
  const [rubro,       setRubro]       = useState('')
  const [rubroActual, setRubroActual] = useState('')
  const [savingRubro, setSavingRubro] = useState(false)
  const [savedRubro,  setSavedRubro]  = useState(false)

  // Catálogo
  const [catalogo,     setCatalogo]     = useState([])
  const [categoriasDB, setCategoriasDB] = useState([])
  const [search,       setSearch]       = useState('')
  const [page,         setPage]         = useState(0)

  // Alta manual
  const [nuevo,        setNuevo]        = useState(NUEVO_VACIO)
  const [savingNuevo,  setSavingNuevo]  = useState(false)
  const [formError,    setFormError]    = useState('')
  const [okMsg,        setOkMsg]        = useState('')

  // Edición inline
  const [editingId, setEditingId] = useState(null)
  const [editRow,   setEditRow]   = useState(null)

  // Eliminar
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting,   setDeleting]   = useState(false)

  // Importar
  const [showImport,   setShowImport]   = useState(false)
  const [dragOver,     setDragOver]     = useState(false)
  const [preview,      setPreview]      = useState(null)   // { filas, fileName }
  const [importing,    setImporting]    = useState(false)
  const [importResult, setImportResult] = useState('')

  const loadCatalogo = useCallback(async (empId) => {
    const rows = await getCatalogo(empId)
    setCatalogo(rows)
  }, [])

  useEffect(() => {
    async function load() {
      const empId = await getEmpresaId()
      if (!empId) { setLoading(false); return }
      setEmpresaId(empId)

      const [{ data: empresa }, cats] = await Promise.all([
        supabase.from('empresas').select('rubro').eq('id', empId).single(),
        getCategorias(empId),
      ])
      if (empresa?.rubro) { setRubro(empresa.rubro); setRubroActual(empresa.rubro) }
      setCategoriasDB(cats)
      await loadCatalogo(empId)
      setLoading(false)
    }
    load()
  }, [loadCatalogo])

  const handleSaveRubro = async () => {
    const nuevoR = rubro.trim()
    if (!nuevoR || nuevoR === rubroActual || !empresaId) return
    setSavingRubro(true)
    const { error } = await supabase.from('empresas').update({ rubro: nuevoR }).eq('id', empresaId)
    setSavingRubro(false)
    if (!error) {
      setRubroActual(nuevoR)
      setSavedRubro(true)
      setTimeout(() => setSavedRubro(false), 3000)
    }
  }

  const refrescar = async () => {
    await loadCatalogo(empresaId)
    getCategorias(empresaId).then(setCategoriasDB)
  }

  const submitNuevo = async (e) => {
    e.preventDefault()
    setFormError(''); setOkMsg('')
    const nombre = nuevo.nombre.trim()
    if (!nombre) { setFormError('El nombre es obligatorio.'); return }
    const precioRef = nuevo.precioReferencial === '' ? undefined : parseNum(nuevo.precioReferencial)
    if (nuevo.precioReferencial !== '' && precioRef === undefined) {
      setFormError('El precio referencial debe ser un número válido.'); return
    }

    setSavingNuevo(true)
    const res = await createProducto(empresaId, {
      nombre, categoria: nuevo.categoria, unidad: nuevo.unidad, precioReferencial: precioRef,
    })
    setSavingNuevo(false)
    if (!res.ok) { setFormError(res.message); return }

    setNuevo(NUEVO_VACIO)
    setOkMsg(`"${nombre}" agregado al catálogo.`)
    setTimeout(() => setOkMsg(''), 4000)
    refrescar()
  }

  const startEdit = (prod) => {
    setEditingId(prod.id)
    setEditRow({
      nombre: prod.nombre,
      categoria: prod.categoria,
      unidad: prod.unidad,
      precioReferencial: prod.precioReferencial ?? '',
    })
  }
  const cancelEdit = () => { setEditingId(null); setEditRow(null) }
  const saveEdit = async (prod) => {
    const nombre = (editRow.nombre || '').trim()
    if (!nombre) { setFormError('El nombre no puede quedar vacío.'); return }
    const precioRef = editRow.precioReferencial === '' ? null : parseNum(editRow.precioReferencial)
    const res = await updateProductoCatalogo(empresaId, prod.id, {
      nombre, categoria: editRow.categoria, unidad: editRow.unidad, precioReferencial: precioRef,
    })
    if (!res.ok) { setFormError(res.message); return }
    cancelEdit()
    refrescar()
  }

  const doDelete = async () => {
    if (!confirmDel || deleting) return
    setDeleting(true)
    const res = await deleteProducto(confirmDel.id)
    setDeleting(false)
    if (res.ok) {
      setCatalogo(prev => prev.filter(p => p.id !== confirmDel.id))
      setConfirmDel(null)
    } else {
      setConfirmDel({ ...confirmDel, error: res.message })
    }
  }

  // --- Importación ---
  const handleFile = async (file) => {
    if (!file) return
    setImportResult('')
    try {
      const filas = await parseCatalogFile(file)
      if (filas.length === 0) { setImportResult('⚠️ No se encontraron filas válidas (falta la columna "nombre").'); return }
      setPreview({ filas, fileName: file.name })
    } catch (err) {
      console.error(err)
      setImportResult('⚠️ No se pudo leer el archivo. Verificá que sea un Excel o CSV válido.')
    }
  }
  const confirmImport = async () => {
    if (!preview || importing) return
    setImporting(true)
    const r = await importProductosCatalogo(empresaId, preview.filas)
    setImporting(false)
    setPreview(null)
    setImportResult(`✅ ${r.importados} productos importados, ${r.actualizados} actualizados, ${r.errores} errores.`)
    refrescar()
  }

  const filtered = catalogo.filter(p => p.nombre.toLowerCase().includes(search.toLowerCase()))
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages - 1)
  const paged = filtered.slice(pageSafe * PAGE_SIZE, (pageSafe + 1) * PAGE_SIZE)

  if (loading) {
    return <div style={styles.wrapper}><p style={{ color: 'hsl(var(--text-muted))' }}>Cargando...</p></div>
  }

  return (
    <div style={styles.wrapper}>
      <div style={{ maxWidth: '900px', width: '100%', display: 'flex', flexDirection: 'column', gap: '32px' }}>

        {/* Header */}
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '4px' }}>Configuración</h1>
          <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
            Rubro del negocio y catálogo de productos
          </p>
        </div>

        {/* Rubro del negocio */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={styles.sectionLabel}>Rubro del negocio</div>
          <p style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', margin: 0 }}>
            Personaliza la interpretación de IA del bot de Telegram y el encabezado de los PDF
            (ej: ferretería, abarrotes, plásticos)
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={rubro}
              onChange={(e) => setRubro(e.target.value)}
              placeholder="Ej: ferretería"
              className="input-field"
              style={{ maxWidth: '280px' }}
            />
            <button
              onClick={handleSaveRubro}
              disabled={savingRubro || !rubro.trim() || rubro.trim() === rubroActual}
              className="btn btn-primary"
              style={{
                padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '8px',
                opacity: !rubro.trim() || rubro.trim() === rubroActual ? 0.5 : 1,
              }}
            >
              {savingRubro ? 'Guardando...' : savedRubro
                ? <><Check size={14} /> Guardado</>
                : <><Save size={14} /> Guardar rubro</>}
            </button>
          </div>
        </section>

        {/* Catálogo de productos */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={styles.sectionLabel}>Catálogo de productos</div>
            <p style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0' }}>
              Cargá tus productos para que el sistema los reconozca mejor al registrar por voz o foto.
            </p>
          </div>

          {/* Alta manual (form inline) */}
          <form onSubmit={submitNuevo} style={styles.card}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr 1fr', gap: '10px', alignItems: 'end' }}>
              <label style={styles.fieldLabel}>
                Nombre *
                <input
                  type="text" value={nuevo.nombre}
                  onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                  placeholder="Ej: Cemento Sol 42.5kg" className="input-field"
                />
              </label>
              <label style={styles.fieldLabel}>
                Categoría
                <input
                  type="text" list="cats-list" value={nuevo.categoria}
                  onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })}
                  placeholder="General" className="input-field"
                />
                <datalist id="cats-list">
                  {categoriasDB.map(c => <option key={c.id} value={c.nombre} />)}
                </datalist>
              </label>
              <label style={styles.fieldLabel}>
                Unidad
                <select
                  value={nuevo.unidad}
                  onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })}
                  className="input-field"
                >
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label style={styles.fieldLabel}>
                Precio ref. (S/)
                <input
                  type="number" min="0" step="0.01" value={nuevo.precioReferencial}
                  onChange={(e) => setNuevo({ ...nuevo, precioReferencial: e.target.value })}
                  placeholder="0.00" className="input-field"
                />
              </label>
            </div>
            {formError && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {formError}</span>}
            {okMsg && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-ingreso))' }}>✅ {okMsg}</span>}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={savingNuevo}
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={15} /> {savingNuevo ? 'Agregando…' : 'Agregar producto'}
              </button>
              <button type="button" className="btn btn-secondary"
                onClick={() => { setShowImport(s => !s); setImportResult('') }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Upload size={15} /> Importar Excel/CSV
              </button>
            </div>
          </form>

          {/* Área de importación */}
          {showImport && (
            <div style={styles.card}>
              {!preview ? (
                <>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
                    style={{
                      border: `2px dashed ${dragOver ? 'hsl(var(--accent))' : 'hsl(var(--border))'}`,
                      borderRadius: 'var(--radius-md)', padding: '28px', textAlign: 'center',
                      background: dragOver ? 'hsl(var(--accent) / 0.05)' : 'transparent',
                    }}
                  >
                    <FileSpreadsheet size={26} style={{ color: 'hsl(var(--text-muted))', marginBottom: '8px' }} />
                    <p style={{ fontSize: '0.85rem', margin: '0 0 10px' }}>
                      Arrastrá tu archivo acá, o
                      <label style={{ color: 'hsl(var(--accent))', fontWeight: 600, cursor: 'pointer' }}>
                        {' '}elegí uno
                        <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
                          onChange={(e) => handleFile(e.target.files?.[0])} />
                      </label>
                    </p>
                    <p style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', margin: 0, fontFamily: 'var(--font-mono)' }}>
                      Columnas: nombre, categoria, unidad, precio_referencial
                    </p>
                  </div>
                  {importResult && <span style={{ fontSize: '0.82rem' }}>{importResult}</span>}
                </>
              ) : (
                <>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    Vista previa — {preview.fileName} ({preview.filas.length} filas)
                  </div>
                  <div style={{ overflowX: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius-md)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ background: 'hsl(var(--bg-base))' }}>
                          {['Nombre', 'Categoría', 'Unidad', 'Precio ref.'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'hsl(var(--text-muted))' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.filas.slice(0, 5).map((f, i) => (
                          <tr key={i} style={{ borderTop: '1px solid hsl(var(--border))' }}>
                            <td style={{ padding: '8px 12px' }}>{f.nombre}</td>
                            <td style={{ padding: '8px 12px' }}>{f.categoria || '—'}</td>
                            <td style={{ padding: '8px 12px' }}>{f.unidad || 'und'}</td>
                            <td style={{ padding: '8px 12px' }}>{fmtPrecio(f.precioReferencial)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-primary" onClick={confirmImport} disabled={importing}>
                      {importing ? 'Importando…' : `Confirmar importación (${preview.filas.length})`}
                    </button>
                    <button className="btn btn-secondary" onClick={() => setPreview(null)} disabled={importing}>
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Buscador */}
          <div style={{ position: 'relative', maxWidth: '320px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))' }} />
            <input
              type="text" placeholder="Buscar por nombre..."
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              className="input-field" style={{ paddingLeft: '38px' }}
            />
          </div>

          {/* Tabla de catálogo */}
          <div style={styles.tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'hsl(var(--bg-base))', borderBottom: '1px solid hsl(var(--border))' }}>
                  {['Nombre', 'Categoría', 'Unidad', 'Precio ref.', 'Stock actual', ''].map((h, i) => (
                    <th key={h || i} style={{ padding: '10px 16px', fontWeight: 600, color: 'hsl(var(--text-muted))', fontSize: '0.775rem', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '28px', textAlign: 'center', color: 'hsl(var(--text-muted))' }}>
                    {catalogo.length === 0 ? 'Tu catálogo está vacío. Agregá productos arriba o importá un Excel/CSV.' : 'Sin resultados.'}
                  </td></tr>
                ) : paged.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: i < paged.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}>
                    {editingId === p.id ? (
                      <>
                        <td style={{ padding: '6px 12px' }}>
                          <input className="input-field" style={styles.editInput} value={editRow.nombre}
                            onChange={(e) => setEditRow({ ...editRow, nombre: e.target.value })} />
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <input className="input-field" style={styles.editInput} list="cats-list" value={editRow.categoria}
                            onChange={(e) => setEditRow({ ...editRow, categoria: e.target.value })} />
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <select className="input-field" style={styles.editInput} value={editRow.unidad}
                            onChange={(e) => setEditRow({ ...editRow, unidad: e.target.value })}>
                            {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <input className="input-field" style={styles.editInput} type="number" min="0" step="0.01" value={editRow.precioReferencial}
                            onChange={(e) => setEditRow({ ...editRow, precioReferencial: e.target.value })} />
                        </td>
                        <td style={{ padding: '6px 12px', color: 'hsl(var(--text-muted))' }}>{p.stockTotal}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-primary" style={styles.miniBtn} onClick={() => saveEdit(p)}>Guardar</button>
                          <button className="btn btn-secondary" style={styles.miniBtn} onClick={cancelEdit}>Cancelar</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 16px', fontWeight: 600 }}>{p.nombre}</td>
                        <td style={{ padding: '10px 16px', color: 'hsl(var(--text-secondary))' }}>{p.categoria}</td>
                        <td style={{ padding: '10px 16px', color: 'hsl(var(--text-secondary))' }}>{p.unidad}</td>
                        <td style={{ padding: '10px 16px' }}>{fmtPrecio(p.precioReferencial)}</td>
                        <td style={{ padding: '10px 16px', color: p.stockTotal <= 0 ? 'hsl(var(--color-gasto))' : 'inherit', fontWeight: p.stockTotal <= 0 ? 600 : 400 }}>{p.stockTotal}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button onClick={() => startEdit(p)} aria-label={`Editar ${p.nombre}`} style={styles.iconBtn}><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDel(p)} aria-label={`Eliminar ${p.nombre}`} style={{ ...styles.iconBtn, color: 'hsl(var(--color-gasto))' }}><Trash2 size={14} /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {filtered.length > PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '14px', fontSize: '0.8rem' }}>
              <button className="btn btn-secondary" style={styles.miniBtn} disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)}>Anterior</button>
              <span style={{ color: 'hsl(var(--text-muted))' }}>Página {pageSafe + 1} de {totalPages}</span>
              <button className="btn btn-secondary" style={styles.miniBtn} disabled={pageSafe >= totalPages - 1} onClick={() => setPage(pageSafe + 1)}>Siguiente</button>
            </div>
          )}
        </section>
      </div>

      {/* Modal eliminar */}
      {confirmDel && (
        <div onClick={() => !deleting && setConfirmDel(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'hsl(0 0% 0% / 0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={(e) => e.stopPropagation()} className="glass-card" style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.15rem' }}>Eliminar producto</h2>
              <button onClick={() => !deleting && setConfirmDel(null)} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))', display: 'flex' }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
              ¿Eliminás <strong>{confirmDel.nombre}</strong> del catálogo? Esta acción no se puede deshacer.
            </p>
            {confirmDel.error && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {confirmDel.error}</span>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => setConfirmDel(null)} className="btn btn-secondary" disabled={deleting}>Cancelar</button>
              <button onClick={doDelete} disabled={deleting} className="btn" style={{ background: 'hsl(var(--color-gasto))', color: '#fff' }}>
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  wrapper: { padding: '32px 24px', display: 'flex', justifyContent: 'center' },
  sectionLabel: { fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' },
  card: {
    background: 'hsl(var(--bg-surface))', border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius-lg)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px',
  },
  tableCard: {
    background: 'hsl(var(--bg-surface))', border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius-lg)', overflowX: 'auto',
  },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.8rem', fontWeight: 600 },
  editInput: { padding: '5px 8px', fontSize: '0.82rem', width: '100%' },
  miniBtn: { padding: '5px 12px', fontSize: '0.78rem', marginLeft: '6px' },
  iconBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-secondary))',
    padding: '4px 6px', display: 'inline-flex', alignItems: 'center',
  },
}
