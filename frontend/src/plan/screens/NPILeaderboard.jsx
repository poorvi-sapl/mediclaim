import { useState, useEffect } from 'react'
import { getNpiRiskList } from '../../api'
import TableSkeleton from '../../components/TableSkeleton'
import { fmtUSD } from '../../components/ui'

const BANDS = [['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]

// Fraud patterns that actually exist in the rule_flags table (rule_name → label/abbrev).
// `meta` matches the RULE_META label carried on each row's rulesFired entries.
// Active rule-based patterns (value = backend rule_flags.rule_name). Note the geographic
// rule's real rule_name is 'geographic_anomaly' (not 'geo_anomaly').
const PATTERNS = [
  { key: 'oig_leie_hit', label: 'OIG LEIE Hit', meta: 'OIG Hit', abbrev: 'OIG' },
  { key: 'cross_npi_supplier', label: 'Cross-NPI Supplier', meta: 'Cross-NPI Supplier', abbrev: 'Cross' },
  { key: 'geographic_anomaly', label: 'Geographic Anomaly', meta: 'Geographic Anomaly', abbrev: 'Geo' },
  { key: 'volume_spike', label: 'Volume Spike', meta: 'Volume Spike', abbrev: 'Spike' },
  { key: 'duplicate_billing', label: 'Duplicate Billing', meta: 'Duplicate Billing', abbrev: 'Dup' },
  { key: 'unbundling', label: 'Unbundling', meta: 'Unbundling', abbrev: 'Unbdl' },
  { key: 'new_high_value_supplier', label: 'New High Value Supplier', meta: 'New High-Value Supplier', abbrev: 'New' },
  { key: 'impossible_day', label: 'Impossible Day', meta: 'Impossible Day', abbrev: 'ImpDay' },
  { key: 'rapid_cycling', label: 'Rapid Patient Cycling', meta: 'Rapid Patient Cycling', abbrev: 'Rapid' },
  { key: 'supplier_concentration', label: 'Supplier Concentration', meta: 'Supplier Concentration', abbrev: 'Conc' },
]
// Physician-reported actions (shown for completeness under a divider header).
const PHYSICIAN_REPORTED = [
  { key: 'physician_dispute', label: 'Physician Dispute' },
  { key: 'flagged_supplier', label: 'Flagged Supplier' },
  { key: 'unknown_patient', label: 'Unknown Patient' },
]
// RULE_META label → tiny chip abbreviation (covers every rollup flag a row may carry).
const ABBREV = {
  'OIG Hit': 'OIG', 'Cross-NPI Supplier': 'Cross', 'Geographic Anomaly': 'Geo',
  'Volume Spike': 'Spike', 'Duplicate Billing': 'Dup', 'New High-Value Supplier': 'New',
  'Unbundling': 'Unbdl', 'Patient Identity Reuse': 'ID', 'Abnormal Hospice Duration': 'Hospice', 'Upcoding': 'Upcode',
}

// Sortable columns. All sortable; default order is risk score desc.
const COLUMNS = [
  { key: 'name', label: 'Physician Name' },
  { key: 'specialty', label: 'Specialty', cls: 'hidden md:table-cell' },
  { key: 'state', label: 'State', cls: 'hidden sm:table-cell' },
  { key: 'score', label: 'Risk Score' },
  { key: 'claims', label: 'Claims', right: true },
  { key: 'amount', label: 'Amount', right: true, cls: 'hidden lg:table-cell' },
  { key: 'rules', label: 'Rules', right: true, cls: 'hidden lg:table-cell' },
  { key: 'flags', label: 'Flags', right: true },
  { key: 'topSupplier', label: 'Top Supplier', cls: 'hidden xl:table-cell' },
]
const COMPARATORS = {
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  specialty: (a, b) => (a.specialty || '').localeCompare(b.specialty || ''),
  state: (a, b) => (a.state || '').localeCompare(b.state || ''),
  score: (a, b) => (a.score || 0) - (b.score || 0),
  claims: (a, b) => (a.totalClaims || 0) - (b.totalClaims || 0),
  amount: (a, b) => (a.totalAmount || 0) - (b.totalAmount || 0),
  rules: (a, b) => (a.rulesFiredCount || 0) - (b.rulesFiredCount || 0),
  flags: (a, b) => (a.physicianFlags || 0) - (b.physicianFlags || 0),
  topSupplier: (a, b) => (a.topSupplier || '').localeCompare(b.topSupplier || ''),
}

function ScoreCell({ score }) {
  const color = score > 80 ? '#e11d48' : score > 60 ? '#ea580c' : score > 30 ? '#d97706' : '#059669'
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <span className="text-sm font-bold tabular-nums w-7" style={{ color }}>{score}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export default function NPILeaderboard({ setSelectedNPI, setActiveScreen, initialBand = 'all', search = '' }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [band, setBand] = useState(initialBand)
  const [specialty, setSpecialty] = useState('')
  const [state, setState] = useState('')
  const [pattern, setPattern] = useState('')   // fraud-pattern filter (rule_name) — server-side
  const [sort, setSort] = useState({ key: null, dir: null })   // null = default (risk score desc)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getNpiRiskList({ riskBand: band, patternFilter: pattern || undefined })
      .then((d) => { if (!cancelled) { setRows(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [band, pattern])

  // Sort resets whenever a filter (tab / specialty / state / search / pattern) changes.
  useEffect(() => { setSort({ key: null, dir: null }) }, [band, specialty, state, search, pattern])

  const selectedPattern = PATTERNS.find((p) => p.key === pattern) || PHYSICIAN_REPORTED.find((p) => p.key === pattern) || null

  function onSort(key) {
    setSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }

  if (loading) return <div className="max-w-screen-xl mx-auto px-7 py-7"><TableSkeleton rows={10} /></div>
  if (error) return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <div className="mc-card border-rose-200 bg-rose-50/50 px-6 py-5 text-sm">
        <span className="font-semibold text-rose-600">Couldn't load the leaderboard:</span> <span className="text-slate-500">{error}</span>
      </div>
    </div>
  )

  const specialties = [...new Set(rows.map((r) => r.specialty).filter(Boolean))].sort()
  const states = [...new Set(rows.map((r) => r.state).filter(Boolean))].sort()

  const filtered = rows.filter((r) => {
    if (specialty && r.specialty !== specialty) return false
    if (state && r.state !== state) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(r.name?.toLowerCase().includes(q) || r.npi?.includes(q))) return false
    }
    return true
  })
  const sorted = [...filtered]
  if (sort.key && COMPARATORS[sort.key]) {
    sorted.sort(COMPARATORS[sort.key])
    if (sort.dir === 'desc') sorted.reverse()
  } else {
    sorted.sort((a, b) => (b.score || 0) - (a.score || 0))   // default: risk score desc
  }

  return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <div className="mc-card overflow-hidden">
        {/* filter bar */}
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <select value={specialty} onChange={(e) => setSpecialty(e.target.value)}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 outline-none focus:border-ink">
            <option value="">All Specialties</option>
            {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 outline-none focus:border-ink">
            <option value="">State</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={pattern} onChange={(e) => setPattern(e.target.value)}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 outline-none focus:border-ink">
            <option value="" disabled>Fraud Pattern</option>
            {PATTERNS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option disabled>— Physician Reported —</option>
            {PHYSICIAN_REPORTED.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {selectedPattern && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ backgroundColor: '#DBEAFE', color: '#1E3A5F' }}>
              Pattern: {selectedPattern.label}
              <button onClick={() => setPattern('')} aria-label="Clear pattern filter" className="hover:text-rose-600 leading-none">✕</button>
            </span>
          )}
          <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
            {BANDS.map(([id, label]) => (
              <button key={id} onClick={() => setBand(id)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${band === id ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-slate-400 tabular-nums">{sorted.length} physician{sorted.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key
                  return (
                    <th key={c.key} onClick={() => onSort(c.key)}
                        className={`th cursor-pointer select-none group ${c.right ? 'text-right' : ''} ${c.cls || ''}`}>
                      <span className="inline-flex items-center gap-1 group-hover:text-[#1E3A5F] transition-colors">
                        {c.label}
                        {active
                          ? <span className="text-[#1E3A5F]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                          : <span className="text-[#D1D5DB] opacity-0 group-hover:opacity-100 transition-opacity">↕</span>}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => (
                <tr key={r.id} onClick={() => { setSelectedNPI(r); setActiveScreen('detail') }}
                    className="hover:bg-slate-50 cursor-pointer transition-colors">
                  <td className="td">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      {r.name}
                      {r.needsManualReview && (
                        <span title="Flagged for manual enrollment review"
                              className="inline-flex items-center text-amber-500 shrink-0" aria-label="Flagged for manual enrollment review">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 tabular-nums">{r.npi} · {r.city}, {r.state}</div>
                  </td>
                  <td className="td hidden md:table-cell text-slate-500">{r.specialty}</td>
                  <td className="td hidden sm:table-cell text-slate-500">{r.state}</td>
                  <td className="td"><ScoreCell score={r.score} /></td>
                  <td className="td text-right tabular-nums">{(r.totalClaims || 0).toLocaleString()}</td>
                  <td className="td text-right tabular-nums font-semibold text-slate-800 hidden lg:table-cell">{fmtUSD(r.totalAmount)}</td>
                  <td className="td text-right tabular-nums hidden lg:table-cell">
                    {pattern ? (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {r.rulesFired.length === 0
                          ? <span className="text-slate-300">—</span>
                          : r.rulesFired.map((rf) => {
                              const isFiltered = selectedPattern && rf.label === selectedPattern.meta
                              return (
                                <span key={rf.label} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                      style={{ backgroundColor: isFiltered ? '#DBEAFE' : '#EFF6FF', color: '#1E3A5F' }}>
                                  {ABBREV[rf.label] || rf.label}
                                </span>
                              )
                            })}
                      </div>
                    ) : r.rulesFiredCount}
                  </td>
                  <td className="td text-right tabular-nums">
                    {r.physicianFlags > 0 ? <span className="font-bold text-rose-500">{r.physicianFlags}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td hidden xl:table-cell text-slate-500 text-xs">{r.topSupplier}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={9} className="td text-center py-12 text-slate-400">No physicians match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
