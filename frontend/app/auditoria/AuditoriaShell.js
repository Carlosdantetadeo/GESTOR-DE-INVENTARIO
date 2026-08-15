'use client'

// Shell de la PWA de AuditorIA:
//  - registra el service worker (scope /auditoria)
//  - expone la sesión (empresa/rol/sede) vía contexto
//  - muestra estado online/offline y el badge de pendientes (FR-010)
//  - arranca el motor de sync (flush en `online` y en arranque — FR-017)
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { getAuditoriaSession } from '../../lib/auditoria/auth'
import { startSync, pendingCount } from '../../lib/auditoria/offline/syncEngine'

const AuditoriaContext = createContext(null)

export function useAuditoria() {
  return useContext(AuditoriaContext)
}

export default function AuditoriaShell({ children }) {
  const [session, setSession] = useState(null)
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)

  const refreshPending = useCallback(async () => {
    try { setPending(await pendingCount()) } catch { /* IndexedDB no disponible aún */ }
  }, [])

  useEffect(() => {
    setOnline(navigator.onLine)

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/auditoria-sw.js', { scope: '/auditoria' })
        .catch(() => { /* SW opcional: la app sigue funcionando sin él */ })
    }

    getAuditoriaSession().then(setSession)

    const onOnline = () => { setOnline(true); refreshPending() }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    const stopSync = startSync()
    refreshPending()

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      stopSync()
    }
  }, [refreshPending])

  const value = { session, online, pending, refreshPending }

  return (
    <AuditoriaContext.Provider value={value}>
      <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: '#0f172a', color: '#fff',
          position: 'sticky', top: 0, zIndex: 10,
        }}>
          <strong>Almacenero Digital</strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.8rem' }}>
            {pending > 0 && (
              <span style={{
                background: '#f59e0b', color: '#0f172a', borderRadius: 999,
                padding: '2px 8px', fontWeight: 700,
              }}>
                {pending} pendiente{pending === 1 ? '' : 's'}
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 8, height: 8, borderRadius: 999,
                background: online ? '#22c55e' : '#ef4444', display: 'inline-block',
              }} />
              {online ? 'En línea' : 'Sin conexión'}
            </span>
          </span>
        </header>
        {children}
      </div>
    </AuditoriaContext.Provider>
  )
}
