import { useState, useEffect, useRef } from 'react'
import { useAlerts } from '../context/AlertsContext'

export default function GhostBillingToast() {
  const ctx = useAlerts()
  const [toast, setToast] = useState(null)
  const timerRef = useRef(null)
  const lastIdRef = useRef(null)

  const latestAlert = ctx?.physicianAlerts?.[0] ?? null

  useEffect(() => {
    if (!latestAlert || latestAlert.id === lastIdRef.current) return
    lastIdRef.current = latestAlert.id
    setToast(latestAlert)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 6000)
  }, [latestAlert?.id])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (!toast) return null

  return (
    <div
      className="fixed top-4 right-4 z-50 max-w-sm w-full
                 bg-rose-600 text-white rounded-xl shadow-lg
                 px-4 py-3 flex items-start gap-3 animate-fade-in"
      role="alert"
    >
      <div className="mt-0.5 shrink-0 text-rose-200">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug">Ghost Billing Suspected</p>
        <p className="text-xs text-rose-100 mt-0.5">
          {toast.count} claim{toast.count !== 1 ? 's' : ''} flagged under NPI {toast.npi}
        </p>
      </div>
      <button
        onClick={() => setToast(null)}
        className="shrink-0 text-rose-200 hover:text-white font-bold text-lg leading-none"
        aria-label="Dismiss"
      >×</button>
    </div>
  )
}
