import { useState, useEffect, useRef } from 'react'
import { getNpiRiskList } from '../../api'
import TableSkeleton from '../../components/TableSkeleton'
import { fmtUSD, Icon } from '../../components/ui'

const BANDS = [['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]

const PATTERNS = [
  { key: 'oig_leie_hit',           label: 'OIG LEIE Hit',            meta: 'OIG Hit',               abbrev: 'OIG'     },
  { key: 'cross_npi_supplier',     label: 'Cross-NPI Supplier',      meta: 'Cross-NPI Supplier',    abbrev: 'Cross'   },
  { key: 'geographic_anomaly',     label: 'Geographic Anomaly',      meta: 'Geographic Anomaly',    abbrev: 'Geo'     },
  { key: 'volume_spike',           label: 'Volume Spike',            meta: 'Volume Spike',          abbrev: 'Spike'   },
  { key: 'duplicate_billing',      label: 'Duplicate Billing',       meta: 'Duplicate Billing',     abbrev: 'Dup'     },
  { key: 'unbundling',             label: 'Unbundling',              meta: 'Unbundling',            abbrev: 'Unbdl'   },
  { key: 'new_high_value_supplier',label: 'New High Value Supplier', meta: 'New High-Value Supplier',abbrev: 'New'    },
  { key: 'impossible_day',         label: 'Impossible Day',          meta: 'Impossible Day',        abbrev: 'ImpDay'  },
  { key: 'rapid_cycling',          label: 'Rapid Patient Cycling',   meta: 'Rapid Patient Cycling', abbrev: 'Rapid'   },
  { key: 'supplier_concentration', label: 'Supplier Concentration',  meta: 'Supplier Concentration',abbrev: 'Conc'   },
]
const PHYSICIAN_REPORTED = [
  { key: 'physician_dispute', label: 'Physician Dispute' },
  { key: 'flagged_supplier',  label: 'Flagged Supplier'  },
  { key: 'unknown_patient',   label: 'Unknown Patient'   },
]
const ABBREV = {
  'OIG Hit': 'OIG', 'Cross-NPI Supplier': 'Cross', 'Geographic Anomaly': 'Geo',
  'Volume Spike': 'Spike', 'Duplicate Billing': 'Dup', 'New High-Value Supplier': 'New',
  'Unbundling': 'Unbdl', 'Patient Identity Reuse': 'ID', 'Abnormal Hospice Duration': 'Hospice', 'Upcoding': 'Upcode',
}

const COLUMNS = [
  { key: 'name',        label: 'Physician'   },
  { key: 'specialty',   label: 'Specialty',  cls: 'hidden md:table-cell' },
  { key: 'score',       label: 'Risk Score'  },
  { key: 'claims',      label: 'Claims',     right: true },
  { key: 'amount',      label: 'Billed',     right: true, cls: 'hidden lg:table-cell' },
  { key: 'rules',       label: 'Rules',      right: true, cls: 'hidden lg:table-cell' },
  { key: 'flags',       label: 'Flags',      right: true },
  { key: 'topSupplier', label: 'Top Supplier', cls: 'hidden xl:table-cell' },
]
const COMPARATORS = {
  name:        (a, b) => (a.name        || '').localeCompare(b.name        || ''),
  specialty:   (a, b) => (a.specialty   || '').localeCompare(b.specialty   || ''),
  score:       (a, b) => (a.score       || 0) - (b.score       || 0),
  claims:      (a, b) => (a.totalClaims || 0) - (b.totalClaims || 0),
  amount:      (a, b) => (a.totalAmount || 0) - (b.totalAmount || 0),
  rules:       (a, b) => (a.rulesFiredCount || 0) - (b.rulesFiredCount || 0),
  flags:       (a, b) => (a.physicianFlags  || 0) - (b.physicianFlags  || 0),
  topSupplier: (a, b) => (a.topSupplier || '').localeCompare(b.topSupplier || ''),
}

function CustomSelect({ value, onChange, placeholder, options, optionGroups }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch('') } }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const allOptions = optionGroups
    ? optionGroups.flatMap(g => g.options)
    : options

  const filtered = search.trim()
    ? allOptions.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    : null

  function pick(val) { onChange(val); setOpen(false); setSearch('') }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
              className={`flex items-center justify-between gap-2 bg-white border rounded-lg px-3 py-2 text-[12px] font-medium transition-all min-w-[148px] ${open ? 'border-[#0d1f35]/40 ring-2 ring-[#0d1f35]/10' : 'border-slate-200 hover:border-slate-300'} ${value ? 'text-slate-800' : 'text-slate-500'}`}>
        <span className="truncate">{value || placeholder}</span>
        <Icon name="chevronDown" size={12} stroke={2.5} className={`shrink-0 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl border border-slate-200 z-40 min-w-[200px] overflow-hidden"
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>

          {/* Search */}
          {allOptions.length > 5 && (
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Icon name="search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                       placeholder="Search…"
                       className="w-full pl-7 pr-3 py-1.5 text-[12px] bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-slate-300 focus:bg-white transition-colors" />
              </div>
            </div>
          )}

          <div className="max-h-56 overflow-y-auto py-1">
            {/* Clear / default option */}
            <button onMouseDown={() => pick('')}
                    className={`w-full text-left px-3.5 py-2 text-[12px] font-medium transition-colors flex items-center justify-between gap-3 ${!value ? 'text-[#0d1f35] bg-slate-50 font-semibold' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
              {placeholder}
              {!value && <span className="text-[#0d1f35] text-[11px]">✓</span>}
            </button>

            {/* Items */}
            {(filtered ?? (optionGroups ? [] : options)).map(opt => (
              <button key={opt} onMouseDown={() => pick(opt)}
                      className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 ${value === opt ? 'bg-slate-50 text-[#0d1f35] font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}>
                <span className="truncate">{opt}</span>
                {value === opt && <span className="text-[#0d1f35] shrink-0 text-[11px]">✓</span>}
              </button>
            ))}

            {/* Grouped items (Fraud Pattern) */}
            {!filtered && optionGroups && optionGroups.map(g => (
              <div key={g.label}>
                <div className="px-3.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{g.label}</div>
                {g.options.map(opt => (
                  <button key={opt.key ?? opt} onMouseDown={() => pick(opt.key ?? opt)}
                          className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 ${value === (opt.key ?? opt) ? 'bg-slate-50 text-[#0d1f35] font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}>
                    <span className="truncate">{opt.label ?? opt}</span>
                    {value === (opt.key ?? opt) && <span className="text-[#0d1f35] shrink-0 text-[11px]">✓</span>}
                  </button>
                ))}
              </div>
            ))}

            {filtered?.length === 0 && (
              <div className="px-3.5 py-4 text-[12px] text-slate-400 text-center">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function scoreStyle(score) {
  if (score > 80) return { color: '#e11d48', track: '#ffe4e6' }
  if (score > 60) return { color: '#ea580c', track: '#ffedd5' }
  if (score > 30) return { color: '#d97706', track: '#fef3c7' }
  return              { color: '#059669', track: '#d1fae5' }
}

function ScoreCell({ score }) {
  const { color, track } = scoreStyle(score)
  return (
    <div className="flex items-center gap-2.5 min-w-[120px]">
      <span className="text-[13px] font-bold tabular-nums w-7 shrink-0" style={{ color }}>{score}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: track }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function RankBadge({ rank }) {
  if (rank === 1) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">1</span>
  )
  if (rank === 2) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500">2</span>
  )
  if (rank === 3) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-orange-100 text-orange-600">3</span>
  )
  return <span className="text-[12px] font-medium text-slate-400 tabular-nums">{rank}</span>
}

function exportCSV(filename, headers, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename })
  a.click(); URL.revokeObjectURL(a.href)
}

const SEL = "bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-600 outline-none cursor-pointer transition-colors hover:border-slate-300 focus:border-[#0d1f35] focus:ring-2 focus:ring-[#0d1f35]/10 pr-8"

export default function NPILeaderboard({ setSelectedNPI, setActiveScreen, initialBand = 'all', search = '' }) {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [band, setBand]         = useState(initialBand)
  const [specialty, setSpecialty] = useState('')
  const [state, setState]       = useState('')
  const [pattern, setPattern]   = useState('')
  const [sort, setSort]         = useState({ key: null, dir: null })
  const [visibleCount, setVisibleCount] = useState(15)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getNpiRiskList({ riskBand: band, patternFilter: pattern || undefined })
      .then((d) => { if (!cancelled) { setRows(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [band, pattern])

  useEffect(() => { setSort({ key: null, dir: null }); setVisibleCount(15) }, [band, specialty, state, search, pattern])

  const selectedPattern = PATTERNS.find((p) => p.key === pattern)
    || PHYSICIAN_REPORTED.find((p) => p.key === pattern)
    || null

  function onSort(key) {
    setSort((p) =>
      p.key !== key ? { key, dir: 'asc' }
      : p.dir === 'asc' ? { key, dir: 'desc' }
      : { key: null, dir: null }
    )
  }

  if (loading) return <div className="w-full px-4 sm:px-7 py-5 sm:py-6"><TableSkeleton rows={10} /></div>
  if (error) return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-6">
      <div className="mc-card border-rose-200 bg-rose-50/50 px-6 py-5 text-sm">
        <span className="font-semibold text-rose-600">Couldn't load the leaderboard:</span>{' '}
        <span className="text-slate-500">{error}</span>
      </div>
    </div>
  )

  const specialties = [...new Set(rows.map((r) => r.specialty).filter(Boolean))].sort()
  const states      = [...new Set(rows.map((r) => r.state).filter(Boolean))].sort()

  const filtered = rows.filter((r) => {
    if (specialty && r.specialty !== specialty) return false
    if (state     && r.state     !== state)     return false
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
    sorted.sort((a, b) => (b.score || 0) - (a.score || 0))
  }

  return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-6 space-y-5">

      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-display text-xl font-bold text-slate-900 tracking-tight">NPI Risk Leaderboard</h2>
          <p className="text-sm text-slate-400 mt-0.5">Physicians ranked by composite fraud risk score</p>
        </div>
        <span className="text-[12px] font-semibold text-slate-400 bg-white border border-slate-200 px-3 py-1.5 rounded-lg tabular-nums shrink-0">
          {rows.length.toLocaleString()} physicians
        </span>
      </div>

      <div className="mc-card">

        {/* Filter bar */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex flex-wrap items-center gap-2 sm:gap-3 bg-white">

          {/* Risk band segmented control */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">
            {BANDS.map(([id, label]) => (
              <button key={id} onClick={() => setBand(id)}
                      className={`px-4 py-1.5 text-[12px] font-semibold rounded-lg transition-all duration-150 ${
                        band === id
                          ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/60'
                          : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                      }`}>
                {label}
              </button>
            ))}
          </div>

          <div className="hidden sm:block w-px h-6 bg-slate-200 mx-1 shrink-0" />

          {/* Dropdowns */}
          <CustomSelect value={specialty} onChange={setSpecialty} placeholder="All Specialties" options={specialties} />
          <CustomSelect value={state}     onChange={setState}     placeholder="All States"      options={states} />
          <CustomSelect
            value={pattern} onChange={setPattern} placeholder="Fraud Pattern"
            optionGroups={[
              { label: 'Algorithmic Patterns', options: PATTERNS.map(p => ({ key: p.key, label: p.label })) },
              { label: 'Physician Reported',   options: PHYSICIAN_REPORTED.map(p => ({ key: p.key, label: p.label })) },
            ]}
            options={[]}
          />

          {selectedPattern && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              {selectedPattern.label}
              <button onClick={() => setPattern('')} aria-label="Clear pattern filter"
                      className="hover:text-rose-500 transition-colors leading-none text-blue-400">✕</button>
            </span>
          )}

          {/* Result count + export */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] font-semibold text-slate-800 tabular-nums">{sorted.length.toLocaleString()}</span>
            <span className="text-[12px] text-slate-400">result{sorted.length !== 1 ? 's' : ''}</span>
            <button onClick={() => exportCSV('npi-leaderboard.csv',
                ['Rank', 'Physician', 'NPI', 'City', 'State', 'Specialty', 'Risk Score', 'Claims', 'Billed', 'Rules Fired', 'Flags', 'Top Supplier'],
                sorted.map((r, i) => [i + 1, r.name, r.npi, r.city, r.state, r.specialty, r.score, r.totalClaims, r.totalAmount, r.rulesFiredCount, r.physicianFlags, r.topSupplier]))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E3A5F]/20 bg-white text-[#1E3A5F] text-[12px] font-semibold hover:bg-[#EEF2F7] transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-y border-slate-100" style={{ backgroundColor: '#f8fafc' }}>
                <th className="w-14 px-5 py-3.5 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">#</th>
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key
                  return (
                    <th key={c.key} onClick={() => onSort(c.key)}
                        className={`px-4 py-3.5 text-[10px] font-bold uppercase tracking-widest cursor-pointer select-none group transition-colors ${active ? 'text-[#0d1f35]' : 'text-slate-700 hover:text-[#0d1f35]'} ${c.right ? 'text-right' : 'text-left'} ${c.cls || ''}`}>
                      <span className={`inline-flex items-center gap-1 ${c.right ? 'justify-end' : ''}`}>
                        {c.label}
                        <span className={`transition-colors text-[10px] ${active ? 'text-[#0d1f35]' : 'text-slate-400 group-hover:text-[#0d1f35]'}`}>
                          {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100/80">
              {sorted.slice(0, visibleCount).map((r, idx) => (
                <tr key={r.id}
                    onClick={() => { setSelectedNPI(r); setActiveScreen('detail') }}
                    className="hover:bg-[#f8fafc] cursor-pointer transition-colors group">

                  {/* Rank */}
                  <td className="w-14 px-5 py-4 text-center">
                    <RankBadge rank={idx + 1} />
                  </td>

                  {/* Physician name + NPI */}
                  <td className="px-4 py-4">
                    <div className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5 group-hover:text-[#0d1f35] transition-colors leading-tight">
                      {r.name}
                      {r.needsManualReview && (
                        <span title="Flagged for manual enrollment review" className="text-amber-400 shrink-0">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">{r.npi} · {r.city}, {r.state}</div>
                  </td>

                  {/* Specialty */}
                  <td className="px-4 py-4 hidden md:table-cell text-[12px] text-slate-500">{r.specialty || '—'}</td>

                  {/* Risk score */}
                  <td className="px-4 py-4"><ScoreCell score={r.score} /></td>

                  {/* Claims */}
                  <td className="px-4 py-4 text-right tabular-nums text-[13px] text-slate-600">
                    {(r.totalClaims || 0).toLocaleString()}
                  </td>

                  {/* Billed amount */}
                  <td className="px-4 py-4 text-right tabular-nums text-[13px] font-semibold text-slate-800 hidden lg:table-cell">
                    {fmtUSD(r.totalAmount)}
                  </td>

                  {/* Rules fired */}
                  <td className="px-4 py-4 text-right tabular-nums hidden lg:table-cell">
                    {pattern ? (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {r.rulesFired.length === 0
                          ? <span className="text-slate-300">—</span>
                          : r.rulesFired.map((rf) => {
                              const highlighted = selectedPattern && rf.label === selectedPattern.meta
                              return (
                                <span key={rf.label} className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                                      style={{ backgroundColor: highlighted ? '#DBEAFE' : '#F1F5F9', color: highlighted ? '#1E40AF' : '#64748B' }}>
                                  {ABBREV[rf.label] || rf.label}
                                </span>
                              )
                            })}
                      </div>
                    ) : (
                      <span className={`text-[13px] ${r.rulesFiredCount > 0 ? 'text-slate-700 font-medium' : 'text-slate-300'}`}>
                        {r.rulesFiredCount || '—'}
                      </span>
                    )}
                  </td>

                  {/* Physician flags */}
                  <td className="px-4 py-4 text-right tabular-nums">
                    {r.physicianFlags > 0
                      ? <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-500 ring-1 ring-inset ring-rose-200">
                          {r.physicianFlags}
                        </span>
                      : <span className="text-slate-300">—</span>}
                  </td>

                  {/* Top supplier */}
                  <td className="px-4 py-4 hidden xl:table-cell text-[12px] text-slate-400">{r.topSupplier || '—'}</td>
                </tr>
              ))}

              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center">
                    <p className="text-sm text-slate-400">No physicians match these filters.</p>
                    <p className="text-xs text-slate-300 mt-1">Try adjusting your search or filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Show more / pagination footer */}
        {sorted.length > visibleCount && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-4 bg-white">
            <span className="text-[12px] text-slate-400">
              Showing <span className="font-semibold text-slate-600">{visibleCount}</span> of <span className="font-semibold text-slate-600">{sorted.length}</span> physicians
            </span>
            <button
              onClick={() => setVisibleCount(v => Math.min(v + 15, sorted.length))}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-[#0d1f35] bg-slate-100 hover:bg-slate-200 transition-colors">
              Show next {Math.min(15, sorted.length - visibleCount)}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
        )}

        {/* All shown indicator */}
        {sorted.length > 0 && visibleCount >= sorted.length && sorted.length > 15 && (
          <div className="px-6 py-3.5 border-t border-slate-100 flex items-center justify-between bg-white">
            <span className="text-[12px] text-slate-400">All <span className="font-semibold text-slate-600">{sorted.length}</span> physicians shown</span>
            <button onClick={() => setVisibleCount(15)} className="text-[12px] font-medium text-slate-400 hover:text-slate-600 transition-colors">
              Collapse ↑
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
