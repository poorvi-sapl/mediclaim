import { useState, useEffect } from 'react'
import { getSuppliers } from '../../api'
import TableSkeleton from '../../components/TableSkeleton'
import { Icon, RiskPill, fmtUSD, fmtDate } from '../../components/ui'

// Sortable columns (change 2). align right = numeric; hide = responsive breakpoint.
const COLUMNS = [
  { key: 'name', label: 'Supplier Name' },
  { key: 'oig', label: 'OIG Status' },
  { key: 'distinctNPIs', label: 'Distinct NPIs', align: 'right' },
  { key: 'physicianFlags', label: 'Flags', align: 'right' },
  { key: 'totalAmount', label: 'Total Claims', align: 'right', hide: 'md' },
  { key: 'risk', label: 'Risk Level' },
  { key: 'firstSeen', label: 'First Seen', hide: 'lg' },
]

const RISK_RANK = { Low: 1, Medium: 2, High: 3, Critical: 4 }
const parseDate = (d) => { const t = Date.parse(d); return Number.isNaN(t) ? 0 : t }

// Ascending comparators; descending = reverse. (OIG asc = non-OIG first.)
const COMPARATORS = {
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  oig: (a, b) => (a.oig ? 1 : 0) - (b.oig ? 1 : 0),
  distinctNPIs: (a, b) => a.distinctNPIs - b.distinctNPIs,
  physicianFlags: (a, b) => (a.physicianFlags || 0) - (b.physicianFlags || 0),
  totalAmount: (a, b) => a.totalAmount - b.totalAmount,
  risk: (a, b) => (RISK_RANK[a.risk] || 0) - (RISK_RANK[b.risk] || 0),
  firstSeen: (a, b) => parseDate(a.firstSeen) - parseDate(b.firstSeen),
}

const hideCls = (h) => (h === 'md' ? 'hidden md:table-cell' : h === 'lg' ? 'hidden lg:table-cell' : '')

export default function SupplierWatchlist({ onSelect, search = '' }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [oigOnly, setOigOnly] = useState(false)
  const [risk, setRisk] = useState('')
  const [sort, setSort] = useState({ key: null, dir: null })   // null = default order (risk score desc)

  useEffect(() => {
    let cancelled = false
    getSuppliers()
      .then((d) => { if (!cancelled) { setRows(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // Click cycle: unsorted → asc → desc → unsorted. A different column starts at asc.
  function onSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return { key: null, dir: null }
    })
  }

  if (loading) return <div className="max-w-screen-xl mx-auto px-7 py-7"><TableSkeleton rows={8} /></div>
  if (error) return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <div className="mc-card border-rose-200 bg-rose-50/50 px-6 py-5 text-sm">
        <span className="font-semibold text-rose-600">Couldn't load the watchlist:</span> <span className="text-slate-500">{error}</span>
      </div>
    </div>
  )

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
    sorted.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))   // default: risk score desc
  }

  return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <div className="mc-card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
            {[['all', 'All'], ['oig', 'OIG Flagged']].map(([id, label]) => {
              const active = (id === 'oig') === oigOnly
              return (
                <button key={id} onClick={() => setOigOnly(id === 'oig')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${active ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {label}
                </button>
              )
            })}
          </div>
          <select value={risk} onChange={(e) => setRisk(e.target.value)}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600 outline-none focus:border-ink">
            <option value="">Risk Level</option>
            {['Critical', 'High', 'Medium', 'Low'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="ml-auto text-xs text-slate-400 tabular-nums">{sorted.length} supplier{sorted.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                {COLUMNS.map((c) => {
                  const activeSort = sort.key === c.key
                  return (
                    <th key={c.key} onClick={() => onSort(c.key)}
                        className={`th group cursor-pointer select-none ${c.align === 'right' ? 'text-right' : ''} ${hideCls(c.hide)}`}>
                      <span className="inline-flex items-center gap-1 group-hover:text-[#1E3A5F] transition-colors">
                        {c.label}
                        {activeSort
                          ? <span className="text-[#1E3A5F]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                          : <span className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">↕</span>}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((s) => (
                <tr key={s.id} onClick={() => onSelect && onSelect(s)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                  <td className="td">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0">
                        <Icon name="suppliers" size={15} />
                      </div>
                      <span className="font-semibold text-slate-800">{s.name}</span>
                    </div>
                  </td>
                  <td className="td">
                    {s.oig
                      ? <span className="pill pill-critical"><Icon name="alertTri" size={11} stroke={2.5} />OIG FLAGGED</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right tabular-nums font-bold text-slate-800">{s.distinctNPIs} <span className="text-xs font-normal text-slate-400">NPIs</span></td>
                  <td className="td text-right tabular-nums">
                    {s.physicianFlags > 0 ? <span className="font-bold text-rose-500">{s.physicianFlags}</span> : <span className="text-slate-300">0</span>}
                  </td>
                  <td className="td text-right tabular-nums font-semibold text-slate-800 hidden md:table-cell">{fmtUSD(s.totalAmount)}</td>
                  <td className="td"><RiskPill band={s.risk} /></td>
                  <td className="td hidden lg:table-cell text-slate-500 tabular-nums">{fmtDate(s.firstSeen)}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={7} className="td text-center py-12 text-slate-400">No suppliers match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
