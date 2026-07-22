import { useState, useEffect, useRef } from 'react'
import { useAlerts } from '../../context/AlertsContext'
import { getAlertsHistory } from '../../api'
import { Icon, fmtUSD, timeAgo } from '../../components/ui'

const META = {
  flagged:         { icon: 'flag',     chip: 'bg-[#FBF3E4] text-[#D1A85C]',  verb: 'flagged' },
  unknownPatient:  { icon: 'userx',    chip: 'bg-[#F7EBEA] text-[#A6453F]',  verb: 'reported unknown patient' },
  deceasedPatient: { icon: 'heartOff', chip: 'bg-[#F2EEF7] text-[#7A6899]',  verb: 'reported deceased patient billed by' },
  deniedOrder:     { icon: 'ban',      chip: 'bg-[#F7EBEA] text-[#8A423D]',  verb: 'denied ordering from' },
}
const TYPE_LABEL = { flagged: 'Flag Vendor', unknownPatient: 'Unknown Patient', deceasedPatient: 'Deceased Patient', deniedOrder: 'Did Not Order' }

const TYPE_OPTIONS = [
  { key: 'flagged', label: 'Flag Vendor' },
  { key: 'unknownPatient', label: 'Unknown Patient' },
  { key: 'deceasedPatient', label: 'Deceased Patient' },
  { key: 'deniedOrder', label: 'Did Not Order' },
]
const DEFAULT_SETTINGS = { types: { flagged: true, unknownPatient: true, deceasedPatient: true, deniedOrder: true }, minAmount: 0 }
const STORE_KEY = 'medclaim_alert_settings'

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY))
    return { types: { ...DEFAULT_SETTINGS.types, ...(s?.types || {}) }, minAmount: s?.minAmount || 0 }
  } catch { return { ...DEFAULT_SETTINGS } }
}

export default function LiveAlerts() {
  const { alerts, addAlert } = useAlerts()
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState(loadSettings)
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    getAlertsHistory(50).then(({ items }) => {
      [...items].reverse().forEach(addAlert)
    }).catch(() => {})
  }, [addAlert])

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
  }, [settings])

  function toggleType(key) { setSettings((s) => ({ ...s, types: { ...s.types, [key]: !s.types[key] } })) }
  function resetSettings() { setSettings({ ...DEFAULT_SETTINGS }) }

  const sorted = [...alerts].sort((a, b) => new Date(b.ts) - new Date(a.ts))
  const visible = sorted.filter((a) => {
    if (settings.types[a.action] === false) return false
    if (settings.minAmount && Number(a.amount) < Number(settings.minAmount)) return false
    return true
  })
  const hidden = sorted.length - visible.length
  const filtersActive = settings.minAmount > 0 || Object.values(settings.types).some((v) => !v)

  return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-900">Live Alerts</h2>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#E9F3ED] ring-1 ring-[#D5E9DD] text-[11px] font-bold text-[#2E6B4F]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3A7D5C] live-dot" /> LIVE
          </span>
        </div>
        <div className="relative">
          <button onClick={() => setShowSettings((v) => !v)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${filtersActive ? 'border-[#0A1F3D] text-[#0A1F3D] bg-[#0A1F3D]/5' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <Icon name="alerts" size={13} /> Alert Settings
            {filtersActive && <span className="w-1.5 h-1.5 rounded-full bg-[#0A1F3D]" />}
          </button>

          {showSettings && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowSettings(false)} />
              <div className="absolute right-0 mt-2 w-72 mc-card p-4 z-40 animate-fade-in-up">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900">Alert Settings</h3>
                  <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-700"><Icon name="x" size={15} /></button>
                </div>
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Show alert types</div>
                <div className="space-y-1.5 mb-4">
                  {TYPE_OPTIONS.map((t) => (
                    <label key={t.key} className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input type="checkbox" checked={settings.types[t.key] !== false} onChange={() => toggleType(t.key)}
                             className="w-4 h-4 rounded border-slate-300 text-[#0A1F3D] focus:ring-[#0A1F3D]/30" />
                      <span className="text-sm text-slate-600">{t.label}</span>
                    </label>
                  ))}
                </div>
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Minimum claim amount</div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input type="number" min="0" step="100" value={settings.minAmount}
                         onChange={(e) => setSettings((s) => ({ ...s, minAmount: Math.max(0, Number(e.target.value) || 0) }))}
                         className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 outline-none focus:border-[#0A1F3D] focus:ring-2 focus:ring-[#0A1F3D]/15" />
                </div>
                <button onClick={resetSettings} className="mt-4 w-full py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  Reset to defaults
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mc-card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-100 text-xs font-medium text-[#0A1F3D] flex items-center gap-2">
          <Icon name="bolt" size={13} /> New physician flags appear here automatically — updates instantly.
          {filtersActive && <span className="ml-auto text-slate-400 font-normal">{hidden} hidden by filters</span>}
        </div>
        <div className="divide-y divide-slate-100">
          {visible.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-400">
              {sorted.length === 0 ? 'No alerts yet. Physician flags will appear here in real time.' : 'No alerts match your current filters.'}
            </div>
          ) : visible.map((a) => {
            const m = META[a.action] || META.flagged
            return (
              <div key={a.id} className="px-6 py-4 flex items-center gap-4 animate-fade-in-up">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${m.chip}`}>
                  <Icon name={m.icon} size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800">
                    {TYPE_LABEL[a.action] || a.action}
                    {a.escalation && <span className="ml-2 pill pill-critical">PHYSICIAN DENIAL</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    {a.physicianName} {m.verb} <span className="font-medium text-slate-700">{a.supplierName}</span>
                    {a.patientName ? ` · ${a.patientName}` : ''} · {fmtUSD(a.amount, 2)} · {timeAgo(a.ts)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
