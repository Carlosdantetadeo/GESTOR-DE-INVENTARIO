'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Check, Zap, Brain, Sparkles, Save } from 'lucide-react'

const MODELS = [
  {
    id: 'groq-llama',
    nombre: 'Groq Llama 3.3',
    proveedor: 'Groq',
    descripcion: 'Rápido y económico. Ideal para la mayoría de los registros diarios.',
    costo: '~$0.37 / 1,000 mensajes',
    badge: 'Recomendado',
    badgeColor: '#16a34a',
    Icon: Zap,
  },
  {
    id: 'anthropic-haiku',
    nombre: 'Claude Haiku',
    proveedor: 'Anthropic',
    descripcion: 'Mayor precisión para descripciones complejas o ambiguas.',
    costo: '~$0.80 / 1,000 mensajes',
    badge: 'Balanceado',
    badgeColor: '#2563eb',
    Icon: Brain,
  },
  {
    id: 'anthropic-sonnet',
    nombre: 'Claude Sonnet',
    proveedor: 'Anthropic',
    descripcion: 'Máxima precisión. Para operaciones de alto valor o inventarios grandes.',
    costo: '~$3.00 / 1,000 mensajes',
    badge: 'Premium',
    badgeColor: '#7c3aed',
    Icon: Sparkles,
  },
]

export default function ConfigPage() {
  const [currentModel, setCurrentModel] = useState('groq-llama')
  const [selected,     setSelected]     = useState('groq-llama')
  const [empresaId,    setEmpresaId]    = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [consumo,      setConsumo]      = useState([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const empId = user.user_metadata?.empresa_id
      setEmpresaId(empId)

      const [{ data: empresa }, { data: rows }] = await Promise.all([
        supabase.from('empresas').select('nlu_model').eq('id', empId).single(),
        supabase
          .from('consumo_ia')
          .select('modelo, tokens_entrada, tokens_salida, costo_usd')
          .eq('empresa_id', empId)
          .order('created_at', { ascending: false })
          .limit(10000),
      ])

      if (empresa?.nlu_model) {
        setCurrentModel(empresa.nlu_model)
        setSelected(empresa.nlu_model)
      }

      if (rows?.length) {
        const agg = {}
        rows.forEach(r => {
          if (!agg[r.modelo]) agg[r.modelo] = { llamadas: 0, tokens: 0, costo: 0 }
          agg[r.modelo].llamadas += 1
          agg[r.modelo].tokens   += (r.tokens_entrada + r.tokens_salida)
          agg[r.modelo].costo    += Number(r.costo_usd)
        })
        setConsumo(Object.entries(agg).map(([modelo, v]) => ({ modelo, ...v })))
      }

      setLoading(false)
    }
    load()
  }, [])

  const handleSave = async () => {
    if (selected === currentModel || !empresaId) return
    setSaving(true)
    const { error } = await supabase
      .from('empresas').update({ nlu_model: selected }).eq('id', empresaId)
    setSaving(false)
    if (!error) {
      setCurrentModel(selected)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  if (loading) {
    return (
      <div style={styles.wrapper}>
        <p style={{ color: 'hsl(var(--text-muted))' }}>Cargando...</p>
      </div>
    )
  }

  const totalCosto  = consumo.reduce((s, c) => s + c.costo, 0)
  const totalLlamadas = consumo.reduce((s, c) => s + c.llamadas, 0)

  return (
    <div style={styles.wrapper}>
      <div style={{ maxWidth: '680px', width: '100%', display: 'flex', flexDirection: 'column', gap: '32px' }}>

        {/* Header */}
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '4px' }}>Configuración</h1>
          <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
            Elegí el modelo de IA que procesa los mensajes de tus operarios en Telegram
          </p>
        </div>

        {/* Selector de modelo */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={styles.sectionLabel}>Modelo de lenguaje (NLU)</div>

          {MODELS.map(({ id, nombre, proveedor, descripcion, costo, badge, badgeColor, Icon }) => {
            const isSelected = selected === id
            const isCurrent  = currentModel === id
            return (
              <button
                key={id}
                onClick={() => setSelected(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '16px 18px', textAlign: 'left', width: '100%',
                  background: isSelected ? 'hsl(var(--accent) / 0.06)' : 'hsl(var(--bg-surface))',
                  border: `2px solid ${isSelected ? 'hsl(var(--accent))' : 'hsl(var(--border))'}`,
                  borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {/* Ícono */}
                <div style={{
                  width: '40px', height: '40px', borderRadius: 'var(--radius-md)', flexShrink: 0,
                  background: isSelected ? 'hsl(var(--accent))' : 'hsl(var(--bg-base))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={18} color={isSelected ? '#fff' : 'hsl(var(--text-muted))'} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{nombre}</span>
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
                      borderRadius: '99px', color: '#fff', background: badgeColor,
                    }}>{badge}</span>
                    {isCurrent && (
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px',
                        borderRadius: '99px', color: 'hsl(var(--accent))',
                        border: '1px solid hsl(var(--accent))',
                      }}>Activo</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', marginBottom: '2px' }}>
                    {descripcion}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontFamily: 'var(--font-mono)' }}>
                    {proveedor} · {costo}
                  </div>
                </div>

                {/* Radio */}
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${isSelected ? 'hsl(var(--accent))' : 'hsl(var(--border))'}`,
                  background: isSelected ? 'hsl(var(--accent))' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                </div>
              </button>
            )
          })}

          <button
            onClick={handleSave}
            disabled={saving || selected === currentModel}
            className="btn btn-primary"
            style={{
              alignSelf: 'flex-start', padding: '10px 24px', marginTop: '4px',
              display: 'flex', alignItems: 'center', gap: '8px',
              opacity: selected === currentModel ? 0.5 : 1,
            }}
          >
            {saving ? 'Guardando...' : saved
              ? <><Check size={14} /> Guardado</>
              : <><Save size={14} /> Guardar modelo</>
            }
          </button>
        </section>

        {/* Consumo acumulado */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={styles.sectionLabel}>Consumo acumulado</div>
            {totalLlamadas > 0 && (
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontFamily: 'var(--font-mono)' }}>
                {totalLlamadas.toLocaleString()} llamadas · ${totalCosto.toFixed(4)} USD total
              </span>
            )}
          </div>

          {consumo.length === 0 ? (
            <div style={{
              background: 'hsl(var(--bg-surface))', border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius-lg)', padding: '28px', textAlign: 'center',
              color: 'hsl(var(--text-muted))', fontSize: '0.875rem',
            }}>
              Aún no hay registros de consumo. El uso del bot se irá acumulando aquí.
            </div>
          ) : (
            <div style={{
              background: 'hsl(var(--bg-surface))', border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'hsl(var(--bg-base))', borderBottom: '1px solid hsl(var(--border))' }}>
                    {['Modelo', 'Llamadas', 'Tokens', 'Costo USD'].map((h, i) => (
                      <th key={h} style={{
                        padding: '10px 16px', fontWeight: 600,
                        color: 'hsl(var(--text-muted))', fontSize: '0.775rem',
                        textAlign: i === 0 ? 'left' : 'right',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {consumo.map((c, i) => (
                    <tr key={c.modelo} style={{
                      borderBottom: i < consumo.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                    }}>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                        {c.modelo}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                        {c.llamadas.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {c.tokens.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        ${c.costo.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

const styles = {
  wrapper: {
    padding: '32px 24px',
    display: 'flex',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'hsl(var(--text-secondary))',
  },
}
