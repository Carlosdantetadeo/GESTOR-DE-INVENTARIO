'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Building2, Mail, MapPin, Tag, CheckCircle2, AlertCircle, Plus, Trash2, ArrowLeft } from 'lucide-react'

const MAX_SEDES = 20

export default function NuevaEmpresaForm() {
  const [empresa, setEmpresa] = useState('')
  const [rubro, setRubro]     = useState('')
  const [email, setEmail]     = useState('')
  const [sedes, setSedes]     = useState([''])
  const [instrucciones, setInstrucciones] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(false)
  const [tempPass, setTempPass] = useState('')

  const addSede = () => {
    if (sedes.length >= MAX_SEDES) return
    setSedes(s => [...s, ''])
  }
  const removeSede = (index) => {
    if (sedes.length <= 1) return
    setSedes(s => s.filter((_, i) => i !== index))
  }
  const updateSede = (index, value) => {
    setSedes(s => s.map((v, i) => (i === index ? value : v)))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const sedesValidas = sedes.map(s => s.trim()).filter(Boolean)
    if (sedesValidas.length < 1) {
      setError('Agrega al menos una sede con nombre.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/superadmin/empresa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa_nombre:    empresa.trim(),
          rubro:             rubro.trim(),
          admin_email:       email.trim(),
          sedes:             sedesValidas,
          nlu_instrucciones: instrucciones.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.message ?? `Error ${res.status}`)
      if (data.temp_password) setTempPass(data.temp_password)
      setSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Pantalla de éxito ─────────────────────────────────────────────────────

  if (success) {
    return (
      <div style={{ maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <CheckCircle2 size={28} color="#16a34a" />
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>Empresa creada</div>
              <div style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))' }}>
                Se envió un email al administrador con las credenciales y los tokens de Telegram.
              </div>
            </div>
          </div>

          {tempPass && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '0.875rem' }}>Contraseña temporal</div>
              <div style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
                Guárdala ahora — no se vuelve a mostrar. El administrador debe cambiarla al primer ingreso.
              </div>
              <code style={{ fontFamily: 'var(--font-mono)', background: 'hsl(var(--border))', display: 'block', padding: '8px 10px', borderRadius: '4px', fontSize: '0.9rem', letterSpacing: '0.05em' }}>
                {tempPass}
              </code>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <Link href="/superadmin" className="btn btn-primary" style={{ padding: '10px 18px', textDecoration: 'none' }}>
              Volver al listado
            </Link>
            <button
              type="button"
              onClick={() => {
                setEmpresa(''); setRubro(''); setEmail(''); setSedes(['']); setTempPass(''); setSuccess(false)
              }}
              className="btn"
              style={{ padding: '10px 18px', border: '1px solid hsl(var(--border))', background: 'transparent', cursor: 'pointer' }}
            >
              Crear otra empresa
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Formulario ────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <Link href="/superadmin" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'hsl(var(--text-muted))', textDecoration: 'none', fontSize: '0.85rem', marginBottom: '10px' }}>
          <ArrowLeft size={15} /> Volver al listado
        </Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px' }}>Nueva empresa</h1>
        <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
          Alta manual de un cliente. Se crea la empresa, sus sedes y el usuario administrador.
        </p>
      </div>

      <div className="glass-card">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

          <Field label="Nombre de la empresa">
            <div style={{ position: 'relative' }}>
              <Building2 size={15} style={fieldIcon} />
              <input type="text" required value={empresa} onChange={(e) => setEmpresa(e.target.value)}
                placeholder="Ej: Ferretería Los Andes" className="input-field" style={{ paddingLeft: '38px' }} />
            </div>
          </Field>

          <Field label="Rubro del negocio">
            <div style={{ position: 'relative' }}>
              <Tag size={15} style={fieldIcon} />
              <input type="text" required value={rubro} onChange={(e) => setRubro(e.target.value)}
                placeholder="Ej: ferretería, abarrotes, plásticos" className="input-field" style={{ paddingLeft: '38px' }} />
            </div>
          </Field>

          <Field label="Email del administrador">
            <div style={{ position: 'relative' }}>
              <Mail size={15} style={fieldIcon} />
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@tuempresa.com" className="input-field" style={{ paddingLeft: '38px' }} />
            </div>
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={label}>Sedes / sucursales</label>
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>Mínimo 1 · máx. {MAX_SEDES}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sedes.map((nombre, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <MapPin size={15} style={fieldIcon} />
                    <input type="text" value={nombre} onChange={(e) => updateSede(i, e.target.value)}
                      placeholder={i === 0 ? 'Ej: Sede Centro' : `Sede ${i + 1}`}
                      className="input-field" style={{ paddingLeft: '38px' }} aria-label={`Sede ${i + 1}`} />
                  </div>
                  {sedes.length > 1 && (
                    <button type="button" onClick={() => removeSede(i)} className="btn"
                      style={{ padding: '10px', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'hsl(var(--text-muted))', cursor: 'pointer' }}
                      aria-label={`Quitar sede ${i + 1}`}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {sedes.length < MAX_SEDES && (
              <button type="button" onClick={addSede} className="btn"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px', border: '1px dashed hsl(var(--border))', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'hsl(var(--accent))', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}>
                <Plus size={16} /> Agregar otra sede
              </button>
            )}
          </div>

          <Field label="Reglas de reconocimiento del rubro (opcional)">
            <textarea
              value={instrucciones}
              onChange={(e) => setInstrucciones(e.target.value)}
              rows={4}
              placeholder={'Ej: Tienda de calzado. Producto por CÓDIGO (EM0021-M4) y TALLA (T-39 / T40). El código y la talla NO son cantidad ni precio. El precio se dice "a X soles cada uno".'}
              className="input-field"
              style={{ resize: 'vertical', minHeight: 92, lineHeight: 1.5, paddingLeft: '12px' }}
            />
            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
              Para que el sistema entienda la voz/foto/códigos de esta empresa. Se puede editar luego en la ficha.
            </span>
          </Field>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '0.825rem', color: '#dc2626', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary" style={{ padding: '11px', marginTop: '2px' }}>
            {loading ? 'Creando empresa...' : 'Crear empresa'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({ label: text, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={label}>{text}</label>
      {children}
    </div>
  )
}

const label = { fontSize: '0.825rem', fontWeight: 500, color: 'hsl(var(--text-secondary))' }
const fieldIcon = { position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))' }
