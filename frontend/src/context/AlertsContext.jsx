import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { subscribeAlerts } from '../api'

const AlertsContext = createContext(null)

export function AlertsProvider({ children }) {
  const [alerts, setAlerts] = useState([])
  const [physicianAlerts, setPhysicianAlerts] = useState([])
  const [bellOpen, setBellOpenState] = useState(false)
  const [seenCount, setSeenCount] = useState(0)
  const [connected, setConnected] = useState(true)

  const addAlert = useCallback((a) => {
    if (a.recipient === 'physician') {
      setPhysicianAlerts((prev) => {
        const id = a.id ?? Date.now()
        if (prev.some((x) => x.id === id)) return prev
        return [{ ...a, id, ts: a.ts || new Date() }, ...prev]
      })
    } else if (!a.recipient || a.recipient === 'plan') {
      setAlerts((prev) => {
        const id = a.id ?? Date.now()
        if (prev.some((x) => x.id === id)) return prev
        return [{ ...a, id, ts: a.ts || new Date() }, ...prev]
      })
    }
  }, [])

  const setBellOpen = useCallback((val) => {
    setBellOpenState(val)
  }, [])

  useEffect(() => {
    if (bellOpen) setSeenCount(physicianAlerts.length)
  }, [bellOpen, physicianAlerts.length])

  const unreadCount = Math.max(0, physicianAlerts.length - seenCount)

  useEffect(() => {
    const es = subscribeAlerts(addAlert, {
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
    })
    return () => es.close()
  }, [addAlert])

  return (
    <AlertsContext.Provider value={{
      alerts, addAlert, connected,
      physicianAlerts, unreadCount, bellOpen, setBellOpen,
    }}>
      {children}
    </AlertsContext.Provider>
  )
}

export function useAlerts() {
  return useContext(AlertsContext)
}
