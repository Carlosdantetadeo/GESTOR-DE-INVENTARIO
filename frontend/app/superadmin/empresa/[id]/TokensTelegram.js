'use client'

import { useState } from 'react'
import { Copy, Check, RefreshCw } from 'lucide-react'

// Tokens de conexión Telegram de la empresa (solo superadmin): ver, copiar y rotar.
// Rotar regenera el UUID e invalida el token anterior para CONEXIONES NUEVAS
// (los operadores ya vinculados siguen funcionando; para sacar a uno usar Desconectar).
export default function TokensTelegram({ empresaId, tokenVendedor, tokenAdmin }) {
  const [tokens, setTokens] = useState({ vendedor: tokenVendedor || '', admin: tokenAdmin || '' })
  const [error, setError] = useState('')

  const rotar = async (tipo, setSaving) => {
    if (!confirm(`¿Rotar el token ${tipo}? El token anterior dejará de servir para nuevas conexiones.`)) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/superadmin/empresa/${empresaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotar: tipo }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) setTokens(t => ({ ...t, [tipo]: data.token }))
      else setError(data.message || 'No se pudo rotar el token.')
    } catch {
      setError('Error de conexión.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <p style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))', margin: 0 }}>
        Los operadores se conectan al bot enviando <code>/start &lt;token&gt;</code>. El token
        <strong> vendedor</strong> es para empleados; el <strong>admin</strong> habilita reportes y no debe compartirse.
      </p>
      {error && <span style={{ fontSize: '0.82rem', color: 'hsl(var(--color-gasto))' }}>⚠️ {error}</span>}
      <TokenRow etiqueta="Token vendedor" valor={tokens.vendedor} onRotar={(s) => rotar('vendedor', s)} />
      <TokenRow etiqueta="Token admin" valor={tokens.admin} onRotar={(s) => rotar('admin', s)} />
    </div>
  )
}

function TokenRow({ etiqueta, valor, onRotar }) {
  const [copiado, setCopiado] = useState(false)
  const [saving, setSaving] = useState(false)

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch { /* noop */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>{etiqueta}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <code style={{ flex: '1 1 280px', minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'hsl(var(--bg-base))', border: '1px solid hsl(var(--border))', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          {valor || '—'}
        </code>
        <button onClick={copiar} className="btn btn-secondary" style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? 'Copiado' : 'Copiar'}
        </button>
        <button onClick={() => onRotar(setSaving)} disabled={saving} className="btn btn-secondary"
          style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '6px', color: 'hsl(var(--color-gasto))', borderColor: 'hsl(var(--color-gasto) / 0.4)' }}>
          <RefreshCw size={14} /> {saving ? 'Rotando…' : 'Rotar'}
        </button>
      </div>
    </div>
  )
}
