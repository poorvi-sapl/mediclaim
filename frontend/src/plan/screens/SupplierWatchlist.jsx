import { useState, useEffect, useRef } from 'react'
import { getSuppliers } from '../../api'
import TableSkeleton from '../../components/TableSkeleton'
import { Icon, RiskPill, fmtUSD, fmtDate } from '../../components/ui'
import { KpiCard } from '../../components/ui/kpi-card'
import { RISK_BANDS, RISK_FILTER_OPTIONS, bandByName } from '../../lib/risk'

// Table columns — Supplier / Risk / NPIs / First seen / Billed (OIG status and
// Flags are folded into the supplier sub-line instead of their own columns).
const COLUMNS = [
  { key: 'name',         label: 'Vendor' },
  { key: 'risk',         label: 'Risk' },
  { key: 'distinctNPIs', label: 'NPIs',       align: 'right', hide: 'sm' },
  { key: 'firstSeen',    label: 'First seen', hide: 'md' },
  { key: 'totalAmount',  label: 'Billed',     align: 'right' },
]

const RISK_RANK = Object.fromEntries(RISK_BANDS.map((b) => [b.label, b.rank]))
const parseDate = (d) => { const t = Date.parse(d); return Number.isNaN(t) ? 0 : t }
const hideCls   = (h) => h === 'sm' ? 'hidden sm:table-cell' : h === 'md' ? 'hidden md:table-cell' : h === 'lg' ? 'hidden lg:table-cell' : ''

const OIG_FILTER_OPTIONS = [
  { id: '',        label: 'All vendors' },
  { id: 'flagged', label: 'OIG Flagged' },
  { id: 'clean',   label: 'Clean' },
]

