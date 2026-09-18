'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Instrucciones de reconocimiento por empresa: se inyectan al prompt de voz/foto/
// texto para adaptar el sistema al rubro y a los códigos de esa empresa.
export default function InstruccionesNlu({ empresaId, valor }) {
  const router = useRouter()
  const [texto, setTexto] = useState(valor || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const cambiado = (texto.trim() || '') !== ((valor || '').trim())

  const guardar = async () => {
    setSaving(true); setMsg('')
    try {
      const res = await fetch(`/api/superadmin/empresa/${empresaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nlu_instrucciones: texto }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) { setMsg('Guardado ✅'); router.refresh() }
      else setMsg(data.message || 'No se pudo guardar.')
    } catch {
      setMsg('Error de conexión.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <p style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))', margin: 0 }}>
        Reglas del rubro para que el sistema entienda la voz, la foto y los códigos de esta empresa.
        Se aplican solo a esta empresa. Si lo dejás vacío, usa el reconocimiento genérico.
      </p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={5}
        placeholder={'Ej: Tienda de calzado. El producto se identifica por CÓDIGO (ej. EM0021-M4) y TALLA (ej. T-39 / T40). El código y la talla NO son cantidad ni precio. El precio suele decirse "a X soles cada uno".'}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-md)',
          border: '1px solid hsl(var(--border))', background: 'hsl(var(--bg-base))',
          fontSize: '0.88rem', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={guardar} disabled={saving || !cambiado} className="btn btn-primary" style={{ padding: '9px 20px' }}>
          {saving ? 'Guardando…' : 'Guardar instrucciones'}
        </button>
        {msg && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))' }}>{msg}</span>}
      </div>
    </div>
  )
}
