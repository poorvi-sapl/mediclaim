import { useState, useEffect, useRef } from 'react'
import { getSuppliers } from '../../api'
import TableSkeleton from '../../components/TableSkeleton'
import { Icon, RiskPill, fmtUSD, fmtDate } from '../../components/ui'

function CustomSelect({ value, onChange, placeholder, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  function pick(val) { onChange(val); setOpen(false) }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
              className={`flex items-center justify-between gap-2 bg-white border rounded-lg px-3 py-2 text-[12px] font-medium transition-all min-w-[132px] ${open ? 'border-[#0d1f35]/40 ring-2 ring-[#0d1f35]/10' : 'border-slate-200 hover:border-slate-300'} ${value ? 'text-slate-800' : 'text-slate-500'}`}>
        <span className="truncate">{value || placeholder}</span>
        <Icon name="chevronDown" size={12} stroke={2.5} className={`shrink-0 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl border border-slate-200 z-40 min-w-[160px] overflow-hidden"
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>
          <div className="py-1">
            <button onMouseDown={() => pick('')}
                    className={`w-full text-left px-3.5 py-2 text-[12px] font-medium transition-colors flex items-center justify-between gap-3 ${!value ? 'text-[#0d1f35] bg-slate-50 font-semibold' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
              {placeholder}
              {!value && <span className="text-[#0d1f35] text-[11px]">✓</span>}
            </button>
            {options.map(opt => (
              <button key={opt} onMouseDown={() => pick(opt)}
                      className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 ${value === opt ? 'bg-slate-50 text-[#0d1f35] font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}>
                <span className="truncate">{opt}</span>
                {value === opt && <span className="text-[#0d1f35] shrink-0 text-[11px]">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function exportCSV(filename, headers, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename })
  a.click(); URL.revokeObjectURL(a.href)
}

const COLUMNS = [
  { key: 'name',          label: 'Supplier Name' },
  { key: 'oig',           label: 'OIG Status',    hide: 'sm' },
  { key: 'distinctNPIs',  label: 'Distinct NPIs', align: 'right', hide: 'sm' },
  { key: 'physicianFlags',label: 'Flags',          align: 'right', hide: 'md' },
  { key: 'totalAmount',   label: 'Total Billed',   align: 'right', hide: 'md' },
  { key: 'risk',          label: 'Risk Level' },
  { key: 'firstSeen',     label: 'First Seen',     hide: 'lg' },
]

const RISK_RANK  = { Low: 1, Medium: 2, High: 3, Critical: 4 }
const parseDate  = (d) => { const t = Date.parse(d); return Number.isNaN(t) ? 0 : t }
const hideCls    = (h) => h === 'sm' ? 'hidden sm:table-cell' : h === 'md' ? 'hidden md:table-cell' : h === 'lg' ? 'hidden lg:table-cell' : ''

const COMPARATORS = {
  name:           (a, b) => (a.name || '').localeCompare(b.name || ''),
  oig:            (a, b) => (a.oig ? 1 : 0) - (b.oig ? 1 : 0),
  distinctNPIs:   (a, b) => a.distinctNPIs - b.distinctNPIs,
  physicianFlags: (a, b) => (a.physicianFlags || 0) - (b.physicianFlags || 0),
  totalAmount:    (a, b) => a.totalAmount - b.totalAmount,
  risk:           (a, b) => (RISK_RANK[a.risk] || 0) - (RISK_RANK[b.risk] || 0),
  firstSeen:      (a, b) => parseDate(a.firstSeen) - parseDate(b.firstSeen),
}

function StatTile({ icon, label, value, accent, loading }) {
  const styles = {
    slate:  { icon: 'bg-slate-100 text-slate-500',    num: 'text-slate-900'    },
    rose:   { icon: 'bg-rose-50 text-rose-500',       num: 'text-rose-600'     },
    amber:  { icon: 'bg-amber-50 text-amber-500',     num: 'text-amber-600'    },
    emerald:{ icon: 'bg-emerald-50 text-emerald-600', num: 'text-emerald-700'  },
  }
  const s = styles[accent] || styles.slate
  return (
    <div className="mc-card px-5 py-4 flex flex-col gap-3 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-6px_rgba(15,23,42,0.10)] hover:border-slate-200 transition-all duration-200">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none pt-0.5">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${s.icon}`}>
          <Icon name={icon} size={13} />
        </div>
      </div>
      {loading
        ? <div className="h-7 w-20 rounded-lg bg-slate-100 animate-pulse" />
        : <div className={`text-[1.6rem] font-bold tabular-nums leading-none tracking-tight ${s.num}`}>{value}</div>}
    </div>
  )
}

export default function SupplierWatchlist({ onSelect, search = '' }) {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [oigOnly, setOigOnly] = useState(false)
  const [risk, setRisk]     = useState('')
  const [sort, setSort]     = useState({ key: null, dir: null })
  const [visibleCount, setVisibleCount] = useState(15)

  useEffect(() => {
    let cancelled = false
    getSuppliers()
      .then((d) => { if (!cancelled) { setRows(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { setVisibleCount(15) }, [oigOnly, risk, search, sort.key, sort.dir])

  function onSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return { key: null, dir: null }
    })
  }

  // Summary stats (computed from full dataset, not filtered view)
  const oigCount          = rows.filter((s) => s.oig).length
  const critHighCount     = rows.filter((s) => s.risk === 'Critical' || s.risk === 'High').length
  const totalBilled       = rows.reduce((sum, s) => sum + (s.totalAmount || 0), 0)

  const visible = rows.filter((s) => {
    if (oigOnly && !s.oig) return false
    if (risk && s.risk !== risk) return false
    if (search && !(s.name || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const sorted = [...visible]
  if (sort.key && COMPARATORS[sort.key]) {
    sorted.sort(COMPARATORS[sort.key])
    if (sort.dir === 'desc') sorted.reverse()
  } else {
    sorted.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))
  }

  if (error) return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-7">
      <div className="mc-card border-rose-200 bg-rose-50/50 px-6 py-5 text-sm">
        <span className="font-semibold text-rose-600">Couldn't load the watchlist:</span>{' '}
        <span className="text-slate-500">{error}</span>
      </div>
    </div>
  )

  return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-7 space-y-6">

      {/* ── Page header ── */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-[#1E3A5F] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
          <Icon name="suppliers" size={20} />
        </div>
        <div>
          <h1 className="text-display text-xl font-bold text-slate-900 leading-tight">Supplier Watchlist</h1>
          <p className="text-sm text-slate-400 mt-0.5">Monitor flagged and high-risk suppliers across your claims network</p>
        </div>
      </div>

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile icon="suppliers"  label="Total Suppliers"   value={rows.length.toLocaleString()} accent="slate"   loading={loading} />
        <StatTile icon="alertTri"   label="OIG Flagged"       value={oigCount.toLocaleString()}    accent="rose"    loading={loading} />
        <StatTile icon="flag"       label="Critical / High"   value={critHighCount.toLocaleString()} accent="amber" loading={loading} />
        <StatTile icon="doc"        label="Total Billed"      value={fmtUSD(totalBilled)}          accent="emerald" loading={loading} />
      </div>

      {/* ── Main table card ── */}
      <div className="mc-card">

        {/* Filter bar */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex flex-wrap items-center gap-2 sm:gap-3 bg-white">
          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">
            {[['all', 'All'], ['oig', 'OIG Flagged']].map(([id, label]) => {
              const active = (id === 'oig') === oigOnly
              return (
                <button key={id} onClick={() => setOigOnly(id === 'oig')}
                        className={`px-4 py-1.5 text-[12px] font-semibold rounded-lg transition-all duration-150 ${active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/60' : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'}`}>
                  {label}
                </button>
              )
            })}
          </div>

          <div className="hidden sm:block w-px h-6 bg-slate-200 mx-1 shrink-0" />

          <CustomSelect value={risk} onChange={setRisk} placeholder="Risk Level" options={['Critical', 'High', 'Medium', 'Low']} />

          <div className="ml-auto flex items-center gap-2">
            {(oigOnly || risk || search) && (
              <button onClick={() => { setOigOnly(false); setRisk('') }}
                      className="text-[11px] font-semibold text-[#1E3A5F] hover:underline">
                Clear filters
              </button>
            )}
            <span className="text-[12px] font-semibold text-slate-800 tabular-nums">
              {sorted.length.toLocaleString()}
            </span>
            <span className="text-[12px] text-slate-400">supplier{sorted.length !== 1 ? 's' : ''}</span>
            <button onClick={() => exportCSV('supplier-watchlist.csv',
                ['Supplier Name', 'OIG Status', 'Distinct NPIs', 'Flags', 'Total Billed', 'Risk Level', 'First Seen'],
                sorted.map(s => [s.name, s.oig ? 'OIG Flagged' : 'Clean', s.distinctNPIs, s.physicianFlags || 0, s.totalAmount, s.risk, fmtDate(s.firstSeen)]))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E3A5F]/20 bg-white text-[#1E3A5F] text-[12px] font-semibold hover:bg-[#EEF2F7] transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="px-5 py-5"><TableSkeleton rows={8} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-200 bg-[#F0F4F8]">
                  {COLUMNS.map((c) => {
                    const activeSort = sort.key === c.key
                    return (
                      <th key={c.key} onClick={() => onSort(c.key)}
                          className={`th group cursor-pointer select-none ${c.align === 'right' ? 'text-right' : ''} ${hideCls(c.hide)}`}>
                        <span className="inline-flex items-center gap-1 font-bold text-slate-700 group-hover:text-[#1E3A5F] transition-colors">
                          {c.label}
                          {activeSort
                            ? <span className="text-[#1E3A5F] font-bold">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                            : <span className="text-slate-400 group-hover:text-[#1E3A5F] transition-colors">↕</span>}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.slice(0, visibleCount).map((s) => (
                  <tr key={s.id} onClick={() => onSelect?.(s)}
                      className="group hover:bg-[#F5F8FC] transition-colors duration-100 cursor-pointer">

                    {/* Supplier name */}
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#EEF2F7] text-[#1E3A5F]/60 flex items-center justify-center flex-shrink-0">
                          <Icon name="suppliers" size={14} />
                        </div>
                        <span className="font-semibold text-slate-800 group-hover:text-[#1E3A5F] transition-colors leading-snug">
                          {s.name}
                        </span>
                      </div>
                    </td>

                    {/* OIG status */}
                    <td className="td hidden sm:table-cell">
                      {s.oig
                        ? <span className="pill pill-critical"><Icon name="alertTri" size={10} stroke={2.5} />OIG FLAGGED</span>
                        : <span className="text-slate-300 text-sm">—</span>}
                    </td>

                    {/* Distinct NPIs */}
                    <td className="td text-right hidden sm:table-cell">
                      <span className="font-bold text-slate-800 tabular-nums">{s.distinctNPIs}</span>
                      <span className="text-[11px] font-normal text-slate-400 ml-1">NPIs</span>
                    </td>

                    {/* Flags */}
                    <td className="td text-right hidden md:table-cell">
                      {s.physicianFlags > 0
                        ? <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-rose-50 text-rose-600 font-bold text-xs ring-1 ring-rose-200 tabular-nums">
                            {s.physicianFlags}
                          </span>
                        : <span className="text-slate-300 text-sm">—</span>}
                    </td>

                    {/* Total billed */}
                    <td className="td text-right tabular-nums font-semibold text-slate-800 hidden md:table-cell">
                      {fmtUSD(s.totalAmount)}
                    </td>

                    {/* Risk level */}
                    <td className="td">
                      <RiskPill band={s.risk} />
                    </td>

                    {/* First seen */}
                    <td className="td hidden lg:table-cell text-slate-500 tabular-nums text-sm">
                      {fmtDate(s.firstSeen)}
                    </td>
                  </tr>
                ))}

                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <Icon name="search" size={28} stroke={1.5} className="text-slate-300" />
                        <span className="text-sm font-medium">No suppliers match these filters</span>
                        <button onClick={() => { setOigOnly(false); setRisk('') }}
                                className="text-xs font-semibold text-[#1E3A5F] hover:underline mt-1">
                          Clear filters
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Show more footer */}
        {!loading && sorted.length > visibleCount && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-4 bg-white">
            <span className="text-[12px] text-slate-400">
              Showing <span className="font-semibold text-slate-600">{visibleCount}</span> of <span className="font-semibold text-slate-600">{sorted.length}</span> suppliers
            </span>
            <button onClick={() => setVisibleCount((v) => Math.min(v + 15, sorted.length))}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-[#0d1f35] bg-slate-100 hover:bg-slate-200 transition-colors">
              Show next {Math.min(15, sorted.length - visibleCount)}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
        )}

        {/* All shown indicator */}
        {!loading && sorted.length > 0 && visibleCount >= sorted.length && sorted.length > 15 && (
          <div className="px-6 py-3.5 border-t border-slate-100 flex items-center justify-between bg-white">
            <span className="text-[12px] text-slate-400">All <span className="font-semibold text-slate-600">{sorted.length}</span> suppliers shown</span>
            <button onClick={() => setVisibleCount(15)} className="text-[12px] font-medium text-slate-400 hover:text-slate-600 transition-colors">
              Collapse ↑
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
