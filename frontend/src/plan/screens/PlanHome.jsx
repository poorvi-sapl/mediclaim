import { useState, useEffect, useRef } from 'react'
import { getPlanSummary, getAlertsHistory } from '../../api'
import { useAlerts } from '../../context/AlertsContext'
import { Icon, StatCard, fmtUSD, timeAgo } from '../../components/ui'
import AnalyticsPanel from '../../components/AnalyticsPanel'
import DashboardOverview from '../components/DashboardOverview'

const EMPTY = { totalNPIs: 0, highRiskNPIs: 0, activeAlertsToday: 0, totalClaims: 0 }

const FEED_META = {
  flagged:        { icon: 'flag',  chip: 'bg-amber-100 text-amber-500',    badge: 'bg-amber-100 text-amber-700',    verb: 'Flagged',         bar: 'bg-amber-400'   },
  confirmed:      { icon: 'check', chip: 'bg-emerald-100 text-emerald-600', badge: 'bg-emerald-100 text-emerald-700', verb: 'Confirmed',       bar: 'bg-emerald-400' },
  disputed:       { icon: 'x',     chip: 'bg-rose-100 text-rose-500',       badge: 'bg-rose-100 text-rose-600',       verb: 'Disputed',        bar: 'bg-rose-400'    },
  unknownPatient: { icon: 'userx', chip: 'bg-slate-100 text-slate-500',     badge: 'bg-slate-100 text-slate-600',     verb: 'Unknown Patient', bar: 'bg-slate-300'   },
  deniedOrder:    { icon: 'ban',   chip: 'bg-rose-100 text-rose-500',       badge: 'bg-rose-100 text-rose-600',       verb: 'Denied Order',    bar: 'bg-rose-400'    },
}

// Underline link style — dotted at rest (signals clickability), solid on hover
const nameCls = 'font-semibold text-sm text-[#1E3A5F] cursor-pointer underline underline-offset-2 decoration-[#1E3A5F]/30 hover:decoration-[#1E3A5F] hover:text-[#0f2540] transition-colors duration-150 focus-visible:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[#1E3A5F]/30'

const FILTERS = [
  { key: 'all',           label: 'All' },
  { key: 'confirmed',     label: 'Confirmed' },
  { key: 'disputed',      label: 'Disputed' },
  { key: 'flagged',       label: 'Flagged' },
  { key: 'unknownPatient',label: 'Unknown' },
  { key: 'deniedOrder',   label: 'Denied' },
]

const SORTS = [
  { key: 'newest',   label: 'Newest First' },
  { key: 'oldest',   label: 'Oldest First' },
  { key: 'amt_desc', label: 'Highest Amount' },
  { key: 'amt_asc',  label: 'Lowest Amount' },
]

