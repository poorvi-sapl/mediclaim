import { useState, useEffect, useRef } from 'react'
import { getClaimsPage, postAction, ACTION_TO_BACKEND, PHYSICIAN_NPI, API_BASE } from '../api'
import { Icon, fmtUSD } from './ui'

function KpiTile({ icon, label, value, accent = 'slate', valueClass = '', loading }) {
  const styles = {
    slate:  { wrap: 'bg-slate-100',    icon: 'text-slate-500'    },
    blue:   { wrap: 'bg-[#e8eef7]',   icon: 'text-[#1B3A5C]'   },
    amber:  { wrap: 'bg-amber-100',   icon: 'text-amber-500'    },
    emerald:{ wrap: 'bg-emerald-100', icon: 'text-emerald-600'  },
    rose:   { wrap: 'bg-rose-100',    icon: 'text-rose-500'     },
  }
  const s = styles[accent] || styles.slate
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-center gap-4 group cursor-default transition-all duration-200 hover:-translate-y-1 hover:shadow-md hover:border-slate-200">
      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${s.wrap}`}>
        <Icon name={icon} size={18} className={s.icon} />
      </div>
      <div className="min-w-0">
        {loading
          ? <div className="h-7 w-20 rounded-lg bg-slate-100 animate-pulse" />
          : <div className={`text-[1.45rem] font-bold tabular-nums leading-none tracking-tight text-slate-900 ${valueClass}`}>{value}</div>}
        <div className="text-[11px] font-medium text-slate-400 mt-1 uppercase tracking-wider leading-none">{label}</div>
      </div>
    </div>
  )
}

const fmtDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

const CATEGORIES = ['All Categories', 'Home Health', 'Hospice', 'DME', 'Drugs', 'Hospital']

function CustomSelect({ value, onChange, options, placeholder = 'Select…' }) {
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
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl border border-slate-200 z-50 min-w-[160px] overflow-hidden"
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>
          <div className="py-1">
            <button onMouseDown={() => pick('')}
                    className={`w-full text-left px-3.5 py-2 text-[12px] font-medium transition-colors flex items-center justify-between gap-3 ${!value ? 'text-[#0d1f35] bg-slate-50 font-semibold' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
              {placeholder}
              {!value && <span className="text-[#0d1f35] text-[11px]">✓</span>}
            </button>
            {options.map(o => (
              <button key={o.value} onMouseDown={() => pick(o.value)}
                      className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 ${value === o.value ? 'bg-slate-50 text-[#0d1f35] font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}>
                <span className="truncate">{o.label}</span>
                {value === o.value && <span className="text-[#0d1f35] shrink-0 text-[11px]">✓</span>}
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

const PAGE_SIZE = 15

// Single muted-blue category chip everywhere (no per-category colors).
const CATEGORY_CHIP = 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium'
const CATEGORY_CHIP_STYLE = { backgroundColor: '#EFF6FF', color: '#1E3A5F' }

// four row actions (icon-only). UI id -> backend action_type mapped in api.js.
const ACTIONS = [
  { id: 'confirmed',     label: 'Confirm',        icon: 'check', cls: 'bg-emerald-50/70 text-emerald-500 ring-emerald-100 hover:bg-emerald-100 hover:text-emerald-700 hover:ring-emerald-300 hover:shadow-emerald-100' },
  { id: 'disputed',      label: 'Dispute',        icon: 'x',     cls: 'bg-rose-50/70 text-rose-400 ring-rose-100 hover:bg-rose-100 hover:text-rose-600 hover:ring-rose-300 hover:shadow-rose-100'                   },
  { id: 'flagged',       label: 'Flag Supplier',  icon: 'flag',  cls: 'bg-amber-50/70 text-amber-500 ring-amber-100 hover:bg-amber-100 hover:text-amber-700 hover:ring-amber-300 hover:shadow-amber-100'             },
  { id: 'unknownPatient',label: 'Unknown Patient',icon: 'userx', cls: 'bg-slate-50 text-slate-400 ring-slate-200 hover:bg-slate-100 hover:text-slate-600 hover:ring-slate-300'                                       },
]

function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

// ─── 60-second undo window ──────────────────────────────────────────────────
// The backend (DELETE /actions/{id}) is the source of truth for the 60s limit;
// this is the honest client-side countdown. created_at comes from the server, so
// the timer resumes correctly after a refresh (we stash it in localStorage since
// the claims-list response doesn't carry the action timestamp).
const UNDO_WINDOW = 60
const UNDO_KEY = 'claimlens_undo_v1'

// Server timestamps are naive UTC (datetime.utcnow); treat a tz-less string as UTC
// so the countdown isn't skewed by the browser's local offset.
function parseServerTime(s) {
  if (!s) return null
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
  return new Date(hasTz ? s : s + 'Z').getTime()
}
function secondsRemaining(createdAt, now) {
  const t = parseServerTime(createdAt)
  if (!t) return 0
  return Math.max(0, UNDO_WINDOW - Math.floor((now - t) / 1000))
}
// Undo countdown color (change 4) — calm by default; red only at the very end. No bold.
//   60–31s: gray-500, underline on hover  ·  30–11s: amber-600  ·  10–1s: red-600
function undoTimerCls(r) {
  if (r > 30) return 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200 hover:text-slate-700'
  if (r > 10) return 'bg-amber-50 text-amber-600 ring-amber-200 hover:bg-amber-100'
  return 'bg-rose-50 text-rose-600 ring-rose-200 hover:bg-rose-100 animate-pulse'
}

function loadUndoStore() {
  try { return JSON.parse(localStorage.getItem(UNDO_KEY) || '{}') } catch { return {} }
}
function saveUndoEntry(claimId, actionId, createdAt) {
  try { const s = loadUndoStore(); s[claimId] = { actionId, createdAt }; localStorage.setItem(UNDO_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}
function removeUndoEntry(claimId) {
  try { const s = loadUndoStore(); delete s[claimId]; localStorage.setItem(UNDO_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}
// Re-attach action_id + created_at to actioned rows after a page load (the claims
// list doesn't return them). Drops entries already past the window so stale rows
// never show a dead Undo link.
function hydrateUndo(items) {
  const s = loadUndoStore(); const now = Date.now()
  return items.map((c) => {
    const e = c.latestAction && s[c.id]
    if (e && secondsRemaining(e.createdAt, now) > 0) {
      return { ...c, actionId: e.actionId, actionCreatedAt: e.createdAt }
    }
    return c
  })
}

// Subtle soft-green chip (change 4) — no border, not a heavy badge.
const actionedBadge = (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium"
        style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
    <Icon name="check" size={12} stroke={2.5} /> Actioned
  </span>
)

// Self-contained actioned cell: owns its own per-row countdown interval (cleaned up
// on unmount or when the window closes). Single-click undo — the 60s window is the
// accidental-click guard, so no extra confirmation (change 6).
function ActionedCell({ claim, onUndo }) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const [expired, setExpired] = useState(false)

  const remaining = claim.actionCreatedAt ? secondsRemaining(claim.actionCreatedAt, now) : 0
  const canUndo = !!claim.actionId && !!claim.actionCreatedAt && remaining > 0 && !expired

  useEffect(() => {
    if (!canUndo) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [canUndo])

  async function handleUndo() {
    setBusy(true); setErr(false)
    const res = await onUndo(claim)
    setBusy(false)
    if (res?.ok) return                 // parent restores the row -> this cell unmounts
    if (res?.expired) setExpired(true)   // window closed server-side: drop the link
    else setErr(true)                    // transient error: keep the link for retry
  }

  return (
    <div className="flex items-center gap-1.5 text-xs whitespace-nowrap flex-nowrap">
      {actionedBadge}
      {canUndo && (busy
        ? <Spinner />
        : <button onClick={handleUndo}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset transition-all duration-150 whitespace-nowrap ${undoTimerCls(remaining)}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
            </svg>
            Undo · {remaining}s
          </button>
      )}
      {expired && <span className="text-[11px] text-slate-400 whitespace-nowrap">Expired</span>}
      {err && <span className="text-[11px] text-rose-400 whitespace-nowrap">Failed</span>}
    </div>
  )
}

// Status as plain colored text (change 4) — only deliberate decisions carry color.
// Unreviewed + Unknown Patient are muted gray; no pills/badges anywhere.
function statusFor(claim) {
  const act = claim.latestAction
  if (act === 'confirm') return { label: 'Confirmed', cls: 'text-[#059669] font-normal' }
  if (act === 'dispute') return { label: 'Disputed', cls: 'text-[#7C3AED] font-normal' }
  if (act === 'unknown_patient') return { label: 'Unknown Patient', cls: 'text-[#6B7280] font-normal' }
  if (act) return { label: 'Flagged', cls: 'text-[#DC2626] font-medium' }   // flag_supplier / did_not_order
  if (claim.reviewed) return { label: 'Reviewed', cls: 'text-[#6B7280] font-normal' }
  return { label: 'Unreviewed', cls: 'text-[#6B7280] font-normal' }
}

// Supplier name color hierarchy (change 5): only genuine high-risk stands out.
function supplierTierCls(claim) {
  if (claim.supplierHighRisk) return 'font-semibold text-[#DC2626]'
  if (claim.hasRuleFlag) return 'font-medium text-[#DC2626]'
  return 'font-normal text-[#DC2626]'
}

// claims-table cell padding (12px/16px) — local so the shared .td (px-5 py-4) used by
// other tables is left untouched.
const CELL = 'px-4 py-3 align-middle'
// Column order + widths. `sort` = client-side sort key (omitted = not sortable).
// Service Description is the flex column (takes remaining space, truncates).
const COLS = [
  { key: 'date', label: 'Date', width: 100, sort: 'date' },
  { key: 'patient', label: 'Patient Name', width: 140, sort: 'patient' },
  { key: 'supplier', label: 'Supplier', width: 200, sort: 'supplier' },
  { key: 'amount', label: 'Amount', width: 110, right: true, sort: 'amount' },
  { key: 'category', label: 'Service Category', width: 130, sort: 'category' },
  { key: 'description', label: 'Service Description', flex: true, sort: 'description' },
  { key: 'status', label: 'Status', width: 110, sort: 'status' },
  { key: 'actions', label: 'Actions', width: 120 },   // not sortable
]
const NCOLS = COLS.length

// ─── client-side sort (change 7) ─────────────────────────────────────────────
const parseMs = (d) => { const t = Date.parse(d); return Number.isNaN(t) ? 0 : t }
const lastName = (n) => { const p = String(n || '').trim().split(/\s+/); return (p[p.length - 1] || '').toLowerCase() }
// status order for sorting: Unreviewed → Confirmed → Disputed → Flagged
function statusRank(claim) {
  const a = claim.latestAction
  if (a === 'confirm') return 1
  if (a === 'dispute') return 2
  if (a === 'unknown_patient') return 2.5
  if (a) return 3            // flag_supplier / did_not_order
  return 0                   // unreviewed / reviewed-no-action
}
const CLAIM_COMPARATORS = {
  date: (a, b) => parseMs(a.date) - parseMs(b.date),
  patient: (a, b) => lastName(a.patient).localeCompare(lastName(b.patient)),
  supplier: (a, b) => (a.supplier || '').localeCompare(b.supplier || ''),
  amount: (a, b) => (a.amount || 0) - (b.amount || 0),
  category: (a, b) => (a.category || '').localeCompare(b.category || ''),
  description: (a, b) => (a.description || '').localeCompare(b.description || ''),
  status: (a, b) => statusRank(a) - statusRank(b),
}

const CLEARED = { category: 'All Categories', dateFrom: '', dateTo: '', supplier: '', reviewed: 'all' }
const DEFAULT_FILTERS = { ...CLEARED, reviewed: 'unreviewed', page: 0 }
const inputCls = 'bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-600 outline-none cursor-pointer transition-colors hover:border-slate-300 focus:border-ink focus:ring-2 focus:ring-ink/15'

function last30Iso() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export default function ClaimsTable({ npi = PHYSICIAN_NPI, onActioned, supplierFilter: incomingSupplier = null, onSupplierFilterChange }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [debouncedSupplier, setDebouncedSupplier] = useState('')
  const [data, setData] = useState({ items: [], total: 0, page: 0, totalPages: 0, totalCount: 0, flaggedCount: 0, confirmedCount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(null)
  const [toast, setToast] = useState(null)
  const [supFilter, setSupFilter] = useState(incomingSupplier)   // active supplier filter (exact name)
  const [supSummary, setSupSummary] = useState(null)             // { claims, patients, billed }
  const [unknownOnly, setUnknownOnly] = useState(false)          // dashboard "Unknown Suppliers" intent
  const [sort, setSort] = useState({ key: null, dir: null })     // client-side column sort (null = default)

  // asc → desc → cleared. A different column starts fresh at asc.
  function onSort(key) {
    setSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }
  const resetSort = () => setSort({ key: null, dir: null })

  // Dashboard summary-card navigation (change 5): a card stashes a filter intent in
  // sessionStorage then switches to this tab; read it once on mount and apply it.
  // (Same idea as the supplier-filter hand-off from Flagged Suppliers, but via storage
  // so it works across the tab-state navigation without prop-threading through App.)
  useEffect(() => {
    let intent = null
    try {
      const raw = sessionStorage.getItem('physician_claims_intent')
      if (raw) { intent = JSON.parse(raw); sessionStorage.removeItem('physician_claims_intent') }
    } catch { /* ignore */ }
    if (!intent) return
    setSupFilter(null); onSupplierFilterChange?.(null)
    setUnknownOnly(!!intent.unknownOnly)
    setFilters({ ...CLEARED, reviewed: intent.reviewed || 'all', dateFrom: intent.dateFrom || '', dateTo: intent.dateTo || '', page: 0 })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSupplier(filters.supplier), 300)
    return () => clearTimeout(t)
  }, [filters.supplier])

  // A supplier picked on the Flagged Suppliers screen arrives via props -> apply it and
  // switch to "All" so every claim from that supplier shows (not just unreviewed).
  useEffect(() => {
    if (incomingSupplier) {
      setSupFilter(incomingSupplier)
      setFilters((f) => ({ ...f, reviewed: 'all', page: 0 }))
    }
  }, [incomingSupplier])

  // Apply / toggle a supplier filter from a click inside the table.
  function applySupplier(name) {
    const next = supFilter === name ? null : name   // clicking the active supplier clears it
    resetSort()
    setSupFilter(next)
    setFilters((f) => ({ ...f, page: 0, reviewed: next ? 'all' : f.reviewed }))
    onSupplierFilterChange?.(next)
  }
  function clearSupplier() {
    resetSort()
    setSupFilter(null)
    setFilters((f) => ({ ...f, page: 0 }))
    onSupplierFilterChange?.(null)
  }

  // Patient summary across ALL of the supplier's filtered claims (pages capped at 100).
  useEffect(() => {
    if (!supFilter) { setSupSummary(null); return }
    let cancelled = false
    ;(async () => {
      const names = new Set(); let billed = 0, claims = 0, pageN = 0, totalPages = 1
      try {
        do {
          const res = await getClaimsPage(npi, {
            page: pageN, pageSize: 100, category: filters.category,
            dateFrom: filters.dateFrom, dateTo: filters.dateTo,
            reviewed: filters.reviewed, supplierSearch: supFilter,
          })
          res.items.forEach((c) => { names.add(c.patient); billed += c.amount || 0 })
          claims = res.total; totalPages = res.totalPages; pageN += 1
        } while (pageN < totalPages && !cancelled)
        if (!cancelled) setSupSummary({ claims, patients: names.size, billed })
      } catch { if (!cancelled) setSupSummary(null) }
    })()
    return () => { cancelled = true }
  }, [supFilter, npi, filters.category, filters.dateFrom, filters.dateTo, filters.reviewed])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    getClaimsPage(npi, {
      page: filters.page, pageSize: PAGE_SIZE,
      category: filters.category, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
      reviewed: filters.reviewed, supplierSearch: supFilter || debouncedSupplier,
    })
      .then((res) => {
        if (!cancelled) {
          const hydrated = hydrateUndo(res.items)
          setData((prev) => ({
            ...res,
            items: filters.page === 0 ? hydrated : [...prev.items, ...hydrated],
          }))
          setLoading(false)
        }
      })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [npi, filters.page, filters.category, filters.dateFrom, filters.dateTo, filters.reviewed, debouncedSupplier, supFilter])

  function handleExport() {
    exportCSV('claims.csv',
      ['Date', 'Patient Name', 'Supplier', 'Amount', 'Category', 'Description', 'Status'],
      sortedItems.map(c => [fmtDate(c.date), c.patient, c.supplier, c.amount, c.category, c.description, statusFor(c).label])
    )
  }

  function setFilter(key, value) { resetSort(); setUnknownOnly(false); setFilters((f) => ({ ...f, [key]: value, page: 0 })) }
  function setPage(p) { setFilters((f) => ({ ...f, page: p })) }
  function clearAll() { resetSort(); setUnknownOnly(false); setFilters({ ...CLEARED, page: 0 }); setDebouncedSupplier('') }
  function toggleLast30() {
    resetSort()
    setFilters((f) => ({ ...f, dateFrom: f.dateFrom ? '' : last30Iso(), dateTo: '', page: 0 }))
  }

  const last30Active = !!filters.dateFrom
  const isActive = filters.category !== CLEARED.category || filters.dateFrom || filters.dateTo ||
    filters.supplier || filters.reviewed !== CLEARED.reviewed

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  async function handleAction(claimId, action) {
    setPending({ claimId, action })
    try {
      const res = await postAction(claimId, npi, action)
      const backend = ACTION_TO_BACKEND[action] || action
      // store action_id + server created_at so this row can be undone (and the
      // countdown survives a refresh via localStorage)
      saveUndoEntry(claimId, res?.id, res?.created_at)
      setData((d) => ({ ...d, items: d.items.map((c) => (c.id === claimId ? { ...c, reviewed: true, latestAction: backend, actionId: res?.id, actionCreatedAt: res?.created_at } : c)) }))
      if (onActioned) onActioned()
    } catch (e) {
      showToast(e.message || 'Could not record action. Please try again.')
    } finally { setPending(null) }
  }

  // Returns { ok } | { expired } | { error }. The cell renders the outcome.
  async function doUndo(claim) {
    try {
      const r = await fetch(`${API_BASE}/actions/${claim.actionId}`, { method: 'DELETE', credentials: 'include' })
      if (r.status === 403) {
        let body = null
        try { body = await r.json() } catch { /* ignore */ }
        if (body?.detail?.error === 'undo_expired') { removeUndoEntry(claim.id); return { expired: true } }
        return { error: true }
      }
      if (!r.ok) return { error: true }
      // restore the row to its unreviewed state (action buttons reappear)
      removeUndoEntry(claim.id)
      setData((d) => ({ ...d, items: d.items.map((c) => (c.id === claim.id ? { ...c, reviewed: false, latestAction: null, actionId: null, actionCreatedAt: null } : c)) }))
      if (onActioned) onActioned()
      return { ok: true }
    } catch {
      return { error: true }
    }
  }

  const { items, total, page, totalPages, totalCount, flaggedCount, confirmedCount } = data
  // "Unknown Suppliers Detected" card: client-side narrow to unknown-patient / new-supplier
  // claims on the current page (no backend filter exists for this; honest best-effort).
  const displayItems = unknownOnly
    ? items.filter((c) => c.unknownSupplier || c.latestAction === 'unknown_patient')
    : items
  // Sort the current page client-side; default (no sort) = newest date first.
  const sortedItems = (() => {
    const arr = [...displayItems]
    if (sort.key && CLAIM_COMPARATORS[sort.key]) {
      arr.sort(CLAIM_COMPARATORS[sort.key])
      if (sort.dir === 'desc') arr.reverse()
    } else {
      arr.sort((a, b) => parseMs(b.date) - parseMs(a.date))
    }
    return arr
  })()

  return (
    <div className="w-full px-7 py-7">
      {/* Stat cards (item 1) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <KpiTile icon="doc"      label="Total Claims" value={(totalCount || 0).toLocaleString()}    accent="blue"    loading={loading} />
        <KpiTile icon="alertTri" label="Flagged"      value={(flaggedCount || 0).toLocaleString()}   accent="amber"   loading={loading} valueClass={flaggedCount > 0 ? 'text-amber-600' : ''} />
        <KpiTile icon="check"    label="Confirmed"    value={(confirmedCount || 0).toLocaleString()} accent="emerald" loading={loading} valueClass={confirmedCount > 0 ? 'text-emerald-600' : ''} />
      </div>

      <div className="mc-card">
        {/* Filter bar */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-2.5">
          {/* Review status toggle */}
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-1 shrink-0">
            {[['all', 'All'], ['unreviewed', 'Unreviewed'], ['reviewed', 'Reviewed']].map(([id, label]) => (
              <button key={id} onClick={() => setFilter('reviewed', id)}
                      className={`px-3.5 py-1.5 text-[12px] font-semibold rounded-lg transition-all duration-150 ${filters.reviewed === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-slate-200 mx-0.5 shrink-0" />

          {/* Category custom select */}
          <CustomSelect
            value={filters.category}
            onChange={v => setFilter('category', v)}
            options={CATEGORIES.map(c => ({ value: c, label: c === 'All Categories' ? 'Category: All' : c }))}
          />

          {/* Last 30 days toggle */}
          <button onClick={toggleLast30}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium border transition-all duration-150 whitespace-nowrap ${last30Active ? 'bg-[#EEF2F7] border-[#1B3A5C]/20 text-[#1B3A5C]' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
            <Icon name="clock" size={13} stroke={2} />
            Last 30 Days
          </button>

          {/* Search */}
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon name="search" size={13} /></span>
            <input type="text" placeholder="Search supplier name…" value={filters.supplier} onChange={(e) => setFilter('supplier', e.target.value)}
                   className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-[13px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#1B3A5C]/40 focus:ring-2 focus:ring-[#1B3A5C]/10 transition-all hover:border-slate-300" />
          </div>

          {/* Right: count + clear + export */}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {isActive && (
              <button onClick={clearAll}
                      className="text-[12px] font-semibold text-slate-500 hover:text-rose-500 transition-colors flex items-center gap-1">
                <Icon name="x" size={11} stroke={2.5} /> Clear all
              </button>
            )}
            <span className="text-[12px] font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg tabular-nums">
              {supFilter
                ? `${total.toLocaleString()} / ${(totalCount || 0).toLocaleString()}`
                : `${total.toLocaleString()} claim${total !== 1 ? 's' : ''}`}
            </span>
            <button onClick={handleExport}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E3A5F]/20 bg-white text-[#1E3A5F] text-[12px] font-semibold hover:bg-[#EEF2F7] transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          </div>
        </div>

        {/* Active supplier filter indicator + patient summary */}
        {supFilter && (
          <>
            <div className="px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-[#1B3A5C]/[0.06] to-transparent flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-700 flex items-center gap-2.5 min-w-0">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#1B3A5C]/10 text-[#1B3A5C] flex-shrink-0"><Icon name="suppliers" size={15} stroke={2.1} /></span>
                <span className="whitespace-nowrap text-slate-500">Showing claims for</span>
                <span className="font-bold text-[#1B3A5C] truncate">{supFilter}</span>
              </span>
              <button onClick={clearSupplier}
                      className="group flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:bg-rose-50 transition-colors flex-shrink-0">
                <Icon name="x" size={13} stroke={2.4} /> Clear filter
              </button>
            </div>
            {supSummary && (
              <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                {supSummary.claims.toLocaleString()} claims · {supSummary.patients.toLocaleString()} unique patient{supSummary.patients !== 1 ? 's' : ''} · {fmtUSD(supSummary.billed)} total billed by this supplier under your NPI
              </div>
            )}
          </>
        )}

        {unknownOnly && (
          <div className="px-5 py-3 border-b border-slate-100 bg-amber-50/60 flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-700 flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100 text-amber-600 flex-shrink-0"><Icon name="userx" size={15} stroke={2.1} /></span>
              Showing unknown-patient / new-supplier claims on this page
            </span>
            <button onClick={() => setUnknownOnly(false)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-rose-600 whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:bg-rose-50 transition-colors flex-shrink-0">
              <Icon name="x" size={13} stroke={2.4} /> Clear filter
            </button>
          </div>
        )}

        {error ? (
          <div className="px-6 py-5">
            <div className="text-sm font-semibold text-rose-600">Couldn't load claims</div>
            <div className="text-xs text-slate-500 mt-1">{error}</div>
            <button onClick={() => setFilters((f) => ({ ...f }))} className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg btn-navy">Retry</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <colgroup>
                {COLS.map((c) => (
                  <col key={c.key} style={c.flex ? { width: '100%' } : c.width ? { width: `${c.width}px` } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  {COLS.map((c) => {
                    const sortable = !!c.sort
                    const active = sortable && sort.key === c.sort
                    return (
                      <th key={c.key} onClick={sortable ? () => onSort(c.sort) : undefined}
                          className={`th whitespace-nowrap ${c.right ? 'text-right' : ''} ${sortable ? 'cursor-pointer select-none group' : ''}`}>
                        <span className={`inline-flex items-center gap-1 font-bold ${sortable ? 'text-slate-700 group-hover:text-[#1E3A5F] transition-colors' : ''}`}>
                          {c.label}
                          {sortable && (active
                            ? <span className="text-[#1E3A5F] font-bold">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                            : <span className="text-slate-400 group-hover:text-[#1E3A5F] transition-colors">↕</span>)}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}><td colSpan={NCOLS} className="px-5 py-4"><div className="h-4 rounded bg-slate-100 animate-pulse" /></td></tr>
                  ))
                ) : sortedItems.length === 0 ? (
                  <tr><td colSpan={NCOLS} className="px-5 py-16 text-center">
                    <Icon name="doc" size={36} stroke={1.4} />
                    <div className="text-sm font-semibold text-slate-500 mt-3">No claims match your filters</div>
                    {isActive && <button onClick={clearAll} className="mt-3 text-xs font-semibold text-ink hover:underline">Clear Filters</button>}
                  </td></tr>
                ) : sortedItems.map((claim) => {
                  const reviewed = claim.reviewed || !!claim.latestAction
                  const rowCls = reviewed ? 'bg-slate-50/40' : 'hover:bg-[#F9FAFB]'
                  const status = statusFor(claim)
                  const rowPending = pending && pending.claimId === claim.id
                  return (
                    <tr key={claim.id} className={`transition-colors duration-100 ${rowCls}`}>
                      {/* Date — gray, context not primary (change 2: no left border) */}
                      <td className={`${CELL} text-xs tabular-nums whitespace-nowrap text-[#6B7280]`}>{fmtDate(claim.date)}</td>
                      {/* Patient Name — gray-900, weight 400 (violet kept for Unknown) */}
                      <td className={CELL}><span className={`text-sm font-normal ${claim.patient?.startsWith('Unknown') ? 'text-violet-600' : 'text-[#111827]'}`}>{claim.patient}</span></td>
                      {/* Supplier — three-tier color (change 5) */}
                      <td className={CELL}>
                        <button onClick={() => applySupplier(claim.supplier)} title={claim.supplier}
                                className={`text-sm text-left hover:underline w-full truncate block ${supplierTierCls(claim)}`}
                                style={{ maxWidth: '190px' }}>
                          {claim.supplier}
                        </button>
                      </td>
                      {/* Amount — gray-900, weight 500, tabular */}
                      <td className={`${CELL} text-right tabular-nums font-medium text-[#111827]`}>{fmtUSD(claim.amount, 2)}</td>
                      {/* Service Category — single muted-blue chip */}
                      <td className={CELL}><span className={CATEGORY_CHIP} style={CATEGORY_CHIP_STYLE}>{claim.category}</span></td>
                      {/* Service Description — gray-500, 13px, truncate (change 3) */}
                      <td className={`${CELL} text-[13px] font-normal text-[#6B7280]`} style={{ maxWidth: 0 }}>
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap" title={claim.description}>{claim.description}</div>
                      </td>
                      {/* Status — plain colored text, 13px */}
                      <td className={`${CELL} text-[13px] ${status.cls}`}>{status.label}</td>
                      {/* Actions */}
                      <td className={CELL}>
                        {reviewed ? (
                          <ActionedCell key={claim.actionId || claim.id} claim={claim} onUndo={doUndo} />
                        ) : (
                          <div className="flex items-center gap-2">
                            {ACTIONS.map((a) => {
                              const isThis = rowPending && pending.action === a.id
                              return (
                                <button key={a.id} onClick={() => handleAction(claim.id, a.id)} disabled={rowPending}
                                        title={a.label} aria-label={a.label}
                                        className={`w-7 h-7 rounded-lg ring-1 ring-inset transition-all duration-150 inline-flex items-center justify-center flex-shrink-0 hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${a.cls}`}>
                                  {isThis ? <Spinner /> : <Icon name={a.icon} size={15} stroke={2.4} />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {!loading && total > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-400 tabular-nums">
                  Showing <span className="font-semibold text-slate-500">{data.items.length.toLocaleString()}</span> of <span className="font-semibold text-slate-500">{total.toLocaleString()}</span> claims
                </span>
                {page < totalPages - 1 && (
                  <button onClick={() => setPage(page + 1)}
                          className="text-[11px] font-semibold text-[#1B3A5C] px-3 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer">
                    Show More <span className="text-slate-400 font-normal">+{Math.min(PAGE_SIZE, total - data.items.length)}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-white ring-1 ring-rose-200 text-rose-600 text-sm font-medium px-4 py-3 rounded-xl shadow-lg">
          <Icon name="alertTri" size={15} />{toast}
        </div>
      )}
    </div>
  )
}
