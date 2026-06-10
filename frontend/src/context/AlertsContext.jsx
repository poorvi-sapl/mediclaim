import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { subscribeAlerts } from '../api'

const AlertsContext = createContext(null)

export function AlertsProvider({ children }) {
  const [alerts, setAlerts] = useState([])
  const [connected, setConnected] = useState(true)   // SSE connection health (drives the feed banner)

  const addAlert = useCallback((a) => {
    setAlerts((prev) => {
      const id = a.id ?? Date.now()
      if (prev.some((x) => x.id === id)) return prev   // dedupe (SSE reconnect/replay)
      return [{ ...a, id, ts: a.ts || new Date() }, ...prev]
    })
  }, [])

  // Stream physician-action alerts from the backend SSE endpoint.
  useEffect(() => {
    const es = subscribeAlerts(addAlert, {
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),   // EventSource auto-reconnects; onOpen flips it back
    })
    return () => es.close()
  }, [addAlert])

  return (
    <AlertsContext.Provider value={{ alerts, addAlert, connected }}>
      {children}
    </AlertsContext.Provider>
  )
}

export function useAlerts() {
  return useContext(AlertsContext)
}
