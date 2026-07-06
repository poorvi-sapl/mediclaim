import { useAlerts } from '../context/AlertsContext'

export default function PhysicianAlerts() {
  const ctx = useAlerts()
  const alerts = ctx?.physicianAlerts ?? []

  if (alerts.length === 0) return null

  return (
    <div className="w-full px-4 sm:px-7 pt-4">
      <div className="mc-card border-rose-200 bg-rose-50/40">
        <div className="px-5 py-3 border-b border-rose-100 flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="#dc2626" strokeWidth="2" strokeLinecap="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm font-semibold text-rose-700">
            Ghost Billing Alerts ({alerts.length})
          </span>
        </div>
        <ul className="divide-y divide-rose-100 max-h-72 overflow-y-auto">
          {alerts.map((a) => (
            <li key={a.id} className="px-5 py-2.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center rounded-full bg-rose-100 text-rose-700
                                 text-xs font-semibold px-2 py-0.5 shrink-0">
                  Ghost Billing
                </span>
                <span className="text-sm text-slate-700 truncate">
                  {a.count} claim{a.count !== 1 ? 's' : ''} flagged — NPI {a.npi}
                </span>
              </div>
              <span className="text-xs text-slate-400 shrink-0 tabular-nums">
                {new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
