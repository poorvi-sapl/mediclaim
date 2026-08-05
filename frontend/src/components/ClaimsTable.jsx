import { useState, useEffect } from 'react'
import { getClaimsPage, postAction, getClaimActions, ACTION_TO_BACKEND, PHYSICIAN_NPI, API_BASE } from '../api'
import { Icon, fmtUSD } from './ui'

const fmtDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

// Server timestamps are naive UTC (datetime.utcnow); treat a tz-less string as UTC
// so times aren't skewed by the browser's local offset.
function parseServerTime(s) {
  if (!s) return null
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
  return new Date(hasTz ? s : s + 'Z').getTime()
}
function fmtDateTime(iso) {
  const t = parseServerTime(iso)
  if (!t) return ''
  const d = new Date(t)
  return `${fmtDate(d.toISOString().slice(0, 10))} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

// Service Category tag — light-glass pill (same recipe as the vendor
// portal's status badges), one fixed color + icon per category so
// DME/Home Health/Hospital/Drugs are visually distinct at a glance. This is
// decorative categorization, not a status signal, so it's a different token
// set from the Status column's badges. Anything not in the map (e.g. Hospice)
// falls back to the neutral .cat-other.
const CATEGORY_TAG = {
  'DME':         { cls: 'cat-dme',         icon: 'package' },
  'Home Health': { cls: 'cat-home-health', icon: 'suppliers' },
  'Hospital':    { cls: 'cat-hospital',    icon: 'hospital' },
  'Drugs':       { cls: 'cat-drugs',       icon: 'pill' },
}
function CategoryTag({ category }) {
  const meta = CATEGORY_TAG[category] || { cls: 'cat-other', icon: 'doc' }
  return (
    <span className={`cat-tag ${meta.cls}`}>
      <Icon name={meta.icon} size={11} stroke={2.2} />
      {category}
    </span>
  )
}

// The list's one row-level action, everywhere it appears (desktop table +
// mobile card): "View" (already decided) is the vendor portal's neutral
// glass button, "Take action" (still needs a decision) is its primary navy
// glass button — same .view-btn/.take-action-btn recipe defined in index.css.

// Five decisions a physician can record on a claim — rendered as the button
// grid on the Claim Detail screen's "Take action" card. UI id -> backend
// action_type mapping lives in api.js (ACTION_TO_BACKEND).
// Exported so the physician bell's filters are these same five actions rather than a
// hand-copied list of their names — rename one here and the filter renames with it.
export const ACTIONS = [
  { id: 'confirmed',     label: 'Confirm',          desc: 'Claim is legitimate — you recognize the vendor',                            accent: '#3A7D5C', icon: 'check',      cls: 'bg-[#E9F3ED] text-[#3A7D5C] ring-[#D5E9DD] hover:bg-[#DCEDE4] hover:text-[#2E6B4F]' },
  { id: 'fraud',         label: 'Report Fraud',     desc: 'This claim appears fraudulent — vendor billed for a service never provided', accent: '#A6453F', icon: 'shieldAlert', cls: 'bg-[#F7EBEA] text-[#A6453F] ring-[#EBD3D1] hover:bg-[#F2DFDD] hover:text-[#8A423D]' },
  { id: 'flagged',       label: 'Flag Vendor',      desc: 'Vendor is unknown or suspicious — raise a flag',                            accent: '#647089', icon: 'flag',       cls: 'bg-[#F1F4F9] text-[#647089] ring-[#E1E6EE] hover:bg-[#E7ECF3] hover:text-[#46586F]' },
  { id: 'unknownPatient',label: 'Reassign Patient', desc: "You don't recognize the patient on this claim",                             accent: '#93A0B3', icon: 'userx',      cls: 'bg-[#F1F4F9] text-[#93A0B3] ring-[#E1E6EE] hover:bg-[#E7ECF3] hover:text-[#647089]' },
  { id: 'deceasedPatient',label: 'Deceased Patient', desc: 'Patient is deceased — services could not have been provided',              accent: '#7A6899', icon: 'heartOff',   cls: 'bg-[#F2EEF7] text-[#7A6899] ring-[#E3DCEF] hover:bg-[#EAE3F2] hover:text-[#5F4E80]' },
]

// Tinted circle background/icon/border per action — the decision panel's icon
// options always show this tint (like a status swatch); the SELECTED option
// additionally borrows its border+card background, so picking "Confirm" turns
// green, picking "Report Fraud" turns red, etc. instead of one flat navy tone.
const ACTION_TINT = {
  confirmed:      { bg: '#E9F3ED', border: '#3A7D5C', icon: '#3A7D5C' },
  disputed:       { bg: '#FBF3E4', border: '#B08C4E', icon: '#D1A85C' },
  fraud:          { bg: '#F7EBEA', border: '#A6453F', icon: '#A6453F' },
  flagged:        { bg: '#F1F4F9', border: '#647089', icon: '#647089' },
  unknownPatient: { bg: '#F1F4F9', border: '#93A0B3', icon: '#93A0B3' },
  deceasedPatient:{ bg: '#F2EEF7', border: '#7A6899', icon: '#7A6899' },
}

function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

// ─── Undo window ────────────────────────────────────────────────────────────
// The backend (DELETE /actions/{id}) is the source of truth for the limit; this
// is the honest client-side countdown, driven by the real action record fetched
// from GET /physician/{npi}/claims/{id}/actions — no local caching needed since
// that endpoint is authoritative even after a refresh or a different session.
const UNDO_WINDOW_DEFAULT = 60
const UNDO_WINDOW_VENDOR = 86400   // 24 hours — mirrors backend vendor_notify_delay_hours

// Backend action types that open a vendor dispute case. These get the 24h undo
// window: the vendor email + case are deferred until it closes (reminder
// worker), so undoing here genuinely retracts the action before the vendor
// ever hears about it.
const VENDOR_NOTIFY_TYPES = ['dispute', 'fraud', 'deceased_patient', 'flag_supplier', 'unknown_patient']

function undoWindowFor(actionType) {
  return VENDOR_NOTIFY_TYPES.includes(actionType) ? UNDO_WINDOW_VENDOR : UNDO_WINDOW_DEFAULT
}

// Small counter-clockwise arrow used on every Undo chip.
const undoArrow = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
  </svg>
)
function secondsRemaining(createdAt, now, actionType) {
  const t = parseServerTime(createdAt)
  if (!t) return 0
  return Math.max(0, undoWindowFor(actionType) - Math.floor((now - t) / 1000))
}
function fmtRemaining(r) {
  if (r >= 3600) {
    const h = Math.floor(r / 3600)
    const m = Math.floor((r % 3600) / 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  if (r >= 60) return `${Math.floor(r / 60)}m`
  return `${r}s`
}
function undoTimerCls(r, actionType) {
  if (VENDOR_NOTIFY_TYPES.includes(actionType)) {
    if (r > 3600)  return 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200 hover:text-slate-700'
    if (r > 1800)  return 'bg-amber-50 text-amber-600 ring-amber-200 hover:bg-amber-100'
    return 'bg-rose-50 text-rose-600 ring-rose-200 hover:bg-rose-100 animate-pulse'
  }
  if (r > 30) return 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200 hover:text-slate-700'
  if (r > 10) return 'bg-amber-50 text-amber-600 ring-amber-200 hover:bg-amber-100'
  return 'bg-rose-50 text-rose-600 ring-rose-200 hover:bg-rose-100 animate-pulse'
}

// The in-row chip always counts its own visible 60s window per second,
// independent of the longer backend allowance for vendor-notify actions
// (those stay undoable from Claim Detail after the chip is gone).
function chipRemaining(createdAt, now) {
  const t = parseServerTime(createdAt)
  if (!t) return 0
  return Math.max(0, UNDO_WINDOW_DEFAULT - Math.floor((now - t) / 1000))
}

// In-row undo chip — replaces the quick-action icons on the row the user just
// actioned: the chosen action's icon with a live countdown, flipping to an
// explicit "Undo" affordance on hover. Clicking it retracts the action.
function UndoChip({ pending, now, busy, onUndo }) {
  const a = ACTIONS.find((x) => x.id === pending.uiAction) || ACTIONS[0]
  const remaining = chipRemaining(pending.createdAt, now)
  return (
    <button onClick={onUndo} disabled={busy} aria-label={`Undo ${a.label}`} title={`Undo "${a.label}"`}
            className={`group/undo h-7 px-2.5 rounded-lg ring-1 ring-inset inline-flex items-center gap-1.5 text-[11.5px] font-semibold tabular-nums transition-all duration-150 active:scale-95 ${a.cls}`}>
      {busy ? <Spinner /> : (
        <>
          <span className="inline-flex items-center gap-1.5 group-hover/undo:hidden">
            <Icon name={a.icon} size={13} stroke={2.4} />
            {remaining}s
          </span>
          <span className="hidden group-hover/undo:inline-flex items-center gap-1.5">
            {undoArrow}
            Undo
          </span>
        </>
      )}
    </button>
  )
}

// Subtle soft-green chip — no border, not a heavy badge.
const actionedBadge = (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium"
        style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
    <Icon name="check" size={12} stroke={2.5} /> Actioned
  </span>
)

// Status pill — used on the Claim Detail header, next to the claim number.
function statusFor(claim) {
  const act = claim.latestAction
  if (act === 'confirm') return { label: 'Confirmed', cls: 'bg-emerald-50 text-emerald-600' }
  if (act === 'dispute') return { label: 'Disputed', cls: 'bg-violet-50 text-violet-600' }
  if (act === 'unknown_patient') return { label: 'Unknown Patient', cls: 'bg-slate-100 text-slate-500' }
  if (act === 'deceased_patient') return { label: 'Deceased Patient', cls: 'bg-[#F2EEF7] text-[#7A6899] font-semibold' }
  if (act === 'fraud') return { label: 'Fraud Reported', cls: 'bg-rose-100 text-rose-700 font-bold' }
  if (act) return { label: 'Flagged', cls: 'bg-rose-50 text-rose-600 font-semibold' }   // flag_supplier / did_not_order
  if (claim.reviewed) return { label: 'Reviewed', cls: 'bg-slate-100 text-slate-500' }
  return { label: 'Unreviewed', cls: 'bg-slate-100 text-slate-500' }
}

// Supplier name — bold link-blue, matches the Claim ID/Amount emphasis treatment.
const SUPPLIER_NAME_CLS = 'font-semibold text-[#1B3A5C]'

// claims-table cell padding — 8px/14px on every cell (header + body), matching
// the vendor portal's claims table (table.vclaims) row height exactly. Local
// so the shared .td (px-5 py-4) used by other tables is untouched.
const CELL = 'py-2 px-3.5 align-middle'
const THEAD_TH = 'text-left py-2.5 px-3.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-slate-400 bg-slate-50 border-b border-slate-100 whitespace-nowrap'
// Column order. `sort` = client-side sort key (omitted = not sortable). No
// explicit widths — the table lays out by content, and Amount is the only
// right-aligned column (numbers align right by convention; everything else
// stays left-aligned). A row click (or the trailing button) opens the Claim
// Detail screen — the list itself no longer carries the review actions inline.
const COLS = [
  { key: 'ccn', label: 'Claim' },   // not sortable — CCN sort has no meaningful order
  { key: 'supplier', label: 'Vendor', sort: 'supplier' },
  { key: 'date', label: 'DOS', sort: 'date' },
  { key: 'category', label: 'Service Category', sort: 'category' },
  { key: 'actions', label: '' },   // not sortable
]
const NCOLS = COLS.length

// ─── client-side sort (change 7) ─────────────────────────────────────────────
const parseMs = (d) => { const t = Date.parse(d); return Number.isNaN(t) ? 0 : t }
const CLAIM_COMPARATORS = {
  date: (a, b) => parseMs(a.date) - parseMs(b.date),
  supplier: (a, b) => (a.supplier || '').localeCompare(b.supplier || ''),
  amount: (a, b) => (a.amount || 0) - (b.amount || 0),
  category: (a, b) => (a.category || '').localeCompare(b.category || ''),
}

// My Claims is a pure unreviewed queue — the backend query is
// reviewed:'unreviewed', never a `filters` field. The one exception is an
// active vendor filter (supFilter, from the dashboard watchlist / Flagged
// Suppliers hand-off): that view is "this vendor's claims under my NPI", and
// the flagged claims that put the vendor on the watchlist are by definition
// already reviewed — an unreviewed-only list would always come up empty. So
// with supFilter set the query widens to reviewed:'all' and reviewed rows
// render in their greyed row state.
const CLEARED = { category: 'All Categories', dateFrom: '', dateTo: '', supplier: '', claimSearch: '' }
const DEFAULT_FILTERS = CLEARED
const inputCls = 'bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-600 outline-none cursor-pointer transition-colors hover:border-slate-300 focus:border-ink focus:ring-2 focus:ring-ink/15'

export default function ClaimsTable({ npi = PHYSICIAN_NPI, onActioned, onSelectClaim, supplierFilter: incomingSupplier = null, onSupplierFilterChange, externalSearch = null }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [debouncedSupplier, setDebouncedSupplier] = useState('')
  const [debouncedClaimSearch, setDebouncedClaimSearch] = useState('')
  const [data, setData] = useState({ items: [], total: 0, page: 0, totalPages: 0, totalCount: 0, flaggedCount: 0, confirmedCount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [supFilter, setSupFilter] = useState(incomingSupplier)   // active supplier filter (exact name)
  const [supSummary, setSupSummary] = useState(null)             // { claims, patients, billed }
  const [unknownOnly, setUnknownOnly] = useState(false)          // dashboard "Unknown Suppliers" intent
  const [sort, setSort] = useState({ key: null, dir: null })     // client-side column sort (null = default)
  const [rowPending, setRowPending] = useState(null)              // { claimId, action } — quick-action button mid-flight
  const [actionError, setActionError] = useState(null)            // transient row-action failure message
  const [pendingUndos, setPendingUndos] = useState({})            // claimId -> { actionId, uiAction, backendType, createdAt } — actioned, still undoable in place
  const [undoNow, setUndoNow] = useState(() => Date.now())        // shared countdown clock for the in-row undo chips
  const [undoBusy, setUndoBusy] = useState(null)                  // claimId of an undo DELETE in flight

  // asc → desc → cleared. A different column starts fresh at asc.
  function onSort(key) {
    setSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }
  const resetSort = () => setSort({ key: null, dir: null })

  // One-tap decision straight from the list (the 5 quick-action icons) — same
  // ACTIONS/postAction recipe the Claim Detail decision panel uses, just
  // without the "add context" note. In the unreviewed queue an actioned claim
  // drops out of `data.items`; in the vendor-filtered view (which shows
  // reviewed claims too) it flips to its reviewed row state instead.
  // Applies an actioned claim's final list state once its in-row undo chip
  // expires (or an undo attempt fails): drop out of the unreviewed queue, or
  // flip to the reviewed row state in the vendor-filtered view.
  function finalizeRowAction(claimId, backendType) {
    setData((d) => ({
      ...d,
      items: supFilter
        ? d.items.map((c) => (c.id === claimId ? { ...c, reviewed: true, latestAction: backendType } : c))
        : d.items.filter((c) => c.id !== claimId),
    }))
  }

  async function handleRowAction(claimId, action) {
    setRowPending({ claimId, action })
    try {
      const res = await postAction(claimId, npi, action)
      const backendType = ACTION_TO_BACKEND[action] || action
      if (res?.id) {
        // Keep the row in place: the actioned icon becomes a countdown undo
        // chip, and the row only leaves the queue once the chip expires.
        setPendingUndos((m) => ({ ...m, [claimId]: {
          actionId: res.id, uiAction: action, backendType,
          createdAt: res.created_at || new Date().toISOString(),
        } }))
      } else {
        finalizeRowAction(claimId, backendType)
      }
      onActioned?.()
    } catch (e) {
      setActionError(e.message || 'Could not record action. Please try again.')
      setTimeout(() => setActionError(null), 3500)
    } finally {
      setRowPending(null)
    }
  }

  // In-row undo chips — same authoritative DELETE /actions/{id} the Claim
  // Detail undo chip uses, shown as a 60s countdown on the actioned row's own
  // icon. Vendor-notify actions stay undoable longer from Claim Detail; the
  // chip is only the immediate window.
  const undoRemaining = (p) => chipRemaining(p.createdAt, undoNow)
  const hasPendingUndos = Object.keys(pendingUndos).length > 0

  useEffect(() => {
    if (!hasPendingUndos) return
    setUndoNow(Date.now())
    const id = setInterval(() => setUndoNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasPendingUndos])

  // Expired chips → apply the row's final state and drop the chip.
  useEffect(() => {
    if (!hasPendingUndos) return
    const expired = Object.entries(pendingUndos).filter(([, p]) => undoRemaining(p) <= 0)
    if (expired.length === 0) return
    expired.forEach(([claimId, p]) => finalizeRowAction(claimId, p.backendType))
    setPendingUndos((m) => {
      const next = { ...m }
      expired.forEach(([claimId]) => delete next[claimId])
      return next
    })
  }, [undoNow])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUndoRow(claimId) {
    const p = pendingUndos[claimId]
    if (!p || undoBusy) return
    setUndoBusy(claimId)
    try {
      const r = await fetch(`${API_BASE}/actions/${p.actionId}`, { method: 'DELETE', credentials: 'include' })
      if (!r.ok) throw new Error('The undo window for this action has expired.')
      setPendingUndos((m) => { const next = { ...m }; delete next[claimId]; return next })
      onActioned?.()
    } catch (e) {
      setActionError(e.message || 'Could not undo. Please try again.')
      setTimeout(() => setActionError(null), 3500)
      setPendingUndos((m) => { const next = { ...m }; delete next[claimId]; return next })
      finalizeRowAction(claimId, p.backendType)
    } finally {
      setUndoBusy(null)
    }
  }

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
    setSupFilter(intent.supplier || null); onSupplierFilterChange?.(intent.supplier || null)
    setUnknownOnly(!!intent.unknownOnly)
    setFilters({ ...CLEARED, dateFrom: intent.dateFrom || '', dateTo: intent.dateTo || '' })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSupplier(filters.supplier), 300)
    return () => clearTimeout(t)
  }, [filters.supplier])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedClaimSearch(filters.claimSearch), 300)
    return () => clearTimeout(t)
  }, [filters.claimSearch])

  // A supplier picked on the Flagged Suppliers screen arrives via props -> apply it.
  // Widens the queue to reviewed:'all' (see CLEARED comment above) so the
  // vendor's flagged claims are actually visible.
  useEffect(() => {
    if (incomingSupplier) setSupFilter(incomingSupplier)
  }, [incomingSupplier])

  // The navbar search box (Shell) feeds the same claimSearch filter the local
  // filter bar uses — one-way navbar -> table, reusing the debounce above.
  useEffect(() => {
    if (externalSearch == null) return
    setFilters((f) => (f.claimSearch === externalSearch ? f : { ...f, claimSearch: externalSearch }))
  }, [externalSearch])

  function clearSupplier() {
    resetSort()
    setSupFilter(null)
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
            reviewed: 'all', supplierSearch: supFilter,
          })
          res.items.forEach((c) => { names.add(c.patient); billed += c.amount || 0 })
          claims = res.total; totalPages = res.totalPages; pageN += 1
        } while (pageN < totalPages && !cancelled)
        if (!cancelled) setSupSummary({ claims, patients: names.size, billed })
      } catch { if (!cancelled) setSupSummary(null) }
    })()
    return () => { cancelled = true }
  }, [supFilter, npi, filters.category, filters.dateFrom, filters.dateTo])

  // Loads every matching claim up front (paging internally at the API's max
  // page size) instead of a "Show More" button — same as the vendor portal's
  // claims table, which fetches its whole list in one go and just lets the
  // page scroll. Renders progressively as each page lands so a large result
  // set still shows something immediately rather than one long spinner.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      let pageN = 0, totalPages = 1, allItems = []
      try {
        do {
          const res = await getClaimsPage(npi, {
            page: pageN, pageSize: 100,
            category: filters.category, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
            reviewed: supFilter ? 'all' : 'unreviewed', supplierSearch: supFilter || debouncedSupplier,
            claimSearch: debouncedClaimSearch,
          })
          if (cancelled) return
          allItems = [...allItems, ...res.items]
          setData({ ...res, items: allItems })
          setLoading(false)
          totalPages = res.totalPages
          pageN += 1
        } while (pageN < totalPages && !cancelled)
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [npi, filters.category, filters.dateFrom, filters.dateTo, debouncedSupplier, debouncedClaimSearch, supFilter])

  function clearAll() { resetSort(); setUnknownOnly(false); setFilters(CLEARED); setDebouncedSupplier(''); setDebouncedClaimSearch('') }

  const isActive = filters.category !== CLEARED.category || filters.dateFrom || filters.dateTo ||
    filters.supplier || filters.claimSearch

  const { items, total, totalCount } = data
  // Belt-and-suspenders on top of the backend's reviewed=false filter: some
  // claims carry a latest_action (fraud/dispute/etc.) while Claim.reviewed is
  // still false in the data, so a pure server-side filter alone can leak an
  // already-decided claim back into this unreviewed queue. Drop those here too
  // — except in the vendor-filtered view, where reviewed claims are the point.
  const unreviewedItems = supFilter ? items : items.filter((c) => !c.reviewed && !c.latestAction)
  // "Unknown Suppliers Detected" card: client-side narrow to claims from an
  // unfamiliar supplier (no backend filter exists for this; honest best-effort).
  // Only the unknownSupplier flag applies here — an actual unknown_patient
  // action means the claim's already been decided, so unreviewedItems above
  // already excludes it.
  const displayItems = unknownOnly
    ? unreviewedItems.filter((c) => c.unknownSupplier)
    : unreviewedItems
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
    <div className="w-full h-full flex flex-col px-4 sm:px-7 py-4 sm:py-7 min-h-0">
      <div className="mc-card flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Active supplier filter indicator + patient summary */}
        {supFilter && (
          <>
            <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-[#1B3A5C]/[0.06] to-transparent flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-700 flex items-center gap-2 sm:gap-2.5 min-w-0">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#1B3A5C]/10 text-[#1B3A5C] flex-shrink-0"><Icon name="suppliers" size={15} stroke={2.1} /></span>
                <span className="hidden sm:inline whitespace-nowrap text-slate-500">Showing claims for</span>
                <span className="font-bold text-[#1B3A5C] truncate max-w-[160px] sm:max-w-none">{supFilter}</span>
              </span>
              <button onClick={clearSupplier}
                      className="group flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:bg-rose-50 transition-colors flex-shrink-0">
                <Icon name="x" size={13} stroke={2.4} /> Clear
              </button>
            </div>
            {supSummary && (
              <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                {supSummary.claims.toLocaleString()} claims · {supSummary.patients.toLocaleString()} unique patient{supSummary.patients !== 1 ? 's' : ''} · {fmtUSD(supSummary.billed)} total billed by this vendor under your NPI
              </div>
            )}
          </>
        )}

        {unknownOnly && (
          <div className="px-5 py-3 border-b border-slate-100 bg-amber-50/60 flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-700 flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100 text-amber-600 flex-shrink-0"><Icon name="userx" size={15} stroke={2.1} /></span>
              Showing unknown-patient / new-vendor claims on this page
            </span>
            <button onClick={() => setUnknownOnly(false)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-rose-600 whitespace-nowrap rounded-lg px-2.5 py-1.5 hover:bg-rose-50 transition-colors flex-shrink-0">
              <Icon name="x" size={13} stroke={2.4} /> Clear filter
            </button>
          </div>
        )}

        {actionError && (
          <div className="px-4 sm:px-5 py-2 border-b border-rose-100 bg-rose-50 flex items-center justify-between gap-3 text-[12.5px] text-rose-600">
            {actionError}
            <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-600 flex-shrink-0"><Icon name="x" size={12} stroke={2.4} /></button>
          </div>
        )}

        {error ? (
          <div className="px-5 py-5">
            <div className="text-sm font-semibold text-rose-600">Couldn't load claims</div>
            <div className="text-xs text-slate-500 mt-1">{error}</div>
            <button onClick={() => setFilters((f) => ({ ...f }))} className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg btn-navy">Retry</button>
          </div>
        ) : (
          <>
          {/* ── Mobile card view (< sm) ── */}
          <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-3 space-y-2">
                  <div className="h-3 rounded bg-slate-100 animate-pulse w-1/3" />
                  <div className="h-4 rounded bg-slate-100 animate-pulse w-3/4" />
                  <div className="h-3 rounded bg-slate-100 animate-pulse w-1/2" />
                </div>
              ))
            ) : sortedItems.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Icon name="doc" size={32} stroke={1.4} />
                <div className="text-sm font-semibold text-slate-500 mt-3">No claims match your filters</div>
                {isActive && <button onClick={clearAll} className="mt-3 text-xs font-semibold text-ink hover:underline">Clear Filters</button>}
              </div>
            ) : sortedItems.map((claim) => {
              const reviewed = claim.reviewed || !!claim.latestAction
              return (
                <div key={claim.id} onClick={() => onSelectClaim?.(claim)}
                     className={`px-3.5 py-2.5 cursor-pointer text-[13px] ${reviewed ? 'bg-slate-50/40' : ''}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <span className="text-[11px] font-mono font-semibold text-[#111827] tabular-nums">{claim.ccn}</span>
                      <span className="ml-2 text-[11px] text-slate-400 tabular-nums">{fmtDate(claim.date)}</span>
                    </div>
                  </div>
                  <span title={claim.supplier}
                        className={`text-xs text-left truncate block w-full mb-1.5 ${SUPPLIER_NAME_CLS}`}>
                    {claim.supplier}
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <CategoryTag category={claim.category} />
                    {pendingUndos[claim.id] ? (
                      <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <UndoChip pending={pendingUndos[claim.id]} now={undoNow}
                                  busy={undoBusy === claim.id} onUndo={() => handleUndoRow(claim.id)} />
                      </div>
                    ) : reviewed ? (
                      <button onClick={(e) => { e.stopPropagation(); onSelectClaim?.(claim) }} className="view-btn">View →</button>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {ACTIONS.map((a) => {
                          const isThis = rowPending?.claimId === claim.id && rowPending.action === a.id
                          return (
                            <button key={a.id} onClick={() => handleRowAction(claim.id, a.id)} disabled={!!rowPending}
                                    title={a.desc} aria-label={a.label}
                                    className={`w-7 h-7 rounded-lg ring-1 ring-inset transition-all duration-150 inline-flex items-center justify-center flex-shrink-0 active:scale-95 disabled:opacity-40 ${a.cls}`}>
                              {isThis ? <Spinner /> : <Icon name={a.icon} size={14} stroke={2.4} />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Desktop table view (sm+) ── */}
          <div className="hidden sm:block flex-1 min-h-0 overflow-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 700 }}>
              <thead className="sticky top-0 z-10">
                <tr>
                  {COLS.map((c) => {
                    const sortable = !!c.sort
                    const active = sortable && sort.key === c.sort
                    return (
                      <th key={c.key} onClick={sortable ? () => onSort(c.sort) : undefined}
                          className={`${THEAD_TH} ${c.right ? 'text-right' : ''} ${sortable ? 'cursor-pointer select-none group' : ''}`}>
                        <span className={`inline-flex items-center gap-1 ${sortable ? 'group-hover:text-[#1E3A5F] transition-colors' : ''}`}>
                          {c.label}
                          {sortable && (active
                            ? <span className="text-[#1E3A5F] font-bold">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                            : <span className="text-slate-300 group-hover:text-[#1E3A5F] transition-colors">↕</span>)}
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
                  return (
                    <tr key={claim.id} onClick={() => onSelectClaim?.(claim)}
                        className={`cursor-pointer transition-colors duration-100 ${rowCls}`}>
                      {/* Claim — short CMS-style CCN, not the internal UUID */}
                      <td className={`${CELL} text-sm font-mono font-semibold tabular-nums whitespace-nowrap text-[#111827]`}>{claim.ccn}</td>
                      {/* Supplier — plain body text */}
                      <td className={CELL}>
                        <span title={claim.supplier}
                              className={`text-sm text-left w-full truncate block ${SUPPLIER_NAME_CLS}`}
                              style={{ maxWidth: '190px' }}>
                          {claim.supplier}
                        </span>
                      </td>
                      {/* Date — gray, context not primary */}
                      <td className={`${CELL} text-xs tabular-nums whitespace-nowrap text-[#6B7280]`}>{fmtDate(claim.date)}</td>
                      {/* Service Category — light-glass pill, one fixed color + icon per category */}
                      <td className={CELL}><CategoryTag category={claim.category} /></td>
                      {/* Row action — quick 5-action icons for an unreviewed claim
                          (one-tap decision, no need to open Claim Detail); a
                          reviewed claim still links through to the full record. */}
                      <td className={`${CELL} text-right`} onClick={(e) => e.stopPropagation()}>
                        {pendingUndos[claim.id] ? (
                          <div className="flex justify-end">
                            <UndoChip pending={pendingUndos[claim.id]} now={undoNow}
                                      busy={undoBusy === claim.id} onUndo={() => handleUndoRow(claim.id)} />
                          </div>
                        ) : reviewed ? (
                          <div className="flex justify-end">
                            <button onClick={() => onSelectClaim?.(claim)} className="view-btn">View →</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            {ACTIONS.map((a) => {
                              const isThis = rowPending?.claimId === claim.id && rowPending.action === a.id
                              const tint = ACTION_TINT[a.id]
                              return (
                                <div key={a.id} className="relative group/act">
                                  <button onClick={() => handleRowAction(claim.id, a.id)} disabled={!!rowPending}
                                          aria-label={a.label}
                                          className={`w-7 h-7 rounded-lg ring-1 ring-inset transition-all duration-150 inline-flex items-center justify-center flex-shrink-0 hover:-translate-y-0.5 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${a.cls}`}>
                                    {isThis ? <Spinner /> : <Icon name={a.icon} size={15} stroke={2.4} />}
                                  </button>
                                  {/* Tooltip — same tone as its button (replaces the browser's black title popup) */}
                                  <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 z-30 w-max max-w-[210px] rounded-lg px-2.5 py-1.5 text-left opacity-0 translate-y-0.5 transition-all duration-100 group-hover/act:opacity-100 group-hover/act:translate-y-0"
                                       style={{ background: tint.bg, border: `1px solid ${tint.border}`, boxShadow: '0 6px 16px rgba(15,23,42,.12)' }}>
                                    <div className="text-[11px] font-bold whitespace-nowrap" style={{ color: tint.icon }}>{a.label}</div>
                                    <div className="text-[10.5px] leading-snug mt-0.5" style={{ color: tint.icon, opacity: .8 }}>{a.desc}</div>
                                  </div>
                                </div>
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

          </div>
          </>
        )}
      </div>

    </div>
  )
}

// ─── Claim Detail ───────────────────────────────────────────────────────────
// Full click-through screen for a single claim — replaces the old inline
// per-row action icons. Shows what the row already told you (claim/status),
// what it didn't (patient, full service, timeline of what's happened so far),
// and — while still undecided — the one decision to make on it.

// Privacy-masked patient display ("John Smith" -> "J*** S***") — every other
// claim-notification surface in the app (vendor/payer dispute views) shows a
// partially-masked patient name; this matches that convention.
function maskPatientName(name) {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return `${(parts[0][0] || '').toUpperCase()}.`
  return `${(parts[0][0] || '').toUpperCase()}. ${parts.slice(1).join(' ')}`
}

const DECISION_LABEL = {
  confirm: 'Confirmed',
  dispute: 'Disputed',
  fraud: 'Reported fraud',
  flag_supplier: 'Flagged vendor',
  unknown_patient: 'Reassigned patient',
  deceased_patient: 'Marked patient deceased',
  did_not_order: 'Reported did-not-order',
}

function ClaimTimeline({ claim, actions }) {
  const submittedAt = claim.createdAt || claim.date
  const rows = [{ label: 'Claim submitted by vendor', at: submittedAt }]
  if (actions.length === 0) {
    rows.push({ label: 'Awaiting your review', at: submittedAt, detail: 'This claim was filed under your NPI and needs a decision.' })
  } else {
    actions.forEach((a) => rows.push({ label: DECISION_LABEL[a.actionType] || a.actionType, at: a.createdAt, note: a.note }))
  }
  return (
    <div>
      {rows.map((t, i) => {
        const isLast = i === rows.length - 1
        return (
          <div key={i} className="flex gap-3.5" style={{ marginBottom: isLast ? 0 : 14 }}>
            <div className="flex flex-col items-center flex-shrink-0 pt-1" style={{ width: 12 }}>
              <div className="rounded-full flex-shrink-0" style={{ width: 12, height: 12, background: isLast ? '#0A1F3D' : '#5B84C4' }} />
              {!isLast && <div className="mt-1" style={{ width: 2, flex: 1, background: '#E1E6EE' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-semibold text-slate-400 mb-1.5">{fmtDateTime(t.at)}</div>
              <div className="rounded-[10px] border border-slate-100 bg-slate-50 px-3.5 py-3">
                <div className="text-[13px] font-bold text-slate-900">{t.label}</div>
                {t.detail && <p className="text-[12px] text-slate-500 mt-1">{t.detail}</p>}
                {t.note && <p className="text-[12px] text-slate-500 italic mt-1">"{t.note}"</p>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ClaimDetailScreen({ claim, npi = PHYSICIAN_NPI, onActioned }) {
  const [localClaim, setLocalClaim] = useState(claim)
  const [actions, setActions] = useState([])
  const [loadingActions, setLoadingActions] = useState(true)
  const [selectedAction, setSelectedAction] = useState(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [supplierStats, setSupplierStats] = useState(null)         // { totalCount, confirmedCount, flaggedCount, fraudCount }
  const [supplierStatsLoading, setSupplierStatsLoading] = useState(true)

  useEffect(() => { setLocalClaim(claim); setSelectedAction(null); setNote(''); setSubmitError(null) }, [claim?.id])

  useEffect(() => {
    if (!claim?.id) return
    let cancelled = false
    setLoadingActions(true)
    getClaimActions(npi, claim.id)
      .then((rows) => { if (!cancelled) setActions(rows) })
      .catch(() => { if (!cancelled) setActions([]) })
      .finally(() => { if (!cancelled) setLoadingActions(false) })
    return () => { cancelled = true }
  }, [claim?.id, npi])

  // Supplier snapshot — every claim this exact supplier has under this NPI
  // (any review status), tallied client-side same as the claims list's own
  // per-supplier summary (no backend aggregate respects supplier_search).
  useEffect(() => {
    const supplierName = claim?.supplier
    if (!supplierName) { setSupplierStats(null); setSupplierStatsLoading(false); return }
    let cancelled = false
    setSupplierStatsLoading(true)
    ;(async () => {
      let pageN = 0, totalPages = 1, totalCount = 0, confirmedCount = 0, flaggedCount = 0, fraudCount = 0
      try {
        do {
          const res = await getClaimsPage(npi, { page: pageN, pageSize: 100, supplierSearch: supplierName })
          if (cancelled) return
          totalCount = res.total
          res.items.forEach((c) => {
            if (c.latestAction === 'confirm') confirmedCount += 1
            if (c.latestAction === 'fraud') fraudCount += 1
            if (c.hasRuleFlag) flaggedCount += 1
          })
          totalPages = res.totalPages
          pageN += 1
        } while (pageN < totalPages && !cancelled)
        if (!cancelled) setSupplierStats({ totalCount, confirmedCount, flaggedCount, fraudCount })
      } catch { if (!cancelled) setSupplierStats(null) }
      finally { if (!cancelled) setSupplierStatsLoading(false) }
    })()
    return () => { cancelled = true }
  }, [claim?.supplier, npi])

  const latest = actions[actions.length - 1] || null
  const remaining = latest ? secondsRemaining(latest.createdAt, now, latest.actionType) : 0
  const canUndo = !!latest && remaining > 0

  useEffect(() => {
    if (!canUndo) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [canUndo])

  if (!claim) return <div className="px-7 py-8 text-slate-400">No claim selected.</div>

  const reviewed = localClaim.reviewed || !!localClaim.latestAction
  const status = statusFor(localClaim)
  const receivedAt = localClaim.createdAt
  const daysAgo = receivedAt ? Math.floor((Date.now() - (parseServerTime(receivedAt) || 0)) / 86400000) : null
  const daysAgoLabel = daysAgo == null ? '' : daysAgo <= 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`

  const confirmedRate = supplierStats && supplierStats.totalCount > 0
    ? ((supplierStats.confirmedCount / supplierStats.totalCount) * 100).toFixed(1)
    : null
  // Plain computed sentence from the stats above — not a fabricated AI output.
  const supplierInsightText = supplierStats && supplierStats.totalCount > 0
    ? `${localClaim.supplier} has ${supplierStats.confirmedCount} of ${supplierStats.totalCount} claims confirmed under your NPI, ${
        supplierStats.fraudCount > 0
          ? `with ${supplierStats.fraudCount} prior fraud report${supplierStats.fraudCount === 1 ? '' : 's'}`
          : 'no prior fraud reports'
      }.`
    : null

  async function submitDecision() {
    if (!selectedAction) return
    setSubmitting(true); setSubmitError(null)
    try {
      const res = await postAction(localClaim.id, npi, selectedAction, note.trim() || null)
      const backendType = ACTION_TO_BACKEND[selectedAction] || selectedAction
      setLocalClaim((c) => ({ ...c, reviewed: true, latestAction: backendType }))
      setActions((a) => [...a, { id: res?.id, actionType: backendType, note: note.trim(), createdAt: res?.created_at || new Date().toISOString() }])
      setSelectedAction(null); setNote('')
      onActioned?.()
    } catch (e) {
      setSubmitError(e.message || 'Could not record your decision. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUndo() {
    if (!latest?.id) return
    setSubmitting(true)
    try {
      const r = await fetch(`${API_BASE}/actions/${latest.id}`, { method: 'DELETE', credentials: 'include' })
      if (r.ok) {
        setActions((a) => a.slice(0, -1))
        setLocalClaim((c) => ({ ...c, reviewed: false, latestAction: null }))
        onActioned?.()
      }
    } catch { /* leave the banner up — the countdown will just expire */ }
    finally { setSubmitting(false) }
  }

  const decisionPanel = !reviewed ? (
    <>
      <div className="flex items-center gap-2.5 mb-3.5">
        <span className="w-[22px] h-[22px] rounded-full bg-[#0A1F3D] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">1</span>
        <span className="text-[13.5px] font-bold text-slate-900">Choose your decision</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map((a) => {
          const tint = ACTION_TINT[a.id]
          const selected = selectedAction === a.id
          return (
            <button key={a.id} onClick={() => setSelectedAction(a.id)} title={a.desc}
                    className={`rounded-xl border-[1.5px] py-3.5 px-2 text-center transition-colors cursor-pointer ${selected ? '' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                    style={selected ? { borderColor: tint.border, background: tint.bg } : undefined}>
              <span className="w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-2" style={{ background: tint.bg }}>
                <Icon name={a.icon} size={15} style={{ color: tint.icon }} />
              </span>
              <span className="text-[11.5px] font-bold text-slate-800">{a.label}</span>
            </button>
          )
        })}
      </div>

      <div className="h-px bg-slate-100 my-4" />

      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[22px] h-[22px] rounded-full bg-[#0A1F3D] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">2</span>
        <span className="text-[13.5px] font-bold text-slate-900">Add context (optional)</span>
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add any context for this decision…"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-700 outline-none focus:border-ink focus:ring-2 focus:ring-ink/15 resize-y" />

      {submitError && <div className="mt-3 text-[12.5px] text-rose-600">{submitError}</div>}

      <button onClick={submitDecision} disabled={!selectedAction || submitting}
              className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-white rounded-xl px-4 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#1B3A5C' }}>
        {submitting && <Spinner />} Submit decision →
      </button>
    </>
  ) : (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {actionedBadge}
        <span className="text-[13px] text-slate-500">Recorded as {status.label}</span>
      </div>
      {canUndo && (
        <button onClick={handleUndo} disabled={submitting}
                className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold ring-1 ring-inset transition-all duration-150 ${undoTimerCls(remaining, latest.actionType)}`}>
          {submitting ? <Spinner /> : undoArrow}
          Undo · {fmtRemaining(remaining)}
        </button>
      )}
    </>
  )

  return (
    <div className="h-full flex flex-col min-h-0 px-4 sm:px-7 py-5 gap-4">
      {/* Header — claim card + supplier snapshot, side by side */}
      <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        <div className="mc-card p-5">
          <h2 className="text-[17px] font-bold text-slate-900 mb-2.5">Claim {localClaim.ccn}</h2>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold ${status.cls}`}>{status.label}</span>
          {receivedAt && (
            <div className="text-[12px] text-slate-400 mt-3">Received {fmtDate(String(receivedAt).slice(0, 10))} · {daysAgoLabel}</div>
          )}
        </div>

        <div className="mc-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
              <Icon name="suppliers" size={16} stroke={1.8} />
            </span>
            <div className="min-w-0">
              <div className="font-bold text-[14px] text-slate-900 truncate">{localClaim.supplier}</div>
              <div className="text-[11px] text-slate-400">Vendor snapshot</div>
            </div>
          </div>
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              <div className="text-[19px] font-extrabold text-slate-900 tabular-nums">{supplierStatsLoading ? '—' : (supplierStats?.totalCount ?? '—')}</div>
              <div className="text-[10.5px] text-slate-400 mt-1">Total claims</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[19px] font-extrabold text-emerald-600 tabular-nums">{confirmedRate != null ? `${confirmedRate}%` : '—'}</div>
              <div className="text-[10.5px] text-slate-400 mt-1">Confirmed</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[19px] font-extrabold text-slate-900 tabular-nums">{supplierStatsLoading ? '—' : (supplierStats?.flaggedCount ?? '—')}</div>
              <div className="text-[10.5px] text-slate-400 mt-1">Flagged</div>
            </div>
          </div>
        </div>
      </div>

      {/* Supplier insight — a plain sentence computed from the snapshot above, not a fabricated AI output */}
      {supplierInsightText && (
        <div className="flex-shrink-0 rounded-2xl p-4 sm:p-5 flex gap-3.5 items-start"
             style={{ background: 'linear-gradient(180deg, #EAF1F5, #fff 65%)' }}>
          <span className="w-8 h-8 rounded-[10px] flex-shrink-0 flex items-center justify-center"
                style={{ background: 'linear-gradient(180deg,#3E7FA6,#2E6B8F)' }}>
            <Icon name="sparkle" size={15} className="text-white" />
          </span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#2E6B8F] mb-1">Vendor Insight</div>
            <div className="text-[13px] text-slate-700 leading-relaxed">{supplierInsightText}</div>
          </div>
        </div>
      )}

      {/* Claim Details + Timeline (left) alongside the decision panel (right,
          height-matched to the left column). The Timeline absorbs the
          remaining height and scrolls internally (long multi-action
          histories don't push the page down), so the whole screen stays one
          fixed page — same idea as before, just restored to the reference's
          two-column shape instead of a single vertical stack. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-stretch">
        <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
          {/* Claim details */}
          <div className="mc-card p-5 lg:shrink-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3.5">Claim Details</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
              {[
                ['Patient', maskPatientName(localClaim.patient)],
                ['Service', localClaim.description || '—'],
                ['Service Category', localClaim.category || '—'],
                ['DOS', fmtDate(localClaim.date)],
                ['Vendor', localClaim.supplierNpi ? `${localClaim.supplier} — NPI ${localClaim.supplierNpi}` : localClaim.supplier],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</div>
                  <div className="font-medium text-slate-800 truncate" title={value}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div className="mc-card p-5 lg:flex-1 lg:min-h-0 flex flex-col overflow-hidden">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3.5 flex-shrink-0">Timeline</div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              {loadingActions ? (
                <div className="text-[12px] text-slate-400">Loading…</div>
              ) : (
                <ClaimTimeline claim={localClaim} actions={actions} />
              )}
            </div>
          </div>
        </div>

        {/* Decision panel */}
        <div className="mc-card p-5 lg:h-full lg:min-h-0 overflow-y-auto">
          {decisionPanel}
        </div>
      </div>
    </div>
  )
}