// Risk column header — click opens a dropdown to filter by risk band, instead
// of the plain sort-toggle the other columns use.
function FilterTh({ label, options, value, onChange, hide, align }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = !!value

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <th ref={ref}
        className={`text-left py-2.5 px-3.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-body)] bg-[var(--color-bg-soft)] border-b border-[var(--color-bg-soft)] whitespace-nowrap relative ${align === 'right' ? 'text-right' : ''} ${hideCls(hide)}`}>
      <button onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 cursor-pointer"
              style={{ color: open || active ? 'var(--color-primary)' : 'inherit', font: 'inherit' }}>
        {label}
        <Icon name="chevronDown" size={10} className={open || active ? 'text-[var(--color-primary)]' : 'text-slate-300'}
              style={{ transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl border border-slate-200 z-40 min-w-[160px] overflow-hidden normal-case"
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>
          <div className="py-1">
            {options.map((opt) => (
              <button key={opt.id} onMouseDown={() => { onChange(opt.id); setOpen(false) }}
                      className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 ${value === opt.id ? 'bg-slate-50 text-[var(--color-primary)] font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}>
                <span className="truncate">{opt.label}</span>
                {value === opt.id && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </th>
  )
}

// "Filters" button in the head row — OIG status only (Risk stays filterable via
// its own column header, same as before).
function HeadFilterButton({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = !!value

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[9px] border text-[12.5px] font-semibold transition-colors ${active ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-bg-soft)]' : 'border-[var(--color-border-strong)] text-[#46586F] bg-white hover:border-[var(--color-text-muted)]'}`}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filters
        {active && <span className="w-[7px] h-[7px] rounded-full bg-[var(--color-primary)]" />}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 bg-white rounded-xl border border-slate-200 z-40 min-w-[190px] overflow-hidden"
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>
          <div className="px-3.5 py-2.5 border-b border-slate-100 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">OIG status</div>
          <div className="py-1">
            {OIG_FILTER_OPTIONS.map((opt) => (
              <button key={opt.id} onMouseDown={() => { onChange(opt.id); setOpen(false) }}
                      className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 ${value === opt.id ? 'bg-slate-50 text-[var(--color-primary)] font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}>
                <span className="truncate">{opt.label}</span>
                {value === opt.id && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const COMPARATORS = {
  name:          (a, b) => (a.name || '').localeCompare(b.name || ''),
  distinctNPIs:  (a, b) => a.distinctNPIs - b.distinctNPIs,
  totalAmount:   (a, b) => a.totalAmount - b.totalAmount,
  risk:          (a, b) => (RISK_RANK[a.risk] || 0) - (RISK_RANK[b.risk] || 0),
  firstSeen:     (a, b) => parseDate(a.firstSeen) - parseDate(b.firstSeen),
}

// Compact money for stat cards — "$23.3M" / "$729.6K", full fmtUSD below it.
function fmtShortUSD(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return fmtUSD(v)
}

// Sub-line under a supplier's name — most-urgent fact first (OIG > flags > NPI count).
function supplierSub(s) {
  if (s.oig) return 'OIG flagged'
  if (s.physicianFlags > 0) return `${s.physicianFlags} flag${s.physicianFlags !== 1 ? 's' : ''}`
  return `${s.distinctNPIs} NPI${s.distinctNPIs !== 1 ? 's' : ''}`
}
const urgencyScore = (s) => (s.risk === 'Critical' ? 300 : s.risk === 'High' ? 200 : s.risk === 'Medium' ? 100 : 0) + (s.oig ? 50 : 0) + (s.physicianFlags || 0)
const actionLabel = (s) => s.risk === 'Critical' ? 'Escalate' : (s.oig || (s.physicianFlags || 0) > 0) ? 'Review' : 'View'
const barColor = (s) => bandByName(s.risk).color

export default function SupplierWatchlist({ onSelect, onViewAll, search = '' }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [oigFilter, setOigFilter] = useState('')   // '' | 'flagged' | 'clean' — head-row Filters button
  const [risk, setRisk]       = useState('')       // '' | Critical | High | Medium | Low — Risk column-header dropdown
  const [sort, setSort]       = useState({ key: null, dir: null })
  const [hoverBilled, setHoverBilled] = useState(null)   // Billed summary bar hover — index of the hovered supplier

  useEffect(() => {
    let cancelled = false
    getSuppliers()
      .then((sup) => { if (!cancelled) { setRows(sup); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message || 'Failed to load vendors'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  function onSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return { key: null, dir: null }
    })
  }

  const oigCount     = rows.filter((s) => s.oig).length
  const critCount    = rows.filter((s) => s.risk === 'Critical').length
  const highCount    = rows.filter((s) => s.risk === 'High').length
  const totalBilled  = rows.reduce((sum, s) => sum + (s.totalAmount || 0), 0)
  const pct = (n) => rows.length ? Math.round((n / rows.length) * 100) : 0

  const visible = rows.filter((s) => {
    if (oigFilter === 'flagged' && !s.oig) return false
    if (oigFilter === 'clean' && s.oig) return false
    if (risk === 'CriticalHigh' && !['Critical', 'High'].includes(s.risk)) return false
    else if (risk && risk !== 'CriticalHigh' && s.risk !== risk) return false
    if (search && !(s.name || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const sorted = [...visible]
  if (sort.key && COMPARATORS[sort.key]) {
    sorted.sort(COMPARATORS[sort.key])
    if (sort.dir === 'desc') sorted.reverse()
  } else {
    sorted.sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0))
  }

  const topBilled    = [...rows].sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0)).slice(0, 7)
  const topBilledMax = Math.max(1, ...topBilled.map((s) => s.totalAmount || 0))
  // Top 3 only — keeps this card the same height as the Billed summary chart
  // beside it instead of stretching the row taller.
  const needingAction = [...rows].sort((a, b) => urgencyScore(b) - urgencyScore(a)).slice(0, 3)

  if (error) return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-7">
      <div className="mc-card border-[#EBD3D1] bg-[#F7EBEA]/50 px-4 sm:px-6 py-5 text-sm">
        <span className="font-semibold text-[#A6453F]">Couldn't load the watchlist:</span>{' '}
        <span className="text-slate-500">{error}</span>
      </div>
    </div>
  )

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-4 sm:px-7 pt-1 pb-4">
      <div className="w-full flex-1 min-h-0 flex flex-col gap-4">

        {/* ── Stat row — shared moodboard KpiCard (glow circle, icon badge,
             colored progress track), same recipe as the physician dashboard ── */}
        <div className="flex-shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <KpiCard tone="default" label="Total vendors" value={loading ? '…' : rows.length.toLocaleString()} sub="Across network"
                   icon={<Icon name="suppliers" size={16} />}
                   onClick={() => { setOigFilter(''); setRisk(''); setSort({ key: null, dir: null }) }} />
          <KpiCard tone="danger" label="OIG flagged" value={loading ? '…' : oigCount.toLocaleString()} sub={`${pct(oigCount)}% of vendors`}
                   pct={pct(oigCount)}
                   icon={<Icon name="alertTri" size={16} />}
                   onClick={() => setOigFilter('flagged')} />
          <KpiCard tone="warning" label="Critical + high risk" value={loading ? '…' : (critCount + highCount).toLocaleString()} sub={`${critCount} critical, ${highCount} high`}
                   pct={pct(critCount + highCount)}
                   icon={<Icon name="flag" size={16} />}
                   onClick={() => setRisk('CriticalHigh')} />
          <KpiCard tone="success" label="Total billed" value={loading ? '…' : fmtShortUSD(totalBilled)} sub={fmtUSD(totalBilled)}
                   icon={
                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                       <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                     </svg>
                   }
                   onClick={() => setSort({ key: 'totalAmount', dir: 'desc' })} />
        </div>

        {/* ── Billed summary + suppliers needing action ── */}
        <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
          <div className="bg-white border border-[var(--color-border)] rounded-2xl px-5 py-4"
               style={{ boxShadow: '0 1px 2px rgba(10,31,61,.05), 0 1px 1px rgba(10,31,61,.03)' }}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <div>
                <h3 className="text-[14px] font-bold text-[var(--color-primary)]">Billed summary</h3>
                <span className="text-[11px] text-[var(--color-text-body)]">Top vendors by billed amount — bar color is risk level</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 pt-0.5">
                <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-text-body)]">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#A6453F' }} />Critical
                </span>
                <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-text-body)]">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#D1A85C' }} />High
                </span>
                <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-text-body)]">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#5A9BC9' }} />Medium/Low
                </span>
              </div>
            </div>
            {loading ? (
              <div className="h-[150px] mt-3 rounded-lg bg-slate-100 animate-pulse" />
            ) : topBilled.length === 0 ? (
              <div className="h-[150px] mt-3 flex items-center justify-center text-[12px] text-slate-400">No vendors</div>
            ) : (
              <div className="flex items-end gap-3 h-[140px] mt-7">
                {topBilled.map((s, i) => (
                  <div key={s.id} className="relative flex-1 flex flex-col items-center gap-1.5 h-full justify-end min-w-0"
                       onMouseEnter={() => setHoverBilled(i)} onMouseLeave={() => setHoverBilled((h) => (h === i ? null : h))}>
                    {hoverBilled === i && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 pointer-events-none whitespace-nowrap rounded-lg px-2.5 py-1.5 text-white"
                           style={{ background: 'var(--color-primary)', boxShadow: '0 4px 12px rgba(10,31,61,.25)' }}>
                        <div className="text-[10.5px] font-bold max-w-[180px] truncate">{s.name}</div>
                        <div className="text-[10px] flex items-center gap-1.5 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: barColor(s) }} />
                          {s.risk} risk · {fmtUSD(s.totalAmount)}
                        </div>
                      </div>
                    )}
                    <div className="w-full max-w-[26px] rounded-t-[6px] transition-all duration-300 cursor-default"
                         style={{ height: `${Math.max(6, (s.totalAmount / topBilledMax) * 100)}%`, background: barColor(s), opacity: hoverBilled === null || hoverBilled === i ? 1 : 0.45 }} />
                    <span className="text-[9.5px] truncate w-full text-center" style={{ color: hoverBilled === i ? 'var(--color-primary)' : 'var(--color-text-body)', fontWeight: hoverBilled === i ? 700 : 400 }}>
                      {(s.name || '').split(' ')[0].slice(0, 9)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-[var(--color-border)] rounded-2xl px-5 py-4"
               style={{ boxShadow: '0 1px 2px rgba(10,31,61,.05), 0 1px 1px rgba(10,31,61,.03)' }}>
            <div className="mb-1">
              <h3 className="text-[14px] font-bold text-[var(--color-primary)]">Vendors needing action</h3>
              <span className="text-[11px] text-[var(--color-text-body)]">Sorted by urgency — flags and OIG status first</span>
            </div>
            {loading ? (
              <div className="mt-2 space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />)}</div>
            ) : needingAction.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-slate-400">No vendors</div>
            ) : (
              <div className="mt-1">
                {needingAction.map((s, i) => (
                  <div key={s.id} className={`flex items-center gap-2.5 py-2.5 ${i > 0 ? 'border-t border-[var(--color-bg-soft)]' : ''}`}>
                    <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: barColor(s) }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold text-[var(--color-primary)] truncate">{s.name}</div>
                      <div className="text-[10.5px] text-[var(--color-text-body)] truncate">{supplierSub(s)}</div>
                    </div>
                    <span className="font-mono text-[12.5px] font-bold text-[var(--color-primary)] flex-shrink-0 w-14 text-right">{fmtShortUSD(s.totalAmount)}</span>
                    <button onClick={() => onSelect?.(s)}
                            className={`flex-shrink-0 ${actionLabel(s) === 'Escalate' ? 'take-action-btn' : 'view-btn'}`}>
                      {actionLabel(s)} →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Suppliers table — absorbs whatever height is left of the viewport
             (the page itself never scrolls); long lists scroll inside the card ── */}
        <div className="flex-1 flex flex-col bg-white border border-[var(--color-border)] rounded-2xl overflow-hidden min-h-[220px]"
             style={{ boxShadow: '0 1px 2px rgba(10,31,61,.05), 0 1px 1px rgba(10,31,61,.03)' }}>
          <div className="flex-shrink-0 flex items-start justify-between gap-3 px-5 py-4">
            <div>
              <h3 className="text-[14px] font-bold text-[var(--color-primary)]">Vendors</h3>
            </div>
            <button onClick={() => onViewAll?.()}
                    className="text-[11.5px] font-semibold text-[var(--color-primary-tint)] hover:underline flex-shrink-0 pt-0.5">
              View all →
            </button>
          </div>

          {loading ? (
            <div className="px-4 sm:px-5 pb-5"><TableSkeleton rows={8} /></div>
          ) : (
            <VendorsTable rows={sorted} sort={sort} onSort={onSort} risk={risk} setRisk={setRisk}
                          onSelect={onSelect} onClearFilters={() => { setOigFilter(''); setRisk('') }}
                          heightCls="flex-1 min-h-0" />
          )}
        </div>

      </div>
    </div>
  )
}

// The vendors table itself — shared between the watchlist card above and the
// full-screen "All Vendors" view (AllVendors below), so columns/sorting/
// filters never drift apart between the two.
function VendorsTable({ rows, sort, onSort, risk, setRisk, onSelect, onClearFilters, heightCls = '' }) {
  return (
    <div className={`${heightCls} overflow-auto`}>
      <table className="w-full border-collapse text-[12.8px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {COLUMNS.map((c) => {
              if (c.key === 'risk') {
                return <FilterTh key={c.key} label={c.label} options={RISK_FILTER_OPTIONS} value={risk} onChange={setRisk} hide={c.hide} align={c.align} />
              }
              const activeSort = sort.key === c.key
              return (
                <th key={c.key} onClick={() => onSort(c.key)}
                    className={`text-left py-2.5 px-3.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-body)] bg-[var(--color-bg-soft)] border-b border-[var(--color-bg-soft)] whitespace-nowrap cursor-pointer select-none group ${c.align === 'right' ? 'text-right' : ''} ${hideCls(c.hide)}`}>
                  <span className={`inline-flex items-center gap-1 group-hover:text-[var(--color-primary)] transition-colors ${c.align === 'right' ? 'justify-end' : ''}`}>
                    {c.label}
                    {activeSort
                      ? <span className="text-[var(--color-primary)] font-bold">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                      : <span className="text-slate-300 group-hover:text-[var(--color-primary)] transition-colors">↕</span>}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} onClick={() => onSelect?.(s)}
                className="cursor-pointer transition-colors duration-100 border-b border-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">

              <td className="py-[11px] px-3.5 align-middle">
                <div className="flex items-center gap-2.5">
                  <div className="w-[26px] h-[26px] rounded-[7px] bg-[var(--color-bg-soft)] text-[var(--color-text-body)] flex items-center justify-center flex-shrink-0">
                    <Icon name="suppliers" size={13} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--color-primary)] leading-snug truncate">{s.name}</div>
                    <div className="text-[10.5px] text-[var(--color-text-body)] font-mono truncate">{supplierSub(s)}</div>
                  </div>
                </div>
              </td>

              <td className="py-[11px] px-3.5 align-middle"><RiskPill band={s.risk} /></td>

              <td className="py-[11px] px-3.5 align-middle text-right font-mono font-semibold text-slate-700 tabular-nums hidden sm:table-cell">
                {s.distinctNPIs}
              </td>

              <td className="py-[11px] px-3.5 align-middle font-mono text-[#46586F] tabular-nums hidden md:table-cell">
                {fmtDate(s.firstSeen)}
              </td>

              <td className="py-[11px] px-3.5 align-middle text-right font-mono font-semibold tabular-nums"
                  style={{ color: s.risk === 'Critical' ? '#A6453F' : '#17233A' }}>
                {fmtUSD(s.totalAmount)}
              </td>
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Icon name="search" size={28} stroke={1.5} className="text-slate-300" />
                  <span className="text-sm font-medium">No vendors match these filters</span>
                  <button onClick={() => onClearFilters?.()}
                          className="text-xs font-semibold text-[var(--color-primary)] hover:underline mt-1 cursor-pointer">
                    Clear filters
                  </button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Full-screen "All Vendors" table — opened by the watchlist table's
// "View all →" link. Same columns/sorting/filters as the watchlist card,
// but the table is the whole screen. ────────────────────────────────────────
export function AllVendors({ onSelect, search = '' }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [oigFilter, setOigFilter] = useState('')
  const [risk, setRisk]       = useState('')
  const [sort, setSort]       = useState({ key: null, dir: null })

  useEffect(() => {
    let cancelled = false
    getSuppliers()
      .then((sup) => { if (!cancelled) { setRows(sup); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message || 'Failed to load vendors'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  function onSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return { key: null, dir: null }
    })
  }

  const visible = rows.filter((s) => {
    if (oigFilter === 'flagged' && !s.oig) return false
    if (oigFilter === 'clean' && s.oig) return false
    if (risk && s.risk !== risk) return false
    if (search && !(s.name || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const sorted = [...visible]
  if (sort.key && COMPARATORS[sort.key]) {
    sorted.sort(COMPARATORS[sort.key])
    if (sort.dir === 'desc') sorted.reverse()
  } else {
    sorted.sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0))
  }

  if (error) return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-7">
      <div className="mc-card border-[#EBD3D1] bg-[#F7EBEA]/50 px-4 sm:px-6 py-5 text-sm">
        <span className="font-semibold text-[#A6453F]">Couldn't load vendors:</span>{' '}
        <span className="text-slate-500">{error}</span>
      </div>
    </div>
  )

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-4 sm:px-7 pt-4 pb-5">
      <div className="flex-1 min-h-0 flex flex-col bg-white border border-[var(--color-border)] rounded-2xl overflow-hidden"
           style={{ boxShadow: '0 1px 2px rgba(10,31,61,.05), 0 1px 1px rgba(10,31,61,.03)' }}>
        <div className="flex-shrink-0 flex items-start justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="text-[14px] font-bold text-[var(--color-primary)]">All vendors</h3>
            <span className="text-[11px] text-[var(--color-text-body)]">
              {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} vendors, sorted by billed amount
            </span>
          </div>
          <HeadFilterButton value={oigFilter} onChange={setOigFilter} />
        </div>

        {loading ? (
          <div className="px-4 sm:px-5 pb-5"><TableSkeleton rows={12} /></div>
        ) : (
          <VendorsTable rows={sorted} sort={sort} onSort={onSort} risk={risk} setRisk={setRisk}
                        onSelect={onSelect} onClearFilters={() => { setOigFilter(''); setRisk('') }}
                        heightCls="flex-1 min-h-0" />
        )}
      </div>
    </div>
  )
}
