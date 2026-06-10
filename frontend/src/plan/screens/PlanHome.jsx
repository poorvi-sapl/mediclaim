import { useState, useEffect, useRef } from 'react'
import { getPlanSummary, getAlertsHistory } from '../../api'
import { useAlerts } from '../../context/AlertsContext'
import { Icon, StatCard, fmtUSD, timeAgo } from '../../components/ui'

const EMPTY = { totalNPIs: 0, highRiskNPIs: 0, activeAlertsToday: 0, totalClaims: 0 }

// Every action type shown in the feed (icon + verb).
const FEED_META = {
  flagged:        { icon: 'flag',  chip: 'bg-amber-50 text-amber-500',    verb: 'flagged' },
  confirmed:      { icon: 'check', chip: 'bg-emerald-50 text-emerald-600', verb: 'confirmed' },
  disputed:       { icon: 'x',     chip: 'bg-rose-50 text-rose-600',       verb: 'disputed' },
  unknownPatient: { icon: 'userx', chip: 'bg-slate-100 text-slate-500',    verb: 'reported unknown patient' },
  deniedOrder:    { icon: 'ban',   chip: 'bg-rose-50 text-rose-600',       verb: 'denied ordering from' },
}

const nameCls = 'font-semibold text-[#1E3A5F] hover:underline cursor-pointer'

export default function PlanHome({ setActiveScreen, onOpenNpi, onOpenSupplier }) {
  const { alerts, addAlert, connected } = useAlerts()
  const [summary, setSummary] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const historyLoaded = useRef(false)

  useEffect(() => {
    let cancelled = false
    getPlanSummary()
      .then((s) => { if (!cancelled) { setSummary(s.summary); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // Backfill recent history into the shared alerts store (deduped). Live events arrive
  // via the AlertsProvider SSE subscription — no duplicate connection here.
  useEffect(() => {
    if (historyLoaded.current) return
    historyLoaded.current = true
    getAlertsHistory(50).then(({ items }) => { [...items].reverse().forEach(addAlert) }).catch(() => {})
  }, [addAlert])

  const cards = [
    { label: 'Total NPIs Monitored', value: summary.totalNPIs, icon: 'users', accent: 'navy', onClick: () => setActiveScreen('leaderboard') },
    { label: 'High-Risk NPIs', value: summary.highRiskNPIs, icon: 'alertTri', accent: 'rose', valueClass: summary.highRiskNPIs > 0 ? 'text-rose-600' : '', onClick: () => setActiveScreen('leaderboard', 'high') },
    { label: 'Active Alerts Today', value: summary.activeAlertsToday, icon: 'alerts', accent: 'amber', valueClass: summary.activeAlertsToday > 0 ? 'text-amber-600' : '', onClick: () => document.getElementById('live-feed')?.scrollIntoView({ behavior: 'smooth' }) },
    { label: 'Total Claims in System', value: (summary.totalClaims || 0).toLocaleString(), icon: 'file', accent: 'blue', onClick: () => setActiveScreen('leaderboard') },
  ]

  const sorted = [...alerts].sort((a, b) => new Date(b.ts) - new Date(a.ts))

  return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      {error && (
        <div className="mc-card border-rose-200 bg-rose-50/50 px-6 py-4 mb-6 text-sm">
          <span className="font-semibold text-rose-600">Couldn't load dashboard:</span> <span className="text-slate-500">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-7">
        {cards.map((c) => <StatCard key={c.label} {...c} loading={loading} />)}
      </div>

      {/* Live Activity Feed (replaces the old static "Recent Physician Flags") */}
      <div id="live-feed" className="mc-card overflow-hidden scroll-mt-20">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Live Activity Feed</h2>
            <p className="text-xs text-slate-400 mt-0.5">Real-time physician actions · updates instantly</p>
          </div>
          <span className="inline-flex items-center gap-2 text-xs font-bold text-emerald-600 shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 text-emerald-500 live-dot" /> Live
          </span>
        </div>

        {!connected && (
          <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 text-xs font-medium text-amber-700">
            ⚠ Live connection interrupted — reconnecting…
          </div>
        )}

        <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-100">
          {sorted.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm italic text-slate-400">
              No activity yet. Alerts will appear here as physicians review claims.
            </div>
          ) : sorted.map((a) => {
            const m = FEED_META[a.action] || FEED_META.flagged
            const supId = a.supplierNpi || a.supplierId
            return (
              <div key={a.id} className="px-6 py-3.5 flex items-center gap-4 animate-fade-in-up">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${m.chip}`}>
                  <Icon name={m.icon} size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-700">
                    {a.npi
                      ? <span onClick={() => onOpenNpi?.({ npi: a.npi, name: a.physicianName })} className={nameCls}>{a.physicianName}</span>
                      : <span className="font-semibold text-slate-700">{a.physicianName}</span>}
                    {' '}<span className="text-slate-500">{m.verb}</span>{' '}
                    {a.action === 'unknownPatient'
                      ? <span className="font-medium text-slate-600">{a.patientName}</span>
                      : (supId
                          ? <span onClick={() => onOpenSupplier?.({ id: supId, name: a.supplierName })} className={nameCls}>{a.supplierName}</span>
                          : <span className="font-semibold text-slate-700">{a.supplierName}</span>)}
                    {a.escalation && <span className="ml-2 pill pill-critical">PHYSICIAN DENIAL</span>}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 tabular-nums">{fmtUSD(a.amount, 2)} · {timeAgo(a.ts)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