export default function PlanHome({ setActiveScreen, onOpenNpi, onOpenSupplier }) {
  const { alerts, addAlert, connected } = useAlerts()
  const [summary, setSummary] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterAction, setFilterAction] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [sortOpen, setSortOpen] = useState(false)
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
    { label: 'Total NPIs Monitored', value: summary.totalNPIs, icon: 'users', accent: 'navy', accentBar: false, onClick: () => setActiveScreen('leaderboard') },
    { label: 'High-Risk NPIs', value: summary.highRiskNPIs, icon: 'alertTri', accent: 'rose', accentBar: false, valueClass: summary.highRiskNPIs > 0 ? 'text-rose-600' : '', onClick: () => setActiveScreen('leaderboard', 'high') },
    { label: 'Active Alerts Today', value: summary.activeAlertsToday, icon: 'alerts', accent: 'amber', accentBar: false, valueClass: summary.activeAlertsToday > 0 ? 'text-amber-600' : '', onClick: () => document.getElementById('live-feed')?.scrollIntoView({ behavior: 'smooth' }) },
    { label: 'Total Claims in System', value: (summary.totalClaims || 0).toLocaleString(), icon: 'file', accent: 'blue', accentBar: false, onClick: () => setActiveScreen('leaderboard') },
  ]

  const displayed = [...alerts]
    .filter(a => filterAction === 'all' || a.action === filterAction)
    .sort((a, b) => {
      if (sortBy === 'newest')   return new Date(b.ts) - new Date(a.ts)
      if (sortBy === 'oldest')   return new Date(a.ts) - new Date(b.ts)
      if (sortBy === 'amt_desc') return (b.amount || 0) - (a.amount || 0)
      return (a.amount || 0) - (b.amount || 0)
    })

  return (
    <div className="w-full px-7 py-7">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => <StatCard key={c.label} {...c} spark={false} loading={loading} />)}
      </div>

      <DashboardOverview />

      {error && (
        <div className="mc-card border-rose-200 bg-rose-50/50 px-6 py-4 mb-6 text-sm">
          <span className="font-semibold text-rose-600">Couldn't load dashboard:</span> <span className="text-slate-500">{error}</span>
        </div>
      )}

      {/* Live Activity Feed */}
      <div id="live-feed" className="mc-card overflow-hidden scroll-mt-20">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 bg-gradient-to-r from-[#f8fafc] via-white to-white">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-[#1E3A5F]/[0.07] text-[#1E3A5F] ring-1 ring-inset ring-[#1E3A5F]/10 shrink-0">
              <Icon name="alerts" size={17} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 leading-tight">Live Activity Feed</h2>
                {displayed.length > 0 && (
                  <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md tabular-nums">{displayed.length}</span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Real-time physician actions · updates instantly</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 ring-1 ring-inset ring-emerald-200/70 px-2.5 py-1 rounded-full shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 text-emerald-500 live-dot" /> Live
          </span>
        </div>

        {!connected && (
          <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 text-xs font-medium text-amber-700">
            ⚠ Live connection interrupted — reconnecting…
          </div>
        )}

        {/* Filter + Sort toolbar */}
        <div className="px-4 sm:px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 bg-white">
          {/* Filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
            {FILTERS.map(f => {
              const count = f.key === 'all' ? alerts.length : alerts.filter(a => a.action === f.key).length
              const isActive = filterAction === f.key
              return (
                <button key={f.key} onClick={() => setFilterAction(f.key)}
                        className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full transition-all duration-150 ${
                          isActive
                            ? 'bg-[#0d1f35] text-white shadow-sm'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                        }`}>
                  {f.label}
                  {count > 0 && (
                    <span className={`text-[11px] tabular-nums font-bold ${isActive ? 'opacity-55' : 'text-slate-400'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Sort dropdown */}
          <div className="relative ml-auto shrink-0">
            <button onClick={() => setSortOpen(v => !v)} onBlur={() => setTimeout(() => setSortOpen(false), 150)}
                    className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 hover:text-slate-700 px-3 py-1.5 rounded-full transition-all duration-150">
              <Icon name="clock" size={12} stroke={2} />
              {SORTS.find(s => s.key === sortBy)?.label}
              <Icon name="chevronDown" size={11} stroke={2.5} />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/80 overflow-hidden z-20 min-w-[160px] py-1">
                {SORTS.map(s => (
                  <button key={s.key} onMouseDown={() => { setSortBy(s.key); setSortOpen(false) }}
                          className={`w-full text-left px-4 py-2.5 text-[12px] transition-colors ${
                            sortBy === s.key
                              ? 'font-semibold text-[#0d1f35] bg-slate-50'
                              : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                          }`}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="divide-y divide-slate-100/60">
          {displayed.length === 0 ? (
            <div className="px-6 py-14 flex flex-col items-center gap-3">
              <span className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300">
                <Icon name="alerts" size={20} />
              </span>
              <p className="text-sm text-slate-400 italic">No activity yet. Alerts will appear as physicians review claims.</p>
            </div>
          ) : displayed.map((a) => {
            const m = FEED_META[a.action] || FEED_META.flagged
            const supId = a.supplierNpi || a.supplierId
            return (
              <div key={a.id} className={`group relative flex items-center gap-3.5 pl-5 pr-5 py-3.5 animate-fade-in-up transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm hover:z-10 ${m.rowHover}`}>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  {/* Names row */}
                  <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 leading-snug">
                    {a.npi
                      ? <span onClick={() => onOpenNpi?.({ npi: a.npi, name: a.physicianName })} className={nameCls}>{a.physicianName}</span>
                      : <span className="font-semibold text-sm text-slate-800">{a.physicianName}</span>}
                    <span className="text-slate-300 text-xs select-none">→</span>
                    {a.action === 'unknownPatient'
                      ? <span className="font-semibold text-sm text-slate-700">{a.patientName}</span>
                      : (supId
                          ? <span onClick={() => onOpenSupplier?.({ id: supId, name: a.supplierName })} className={nameCls}>{a.supplierName}</span>
                          : <span className="font-semibold text-sm text-slate-700">{a.supplierName}</span>)}
                    {a.escalation && <span className="ml-1 pill pill-critical">PHYSICIAN DENIAL</span>}
                  </div>
                  {/* Meta row: action badge + timestamp */}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-md ${m.badge}`}>
                      {m.verb}
                    </span>
                    <span className="text-slate-200 text-xs select-none">·</span>
                    <Icon name="clock" size={10} className="text-slate-400 shrink-0" />
                    <span className="text-[11px] text-slate-400 tabular-nums">{timeAgo(a.ts)}</span>
                  </div>
                </div>

                {/* Amount */}
                <div className="shrink-0 pr-2">
                  <div className="text-[15px] font-bold tabular-nums text-slate-800 text-right">{fmtUSD(a.amount, 2)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
