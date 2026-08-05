import { useState, useEffect, useRef, useMemo } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, useOutletContext, Outlet } from 'react-router-dom'
import VendorDisputePage from './vendor/VendorDisputePage'
import VendorPortalInner from './vendor/VendorPortalInner'
import { AlertsProvider } from './context/AlertsContext'
import { useAuth, DASHBOARD_PATH } from './context/AuthContext'
import Shell from './components/Shell'
import Login from './screens/Login'
import LandingPage from './screens/LandingPage'
import MfaSetup from './screens/MfaSetup'
import MfaBackupCodes from './screens/MfaBackupCodes'
import OtpLogin from './screens/OtpLogin'
import Register from './screens/Register'
import { Icon, StatCard, fmtUSD, fmtDate, timeAgo, normalizeSearchQuery, buildDisputeTimeline, COMPLIANCE_ACTION_LABEL, PFilterTh } from './components/ui'
import PlanHome from './plan/screens/PlanHome'
import NPILeaderboard, { AllPhysicians } from './plan/screens/NPILeaderboard'
import NPIDetail from './plan/screens/NPIDetail'
import SupplierWatchlist, { AllVendors } from './plan/screens/SupplierWatchlist'
import SupplierDetail from './plan/screens/SupplierDetail'
import RulesCatalog from './plan/screens/RulesCatalog'
import SummaryCardSkeleton from './components/SummaryCardSkeleton'
import AssistantWidget from './components/AssistantWidget'
import { PHYSICIAN_NPI, getPhysician, getNotificationsCount, markNotificationsSeen, getNpiWatchNotifications, getNpiWatchStats, getPhysicianBellNotifications, getPlanDisputes, getPlanNotifications, confirmDisputeResolution, decideDisputeClaim, subscribeDisputeStream, submitComplianceAction, getSupplierById, API_BASE } from './api'
import { PhysicianPortal, PhysDashboardScreen, PhysClaimsScreen, PhysClaimDetailScreen, PhysDisputesScreen, PhysDisputeDetailScreen } from './physician/PhysicianPortal'

const PLAN_NAV = [
  { id: 'home', label: 'Dashboard', icon: 'dashboard' },
  { id: 'leaderboard', label: 'Physician Leaderboard', icon: 'leaderboard' },
  { id: 'watchlist', label: 'Vendor Watchlist', icon: 'suppliers' },
  { id: 'rules', label: 'Detection Console', icon: 'shieldAlert' },
  { id: 'disputes', label: 'NPI Disputes', icon: 'alertTri' },
]
const PLAN_TITLES = { home: 'Payer Portal', leaderboard: 'Physician Risk Leaderboard', physicians: 'All Physicians', detail: 'NPI Detail', watchlist: 'Vendor Watchlist', vendors: 'All Vendors', supplierDetail: 'Vendor Case', rules: 'Detection Console', alerts: 'Live Alerts', disputes: 'NPI Disputes', disputeDetail: 'Dispute Detail' }

// ─── Payer portal routing ────────────────────────────────────────────────────
// The URL is the single source of truth for which payer screen is showing.
// Each screen maps to a real path under /payer, so navigation, refresh, deep
// links, and the browser back/forward buttons all Just Work — no hand-rolled
// history stack. Top-level screens are static paths; the three detail screens
// carry their entity id as a path param.
const PLAN_SCREEN_PATH = {
  home: '/payer/dashboard',
  leaderboard: '/payer/leaderboard',
  physicians: '/payer/physicians',
  watchlist: '/payer/watchlist',
  vendors: '/payer/vendors',
  rules: '/payer/rules',
  disputes: '/payer/disputes',
}

// pathname (+ query) → { screen, npi?, vendorId?, caseId?, preview? }. The
// preview short-circuit keeps the hover-thumbnail iframes (…?preview=1&screen=X)
// working — they render a screen by name without a real path.
function parsePlanRoute(location) {
  const q = new URLSearchParams(location.search)
  if (q.get('preview') === '1' && q.get('screen')) return { screen: q.get('screen'), preview: true }
  const rest = location.pathname.replace(/^\/payer\/?/, '').replace(/\/+$/, '')
  const [seg, id] = rest.split('/')
  switch (seg) {
    case '':
    case 'dashboard':   return { screen: 'home' }
    case 'leaderboard': return { screen: 'leaderboard' }
    case 'physicians':  return { screen: 'physicians' }
    case 'npi':         return { screen: 'detail', npi: id }
    case 'watchlist':   return { screen: 'watchlist' }
    case 'vendors':     return { screen: 'vendors' }
    case 'rules':       return { screen: 'rules' }
    case 'vendor':      return { screen: 'supplierDetail', vendorId: id }
    case 'disputes':    return id ? { screen: 'disputeDetail', caseId: id } : { screen: 'disputes' }
    default:            return { screen: 'home' }
  }
}



// Latest timestamp touching a dispute case — its last event if any were
// recorded (vendor response, escalation, etc.), else the newest of
// opened/notified/responded/closed. Drives the "NPI Disputes" list's default
// order so the most recently active cases surface first instead of whatever
// order the API happened to return.
function mostRecentActivity(d) {
  const times = [d.opened_at, d.billing_provider_notified_at, d.vendor_responded_at, d.closed_at]
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
  const lastEvent = d.events?.length ? d.events[d.events.length - 1].created_at : null
  if (lastEvent) times.push(new Date(lastEvent).getTime())
  return times.length ? Math.max(...times) : 0
}

// ─── NPI Disputes table — badges/chips (payer/compliance view) ──────────────

function planDisputeTypeBadge(type) {
  if (type === 'FRAUD_REPORT') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#B95951,#9A3F39)' }}>
        Fraud Report
      </span>
    )
  }
  if (type === 'DECEASED_PATIENT') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#F2EEF7,#EAE3F2)', color: '#5F4E80' }}>
        Deceased Patient
      </span>
    )
  }
  if (type === 'FLAG') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#F1F4F9,#E7ECF3)', color: '#46586F' }}>
        Flag Vendor
      </span>
    )
  }
  if (type === 'UNKNOWN_PATIENT') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#F1F4F9,#E7ECF3)', color: '#647089' }}>
        Reassign Patient
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
          style={{ background: 'linear-gradient(180deg,#EBF3F8,#E9F0F6)', color: '#35607D' }}>
      Dispute
    </span>
  )
}

const PLAN_STATUS_LABEL = {
  OPEN: 'Open',
  NON_RESPONSIVE: 'Non Responsive',
  PENDING_PHYSICIAN_CONFIRMATION: 'Pending Physician Confirmation',
  PENDING_PHYSICIAN_REVIEW: 'Awaiting Physician Review',
  RESPONDED_TO_MEDICARE: 'Responded to Medicare',
  RESOLVED_BY_PHYSICIAN: 'Resolved by Physician',
  REFERRED_TO_PAYER: 'Physician Declined — Your Review',
  CLOSED: 'Closed',
  REFERRED_OIG: 'Referred to OIG',
}
function planDisputeStatusBadge(status) {
  const label = PLAN_STATUS_LABEL[status] || status?.replace(/_/g, ' ') || '—'
  // Needs the payer's attention — vendor never responded, or the physician
  // declined the docs and handed the case over. Solid red.
  if (status === 'NON_RESPONSIVE' || status === 'REFERRED_TO_PAYER') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#B95951,#9A3F39)' }}>
        {label}
      </span>
    )
  }
  if (status === 'OPEN') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#FDF6E9,#FBF3E4)', color: '#8A6A34' }}>
        {label}
      </span>
    )
  }
  // Awaiting the physician's move (vendor uploaded docs / legacy confirmation) — blue.
  if (status === 'PENDING_PHYSICIAN_CONFIRMATION' || status === 'PENDING_PHYSICIAN_REVIEW') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#EBF3F8,#E9F0F6)', color: '#35607D' }}>
        {label}
      </span>
    )
  }
  // RESPONDED_TO_MEDICARE / RESOLVED_BY_PHYSICIAN / CLOSED / REFERRED_OIG — resolved
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
          style={{ background: 'linear-gradient(180deg,#EEF6F1,#E9F3ED)', color: '#2E6B4F' }}>
      {label}
    </span>
  )
}

function planDaysChip(d) {
  const resolved = !['OPEN', 'NON_RESPONSIVE'].includes(d.status)
  if (resolved) {
    return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-bold" style={{ background: '#F1F4F9', color: '#46586F' }}>—</span>
  }
  if (d.deadline_passed) {
    return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-bold" style={{ background: '#F7EBEA', color: '#8A423D' }}>Overdue</span>
  }
  if (d.days_remaining <= 7) {
    return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-bold" style={{ background: '#FBF3E4', color: '#8A6A34' }}>{d.days_remaining}d</span>
  }
  return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-bold" style={{ background: '#F1F4F9', color: '#46586F' }}>{d.days_remaining}d</span>
}

function needsEscalation(d) {
  return d.status === 'NON_RESPONSIVE' || d.status === 'REFERRED_TO_PAYER' || !!d.deadline_passed
}

// Tabs follow the case lifecycle, not the report type: a physician marking a
// claim (fraud/dispute/deceased/flags), the vendor's response (docs uploaded,
// or window expired unanswered), and the physician's approve/decline verdict.
// Filtering keys off the backend's `group` field; `category` still drives the
// per-item icon (fraud shield, deceased heart, flag, dispute bubble).
const PLAN_NOTIF_TABS = [
  { id: 'all', label: 'All' },
  { id: 'reported', label: 'Reported' },
  { id: 'response', label: 'Vendor response' },
  { id: 'decision', label: 'Decisions' },
]

// Payer/compliance bell — same recent-activity idea as the vendor portal's
// notification dropdown, styled with this portal's own slate/rose palette
// (ProfileMenu's panel look) instead of the vendor theme's design tokens.
// Dispute-case notifications only.
function PlanNotifBell({ count, notifications, open, onToggle, onMarkRead, onSelect, marking }) {
  const [tab, setTab] = useState('all')
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onToggle(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onToggle])

  const filtered = tab === 'all' ? notifications : notifications.filter((n) => n.group === tab)

  return (
    <div ref={ref} className="relative">
      <button onClick={() => onToggle(!open)} title="Recent activity"
              className="relative w-10 h-10 rounded-[10px] border flex items-center justify-center transition-colors"
              style={{ borderColor: '#C7D0DE', background: 'linear-gradient(180deg,#fff,#F6F8FB)', color: '#46586F', boxShadow: 'inset 0 1px 0 #fff, 0 1px 2px rgba(10,31,61,.04)' }}>
        <Icon name="alerts" size={18} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[9.5px] font-bold flex items-center justify-center"
                style={{ background: '#A6453F', border: '2px solid #fff' }}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[400px] max-w-[calc(100vw-16px)] bg-white rounded-xl z-50 overflow-hidden border border-slate-200"
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>
          <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3 border-b border-slate-100">
            <span className="text-[13px] font-bold text-slate-800">Notifications</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={onMarkRead} disabled={marking || count === 0}
                      className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-800 disabled:text-slate-300 disabled:cursor-default">
                Mark all read
              </button>
              <button onClick={() => onToggle(false)} aria-label="Close notifications" title="Close"
                      className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <Icon name="x" size={13} stroke={2.4} />
              </button>
            </div>
          </div>

          <>
              <div className="flex gap-1 px-3 py-2.5">
                {PLAN_NOTIF_TABS.map((t) => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                          className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold ${tab === t.id ? 'bg-slate-100 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="max-h-[340px] overflow-y-auto px-2 pb-2.5">
                {filtered.length === 0 ? (
                  <div className="py-8 text-center text-[12.5px] text-slate-400">No notifications yet.</div>
                ) : filtered.map((n) => {
                  const fraud = n.category === 'fraud'
                  const flag = n.category === 'flag'
                  const deceased = n.category === 'deceased'
                  const iconName = deceased ? 'heartOff' : fraud ? 'shieldAlert' : flag ? 'flag' : 'message'
                  const bg = deceased ? '#F2EEF7' : fraud ? '#F7EBEA' : flag ? '#FBF3E4' : '#E9F0F6'
                  const fg = deceased ? '#7A6899' : fraud ? '#A6453F' : flag ? '#8A6A34' : '#5A9BC9'
                  return (
                    <button key={n.id} onClick={() => onSelect(n)}
                            className={`w-full flex gap-2.5 text-left px-2 py-2.5 rounded-lg hover:bg-slate-50 ${!n.read ? 'bg-slate-50/80' : ''}`}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                        <Icon name={iconName} size={14} style={{ color: fg }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12.5px] font-semibold text-slate-800 truncate">{n.title}</span>
                          <span className="text-[10.5px] text-slate-400 flex-shrink-0">{timeAgo(n.created_at)}</span>
                        </div>
                        <div className="text-[11.5px] text-slate-500 mt-0.5 line-clamp-2">{n.description}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
          </>
        </div>
      )}
    </div>
  )
}

// ─── Plan portal ─────────────────────────────────────────────────────────────
// NPI Disputes table — column-header dropdown options (Type/Status filter, Days Left sort).
const PLAN_DISPUTE_TYPE_OPTIONS = [
  { id: 'ALL',              label: 'All Types' },
  { id: 'FRAUD_REPORT',     label: 'Fraud Report' },
  { id: 'DECEASED_PATIENT', label: 'Deceased Patient' },
  { id: 'FLAG',             label: 'Flag Vendor' },
  { id: 'UNKNOWN_PATIENT',  label: 'Reassign Patient' },
  { id: 'DISPUTE',          label: 'Dispute' },
]
const PLAN_DISPUTE_STATUS_OPTIONS = [
  { id: 'all',      label: 'All Statuses' },
  { id: 'open',      label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
]
const PLAN_DISPUTE_SORT_OPTIONS = [
  { id: 'NONE',       label: 'Default Order' },
  { id: 'DAYS_ASC',   label: 'Overdue First' },
  { id: 'DAYS_DESC',  label: 'Days Left: High to Low' },
]

function PlanPortalInner() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const route = parsePlanRoute(location)
  const screen = route.screen
  const lbBand = new URLSearchParams(location.search).get('band') || 'all'

  // Ephemeral UI state (not worth a URL): notifications, the two search boxes,
  // and the NPI Disputes list + its column filters.
  const [notif, setNotif] = useState(0)
  const [planNotifications, setPlanNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifMarking, setNotifMarking] = useState(false)
  const [search, setSearch] = useState('')      // top-nav search → filters the supplier watchlist
  const [planDisputes, setPlanDisputes] = useState([])
  const [planDisputesLoading, setPlanDisputesLoading] = useState(false)
  const [disputeStatusFilter, setDisputeStatusFilter] = useState('all')  // open | resolved | all — backend-side, column-header dropdown
  const [disputeTypeFilter, setDisputeTypeFilter] = useState('ALL')      // ALL | DISPUTE | FRAUD_REPORT — client-side, column-header dropdown
  const [disputeSortOrder, setDisputeSortOrder] = useState('NONE')       // NONE | DAYS_ASC | DAYS_DESC — client-side, column-header dropdown
  const [disputesRefreshKey, setDisputesRefreshKey] = useState(0)
  const [disputeSearch, setDisputeSearch] = useState('')   // filters the NPI Disputes list — distinct from the top-nav NPI/supplier lookup
  const [fetchedSupplier, setFetchedSupplier] = useState(null)   // vendor row fetched by id on a deep-linked /payer/vendor/:id

  // ── Selected entities, derived from the URL ──
  // In-session navigation hands the full row over via navigate(..,{state}) so
  // the detail screen paints instantly. A deep link / refresh has no state:
  // NPI detail rebuilds from just the id (it refetches internally), the vendor
  // case fetches its row by id (see effect below), and the dispute is found in
  // the loaded list (which the effect below force-loads with status=all).
  const npiRowRef = useRef(null)   // NPILeaderboard/AllPhysicians call setSelectedNPI(r) then setActiveScreen('detail'); the adapter stashes r here
  // Memoized so NPIDetail (whose fetch effect keys on this prop) doesn't refetch
  // on every parent re-render — the object is only rebuilt when the id or the
  // nav-state hint actually changes.
  const selectedNPI = useMemo(
    () => (route.npi ? { npi: route.npi, ...(location.state?.row || {}) } : null),
    [route.npi, location.state],
  )
  const npiBack = location.state?.backTo ? { to: location.state.backTo, label: location.state.backLabel } : null
  const npiInitialPattern = location.state?.pattern || null
  const selectedSupplier = route.vendorId
    ? (location.state?.supplier
        || (fetchedSupplier && String(fetchedSupplier.id) === String(route.vendorId) ? fetchedSupplier : null))
    : null
  const selectedDispute = route.caseId
    ? (planDisputes.find((d) => String(d.case_id) === String(route.caseId)) || location.state?.dispute || null)
    : null

  useEffect(() => {
    const refresh = () => getNotificationsCount().then(setNotif).catch(() => {})
    refresh()
    const t = setInterval(refresh, 20000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    getPlanNotifications().then(setPlanNotifications).catch(() => {})
  }, [])

  function refreshPlanNotifications() {
    getPlanNotifications().then(setPlanNotifications).catch(() => {})
  }

  // Opening the bell (not just the explicit "Mark all read" button inside it)
  // should clear the unread badge — mirrors clicking into an inbox. Also
  // refetches the list so the dropdown never shows a stale page-load snapshot.
  function toggleNotif(next) {
    setNotifOpen(next)
    if (next) {
      refreshPlanNotifications()
      markAllPlanNotificationsRead()
    }
  }

  function markAllPlanNotificationsRead() {
    setNotifMarking(true)
    markNotificationsSeen()
      .then(() => {
        setNotif(0)
        setPlanNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      })
      .catch(() => {})
      .finally(() => setNotifMarking(false))
  }

  // A notification pointing at a dispute case opens the same detail modal the
  // "NPI Disputes" table's rows do — refetch with status=all since the case
  // may not be in whatever status bucket the disputes list is currently filtered to.
  function selectPlanNotification(n) {
    setNotifOpen(false)
    if (!n.case_id) { go('home'); return }
    getPlanDisputes('all').then((fresh) => {
      const match = fresh.disputes.find((d) => d.case_id === n.case_id)
      if (match) openDispute(match)
      else go('disputes')
    }).catch(() => go('disputes'))
  }

  // Live push — any dispute-case change (vendor responded, physician confirmed/
  // rejected, new dispute opened) bumps disputesRefreshKey so the effect below
  // refetches immediately instead of waiting for the next tab click.
  useEffect(() => {
    const es = subscribeDisputeStream('/plan/alerts/stream', (evt) => {
      if (evt.type === 'dispute_updated') {
        setDisputesRefreshKey((k) => k + 1)
        getNotificationsCount().then(setNotif).catch(() => {})
        refreshPlanNotifications()
      }
    })
    return () => es.close()
  }, [])

  // disputesRefreshKey bumps on every tab click (even re-clicking the active tab) so the
  // list always pulls fresh data — a vendor/physician can change a case's status in a
  // separate session at any time, and there's no live push to catch that otherwise.
  useEffect(() => {
    if (screen === 'disputes') {
      setPlanDisputesLoading(true)
      getPlanDisputes(disputeStatusFilter)
        .then(d => setPlanDisputes(d.disputes))
        .catch(() => {})
        .finally(() => setPlanDisputesLoading(false))
    } else if (screen === 'disputeDetail') {
      // Load the full set (status=all) so the URL-derived selectedDispute
      // resolves on a deep link / refresh, and re-resolves live whenever a
      // dispute_updated SSE event bumps disputesRefreshKey while the case is open.
      getPlanDisputes('all').then(d => setPlanDisputes(d.disputes)).catch(() => {})
    }
  }, [screen, disputeStatusFilter, disputesRefreshKey])

  // Vendor case reached by deep link / refresh (no row handed over in nav
  // state) — resolve the row from the watchlist list so the header/KPIs render.
  useEffect(() => {
    if (screen === 'supplierDetail' && route.vendorId && !location.state?.supplier) {
      getSupplierById(route.vendorId).then(setFetchedSupplier).catch(() => {})
    }
  }, [screen, route.vendorId, location.state])

  // ── Navigation — every transition is a real URL change (navigate), so the
  // browser owns history: back/forward, refresh, and deep links all work with
  // no hand-rolled stack. In-session jumps hand the already-loaded row to the
  // detail screen via location state so it paints without a refetch flash; a
  // deep link / refresh arrives with no state and the screen refetches by id.
  function go(s, band = 'all') {
    setSearch('')
    if (s === 'leaderboard' && band && band !== 'all') { navigate(`/payer/leaderboard?band=${band}`); return }
    const path = PLAN_SCREEN_PATH[s] || '/payer/dashboard'
    if (location.pathname !== path) navigate(path)
  }
  function goBack() { navigate(-1) }

  function openNpi(row, back = null) {
    if (!row?.npi) return
    navigate(`/payer/npi/${row.npi}`, { state: { row, backTo: back?.to, backLabel: back?.label } })
  }
  // sup = supplier row; fromPattern = the fraud-pattern modal open when this was
  // clicked, carried along best-effort for the view behind the vendor case.
  function openSupplier(sup, fromPattern = null) {
    if (!sup?.id) return
    navigate(`/payer/vendor/${sup.id}`, { state: { supplier: sup, pattern: fromPattern } })
  }
  // Open NPI detail from a physician row on a supplier case, remembering the
  // supplier so NPI detail can offer a "← Back to {supplier}" link.
  function openNpiFromSupplier(physRow) {
    const npiVal = typeof physRow === 'string' ? physRow : physRow?.npi
    if (!npiVal) return
    const row = typeof physRow === 'object' ? { npi: npiVal, name: physRow?.name } : { npi: npiVal }
    navigate(`/payer/npi/${npiVal}`, { state: { row, backTo: 'supplierDetail', backLabel: selectedSupplier?.name } })
  }
  // Open a new NPI detail from within the current one (e.g. Cross-NPI modal click).
  function openNpiFromDetail(npiRow, fromPattern = null) {
    if (!npiRow?.npi) return
    navigate(`/payer/npi/${npiRow.npi}`, { state: { row: npiRow, pattern: fromPattern } })
  }
  // Open the Dispute Detail screen (payer/compliance view).
  function openDispute(d) {
    if (!d?.case_id) return
    navigate(`/payer/disputes/${d.case_id}`, { state: { dispute: d } })
  }
  // Re-fetch after a compliance action so the new event/status show up — the
  // URL-derived selectedDispute updates as soon as planDisputes is replaced.
  function refreshSelectedDispute(caseId) {
    return getPlanDisputes('all').then((fresh) => {
      setPlanDisputes(fresh.disputes)
      return fresh.disputes.find((x) => x.case_id === caseId)
    })
  }

  const fromSupplier = npiBack?.to === 'supplierDetail'

  // Breadcrumbs are now a fixed per-screen hierarchy derived straight from the
  // route — no history walking. Each ancestor crumb navigates to its own path;
  // the detail screens sit under whichever parent they were reached from (an
  // NPI opened from a vendor case hangs under Vendor Watchlist, else under the
  // Physician Leaderboard).
  const breadcrumbs = (() => {
    const crumb = (label, path) => ({ label, onClick: () => navigate(path) })
    const dash = crumb('Dashboard', '/payer/dashboard')
    switch (screen) {
      case 'leaderboard': return [dash, { label: 'Physician Leaderboard', active: true }]
      case 'physicians':  return [dash, crumb('Physician Leaderboard', '/payer/leaderboard'), { label: 'All Physicians', active: true }]
      case 'detail':      return [dash,
        fromSupplier ? crumb('Vendor Watchlist', '/payer/watchlist') : crumb('Physician Leaderboard', '/payer/leaderboard'),
        { label: selectedNPI?.name || 'NPI Detail', active: true }]
      case 'watchlist':   return [dash, { label: 'Vendor Watchlist', active: true }]
      case 'vendors':     return [dash, crumb('Vendor Watchlist', '/payer/watchlist'), { label: 'All Vendors', active: true }]
      case 'supplierDetail': return [dash, crumb('Vendor Watchlist', '/payer/watchlist'), { label: selectedSupplier?.name || 'Vendor Case', active: true }]
      case 'disputes':    return [dash, { label: 'NPI Disputes', active: true }]
      case 'disputeDetail': return [dash, crumb('NPI Disputes', '/payer/disputes'), { label: 'Dispute Detail', active: true }]
      default: return []
    }
  })()

  // No headerGreeting: PlainNavbar renders the greeting *instead of* breadcrumbs, so
  // setting one on the leaderboard was why that screen alone had no trail. Every
  // payer screen now shows breadcrumbs, and the dashboard resets to just "Dashboard"
  // (Shell falls back to that when the switch above returns an empty list).

  return (
    <Shell navItems={PLAN_NAV}
           layout="navbar-plain"
           transparentHeader iconOnlyNav
           activeId={screen === 'detail' ? (fromSupplier ? 'watchlist' : 'leaderboard') : screen === 'physicians' ? 'leaderboard' : screen === 'supplierDetail' || screen === 'vendors' ? 'watchlist' : screen === 'disputeDetail' ? 'disputes' : screen}
           onNavigate={go}
           canGoBack={screen !== 'home'} onBack={goBack}
           title={PLAN_TITLES[screen]} user={user} subtitle="Payer" showSearch
           searchValue={screen === 'disputes' ? disputeSearch : search}
           onSearchChange={screen === 'disputes' ? setDisputeSearch : setSearch}
           searchPlainMode={screen === 'disputes'}
           searchPlaceholder={screen === 'disputes' ? 'Search claim #, vendor, NPI…' : undefined}
           onOpenNpi={(row) => openNpi(row, null)}
           onOpenSupplier={openSupplier}
           breadcrumbs={breadcrumbs}
           notifCount={notif} bellTitle="New activity"
           onBellClick={() => { markNotificationsSeen().then(() => setNotif(0)).catch(() => {}); go('home') }}
           bellSlot={
             <PlanNotifBell
               count={notif}
               notifications={planNotifications}
               open={notifOpen}
               onToggle={toggleNotif}
               onMarkRead={markAllPlanNotificationsRead}
               marking={notifMarking}
               onSelect={selectPlanNotification}
             />
           }
           onLogout={async () => { await logout(); navigate('/welcome', { replace: true }) }}>
      {screen === 'home' && <PlanHome setActiveScreen={go}
          onOpenNpi={(npiObj) => openNpi(npiObj, null)}
          onOpenSupplier={openSupplier}
          onOpenActivityFeed={() => setNotifOpen(true)} />}
      {screen === 'leaderboard' && <NPILeaderboard search={search}
          setSelectedNPI={(r) => { npiRowRef.current = r }}
          setActiveScreen={(s, band) => { if (s === 'detail') openNpi(npiRowRef.current, null); else go(s, band) }}
          initialBand={lbBand} />}
      {screen === 'physicians' && <AllPhysicians search={search}
          setSelectedNPI={(r) => { npiRowRef.current = r }}
          setActiveScreen={(s) => { if (s === 'detail') openNpi(npiRowRef.current, null); else go(s) }} />}
      {screen === 'detail' && <NPIDetail npi={selectedNPI}
          onBack={goBack}
          backLabel={fromSupplier ? `Back to ${npiBack.label || 'vendor'}` : null}
          initialPattern={npiInitialPattern}
          onOpenNpi={openNpiFromDetail}
          onOpenSupplier={openSupplier} />}
      {screen === 'watchlist' && <SupplierWatchlist search={search} onSelect={openSupplier}
          onViewAll={() => go('vendors')} />}
      {screen === 'vendors' && <AllVendors search={search} onSelect={openSupplier} />}
      {screen === 'rules' && <RulesCatalog onExplore={() => go('leaderboard')} />}
      {screen === 'supplierDetail' && <SupplierDetail supplier={selectedSupplier} onBack={goBack} onSelectPhysician={openNpiFromSupplier} />}
      {screen === 'disputes' && (() => {
        const q = normalizeSearchQuery(disputeSearch)
        const filteredDisputes = planDisputes.filter((d) => {
          const matchType = disputeTypeFilter === 'ALL' || d.dispute_type === disputeTypeFilter
          const matchSearch = !q
            || d.claim_number?.toLowerCase().includes(q)
            || d.vendor_name?.toLowerCase().includes(q)
            || d.vendor_npi?.toLowerCase().includes(q)
            || d.physician_npi?.toLowerCase().includes(q)
            || d.physician_notes?.toLowerCase().includes(q)
          return matchType && matchSearch
        })
        if (disputeSortOrder === 'DAYS_ASC') {
          filteredDisputes.sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))
        } else if (disputeSortOrder === 'DAYS_DESC') {
          filteredDisputes.sort((a, b) => (b.days_remaining ?? 0) - (a.days_remaining ?? 0))
        } else {
          // "Default Order" = most recently active case first, not whatever
          // order the API happened to return.
          filteredDisputes.sort((a, b) => mostRecentActivity(b) - mostRecentActivity(a))
        }

        const openDetail = (d) => {
          openDispute(d)
          // Refresh in the background in case the vendor/physician changed this
          // case's status in a separate session since the list was last fetched.
          // Replacing planDisputes re-resolves the URL-derived selectedDispute.
          getPlanDisputes(disputeStatusFilter).then((fresh) => {
            setPlanDisputes(fresh.disputes)
          }).catch(() => {})
        }

        return (
        // pt-2 rather than py-6: the header above already contributes its own py-4,
        // so a matching 24px here left a ~40px gap before the table.
        <div className="w-full h-full flex flex-col min-h-0 px-4 sm:px-7 pt-2 pb-6">
          <div className="mc-card overflow-hidden flex flex-col flex-1 min-h-0">

            {planDisputesLoading ? (
              <div className="flex justify-center py-16">
                <div className="animate-spin h-7 w-7 rounded-full border-2 border-navy border-t-transparent" />
              </div>
            ) : filteredDisputes.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="text-slate-500 text-sm">No disputes match these filters.</div>
                {(disputeTypeFilter !== 'ALL' || disputeStatusFilter !== 'all' || disputeSortOrder !== 'NONE' || (disputeSearch || '').trim()) && (
                  <button type="button"
                          onClick={() => { setDisputeTypeFilter('ALL'); setDisputeStatusFilter('all'); setDisputeSortOrder('NONE'); setDisputeSearch('') }}
                          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 shadow-sm hover:border-[#0A1F3D]/25 hover:bg-[#E9F0F6] hover:text-[#0A1F3D] transition-all">
                    <Icon name="refresh" size={13} stroke={2.2} /> Clear filters
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Mobile card view (< sm) — the table's columns don't fit a phone
                    width, so each dispute becomes a stacked card instead. */}
                <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
                  {filteredDisputes.map((d) => (
                    <div key={d.case_id} onClick={() => openDetail(d)}
                         className="px-4 py-3.5 cursor-pointer active:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="font-mono text-xs text-slate-700 truncate">{d.claim_number}</span>
                        {planDaysChip(d)}
                      </div>
                      <div className="font-bold text-[13.5px] text-slate-900 truncate mb-2">{d.vendor_name || d.vendor_npi}</div>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {planDisputeTypeBadge(d.dispute_type)}
                          {planDisputeStatusBadge(d.status)}
                        </div>
                        <span className="text-xs text-slate-400">{d.response_due_date ? fmtDate(d.response_due_date) : '—'}</span>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); openDetail(d) }}
                              className={`mt-2.5 w-full justify-center ${needsEscalation(d) ? 'take-action-btn' : 'view-btn'}`}>
                        {needsEscalation(d) ? 'Escalate' : 'View'} →
                      </button>
                    </div>
                  ))}
                </div>

                {/* Desktop table view (sm+) */}
                <div className="hidden sm:block flex-1 min-h-0 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-slate-200 text-[10.5px] font-bold text-slate-400 uppercase tracking-wide bg-slate-50">
                        <th className="text-left py-3 px-3.5">Claim #</th>
                        <th className="text-left py-3 px-3.5">Vendor</th>
                        <th className="text-left py-3 px-3.5">Due Date</th>
                        <PFilterTh label="Type" options={PLAN_DISPUTE_TYPE_OPTIONS} value={disputeTypeFilter} onChange={setDisputeTypeFilter} />
                        <PFilterTh label="Status" options={PLAN_DISPUTE_STATUS_OPTIONS} value={disputeStatusFilter} onChange={setDisputeStatusFilter} defaultValue="all" />
                        <PFilterTh label="Days Left" options={PLAN_DISPUTE_SORT_OPTIONS} value={disputeSortOrder} onChange={setDisputeSortOrder} defaultValue="NONE" />
                        <th className="py-3 px-3.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDisputes.map((d) => (
                        <tr key={d.case_id} onClick={() => openDetail(d)}
                            className="hover:bg-slate-50 transition-colors cursor-pointer">
                          <td className="py-3.5 px-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">{d.claim_number}</td>
                          <td className="py-3.5 px-3.5">
                            <div className="font-bold text-[13.5px] text-slate-900 truncate max-w-[220px]">{d.vendor_name || d.vendor_npi}</div>
                          </td>
                          <td className="py-3.5 px-3.5 text-xs text-slate-500 whitespace-nowrap">{d.response_due_date ? fmtDate(d.response_due_date) : '—'}</td>
                          <td className="py-3.5 px-3.5">{planDisputeTypeBadge(d.dispute_type)}</td>
                          <td className="py-3.5 px-3.5">{planDisputeStatusBadge(d.status)}</td>
                          <td className="py-3.5 px-3.5 whitespace-nowrap">{planDaysChip(d)}</td>
                          <td className="py-3.5 px-3.5 whitespace-nowrap">
                            <button onClick={(e) => { e.stopPropagation(); openDetail(d) }}
                                    className={needsEscalation(d) ? 'take-action-btn' : 'view-btn'}>
                              {needsEscalation(d) ? 'Escalate' : 'View'} →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
        )
      })()}
      {screen === 'disputeDetail' && <DisputeDetailScreen dispute={selectedDispute} onActioned={refreshSelectedDispute} />}
    </Shell>
  )
}

// ─── Dispute detail screen (payer/compliance view) — click-through from NPI
// Disputes, mirrors the physician/vendor portals' own Dispute Detail screens
// so this is a full page reached via the header back button, not a modal
// stacked over the list. ─────────────────────────────────────────────────────
// Icon/tone per timeline entry `type` (see buildDisputeTimeline) — everything
// defaults to the neutral slate-blue dot; only escalation-flavored entries
// (overdue escalation, confirmation-window expiry, a rejected resolution)
// get the alarming red treatment, matching the reference mockup's
// .tl-dot / .tl-dot.escalate split.
const TL_DOT_STYLE = {
  rejected:  { icon: 'x',        bg: '#F7EBEA', fg: '#A6453F' },
  expired:   { icon: 'clock',    bg: '#F7EBEA', fg: '#A6453F' },
  escalated: { icon: 'alertTri', bg: '#F7EBEA', fg: '#A6453F' },
  fraud:     { icon: 'shield',   bg: '#E9F0F6', fg: '#5B84C4' },
  dispute:   { icon: 'shield',   bg: '#E9F0F6', fg: '#5B84C4' },
  deceased:  { icon: 'heartOff', bg: '#F2EEF7', fg: '#7A6899' },
  notified:  { icon: 'doc',      bg: '#E9F0F6', fg: '#5B84C4' },
  confirmed: { icon: 'check',    bg: '#E9F0F6', fg: '#5B84C4' },
  compliance:{ icon: 'check',    bg: '#E9F0F6', fg: '#5B84C4' },
}
const TL_DOT_DEFAULT = { icon: 'doc', bg: '#E9F0F6', fg: '#5B84C4' }

// The four decisions compliance can log against an escalated (NON_RESPONSIVE)
// case — mirrors backend/routers/dashboard.py's COMPLIANCE_ACTION_LABEL keys.
const COMPLIANCE_ACTIONS = [
  { id: 'REFER_TO_MEDICARE',   icon: 'shield', tone: 'error'   },
  { id: 'SUSPEND_SUPPLIER',    icon: 'flag',   tone: 'warning' },
  { id: 'REQUEST_DOCS',        icon: 'doc',    tone: 'neutral' },
  { id: 'CLOSE_INVESTIGATION', icon: 'check',  tone: 'success' },
]
const ACTION_TONE = {
  error:   { bg: '#F7EBEA', fg: '#A6453F' },
  warning: { bg: '#FBF3E4', fg: '#8A6A34' },
  neutral: { bg: '#F1F4F9', fg: '#647089' },
  success: { bg: '#E9F3ED', fg: '#2E6B4F' },
}

function DisputeDetailScreen({ dispute: d, onActioned }) {
  const [selectedAction, setSelectedAction] = useState(null)
  const [actionNotes, setActionNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  if (!d) return <div className="px-7 py-8 text-slate-400">No dispute selected.</div>

  // Full multi-round history from the event log (see buildDisputeTimeline in
  // components/ui.jsx) — compliance gets neutral third-person wording and sees
  // every vendor response's note/docs regardless of which path it took, unlike
  // the physician's own view which hides the Medicare-path content.
  const rawTimeline = [
    ...(d.events?.length
      ? buildDisputeTimeline(d, null)
      : [{
          at: d.opened_at,
          label: d.dispute_type === 'FRAUD_REPORT' ? 'Physician reported this as fraud'
            : d.dispute_type === 'DECEASED_PATIENT' ? 'Physician reported the patient as deceased'
            : 'Physician disputed this claim',
          note: d.physician_notes,
          type: d.dispute_type === 'FRAUD_REPORT' ? 'fraud' : d.dispute_type === 'DECEASED_PATIENT' ? 'deceased' : 'dispute',
        }]),
    d.billing_provider_notified_at && { at: d.billing_provider_notified_at, label: 'Vendor notified', type: 'notified' },
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at))
  // Defensive de-dup — a case whose escalation trigger fired more than once
  // (e.g. two read paths racing before the status flip committed) would
  // otherwise show the same "escalated to compliance" line twice.
  const timeline = rawTimeline.filter((t, i) => i === 0 || t.label !== rawTimeline[i - 1].label || t.at !== rawTimeline[i - 1].at)

  // REFERRED_TO_PAYER and PENDING_PHYSICIAN_REVIEW are NOT resolved — the first
  // needs the payer's action, the second is mid-flight awaiting the physician.
  const resolved = ['RESOLVED_BY_PHYSICIAN', 'RESPONDED_TO_MEDICARE', 'CLOSED', 'REFERRED_OIG'].includes(d.status)
  const needsDecision = d.status === 'NON_RESPONSIVE' || d.status === 'REFERRED_TO_PAYER'
  const statusCls = needsDecision ? 'bg-[#F7EBEA] text-[#8A423D]'
    : resolved ? 'bg-[#E9F3ED] text-[#2E6B4F]' : 'bg-[#FBF3E4] text-[#8A6A34]'

  async function submitDecision() {
    if (!selectedAction || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await submitComplianceAction(d.case_id, selectedAction, actionNotes)
      await onActioned?.(d.case_id)
      setSelectedAction(null)
      setActionNotes('')
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0 px-4 sm:px-7 py-4">
      <div className="w-full flex flex-col flex-1 min-h-0">

        {/* Banner */}
        <div className="mc-card p-4 sm:p-5 mb-4 flex-shrink-0">
          <h2 className="text-[17px] font-bold text-slate-900 mb-2.5">Case #{d.case_id} — Claim {d.claim_number}</h2>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {(() => {
              const t = d.dispute_type
              const meta = t === 'FRAUD_REPORT'
                ? { label: 'Fraud Report', icon: 'shield', cls: 'text-white', style: { background: 'linear-gradient(180deg,#B95951,#9A3F39)' } }
                : t === 'DECEASED_PATIENT'
                ? { label: 'Deceased Patient', icon: 'heartOff', cls: '', style: { background: 'linear-gradient(180deg,#F2EEF7,#EAE3F2)', color: '#5F4E80' } }
                : { label: 'Dispute', icon: 'message', cls: 'text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-200', style: undefined }
              return (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${meta.cls}`} style={meta.style}>
                  <Icon name={meta.icon} size={11} />
                  {meta.label}
                </span>
              )
            })()}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${statusCls}`}>
              {needsDecision && <Icon name={d.status === 'REFERRED_TO_PAYER' ? 'alertTri' : 'x'} size={11} />}
              {PLAN_STATUS_LABEL[d.status] || d.status?.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-5 pt-3.5 border-t border-slate-100 text-[13px]">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Vendor</div>
              <div className="font-semibold text-slate-800">{d.vendor_name || d.vendor_npi || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Physician NPI</div>
              <div className="font-semibold text-slate-800">{d.physician_npi || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Response Due</div>
              <div className="font-semibold text-slate-800">{d.response_due_date ? fmtDate(d.response_due_date) : '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Days Left</div>
              <div className={`font-bold ${d.deadline_passed ? 'text-[#A6453F]' : 'text-slate-800'}`}>
                {resolved ? '—' : d.deadline_passed ? 'Overdue' : `${d.days_remaining}d`}
              </div>
            </div>
          </div>
        </div>

        <div className={`grid grid-cols-1 ${needsDecision ? 'lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px] 2xl:grid-cols-[1fr_420px]' : ''} gap-4 items-stretch flex-1 min-h-0`}>
          <div className="flex flex-col gap-4 min-w-0 min-h-0">

            {/* Claim details */}
            {d.claim && (
              <div className="mc-card p-4 sm:p-5 flex-shrink-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4">Claim Details</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-[13px]">
                  {[
                    ['Patient',          d.claim.patient_name_partial || '—'],
                    ['Service',          d.claim.service_description || '—'],
                    ['HCPCS Codes',      Array.isArray(d.claim.hcpcs_codes) ? (d.claim.hcpcs_codes.join(', ') || '—') : (d.claim.hcpcs_codes || '—')],
                    ['Date of Service',  d.claim.dos_from || d.claim.dos_to ? `${fmtDate(d.claim.dos_from)} — ${fmtDate(d.claim.dos_to)}` : '—'],
                    ['Amount Billed',    fmtUSD(d.claim.amount_billed)],
                    ['Amount Paid',      fmtUSD(d.claim.amount_paid)],
                    ['Physician',        d.claim.physician_name || '—'],
                    ['Physician Role',   d.claim.physician_npi_role || '—'],
                    ['Practice',         d.claim.physician_practice || '—'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
                      <div className="font-semibold text-slate-800">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline — absorbs the leftover height; long histories scroll inside the card */}
            <div className="mc-card p-4 sm:p-5 flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4 flex-shrink-0">Timeline</div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                {timeline.map((t, i) => {
                  const style = TL_DOT_STYLE[t.type] || TL_DOT_DEFAULT
                  return (
                    <div key={i} className="flex gap-3.5 relative pb-5 last:pb-0">
                      {i < timeline.length - 1 && <div className="absolute left-[11px] top-6 bottom-0 w-px bg-slate-200" />}
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10" style={{ background: style.bg }}>
                        <Icon name={style.icon} size={11} stroke={2.4} style={{ color: style.fg }} />
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[13.5px] font-bold text-slate-800">{t.label}</span>
                        </div>
                        <div className="text-[11.5px] text-slate-400 mt-0.5">{fmtDate(t.at)}</div>
                        {t.note && <p className="text-[12.5px] text-slate-500 mt-1.5 border-l-2 border-slate-300 pl-2.5">"{t.note}"</p>}
                        {t.detail && <p className="text-[12.5px] text-slate-500 mt-1.5 border-l-2 border-slate-300 pl-2.5">"{t.detail}"</p>}
                        {t.docs?.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-1.5">
                            {t.docs.map((doc) => (
                              <a key={doc.stored_name} href={doc.download_url} target="_blank" rel="noreferrer"
                                 className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 ring-1 ring-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition-colors">
                                <Icon name="doc" size={12} /> {doc.filename}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Compliance action — for a case that now needs the payer: the vendor
              never responded (NON_RESPONSIVE) or the physician declined the docs
              (REFERRED_TO_PAYER). Once suspended/closed, the decision shows in the
              timeline instead. */}
          {needsDecision && (
            <div className="mc-card p-5 min-h-0 overflow-y-auto">
              <div className="font-extrabold text-[15px] text-slate-900 mb-1">Compliance action</div>
              <div className="text-[12px] text-slate-500 mb-4">
                {d.status === 'REFERRED_TO_PAYER'
                  ? "The physician declined the vendor's documents. Decide how to proceed."
                  : 'Recorded on this case once submitted.'}
              </div>

              {COMPLIANCE_ACTIONS.map((opt) => {
                const isSel = selectedAction === opt.id
                const tone = ACTION_TONE[opt.tone]
                return (
                  <div key={opt.id} onClick={() => setSelectedAction(opt.id)}
                       className="flex items-center gap-3 border-[1.5px] rounded-xl px-3.5 py-3 mb-2 cursor-pointer transition-colors"
                       style={isSel ? { borderColor: tone.fg, background: tone.bg } : { borderColor: '#E1E6EE' }}>
                    <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0" style={{ background: tone.bg }}>
                      <Icon name={opt.icon} size={14} stroke={2} style={{ color: tone.fg }} />
                    </div>
                    <div className="text-[13px] font-bold text-slate-800">{COMPLIANCE_ACTION_LABEL[opt.id]}</div>
                  </div>
                )
              })}

              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-4 mb-2">Notes (optional)</label>
              <textarea value={actionNotes} onChange={(e) => setActionNotes(e.target.value)}
                        placeholder="Add context for this decision…"
                        className="w-full border border-slate-300 rounded-[10px] p-2.5 text-[13px] outline-none focus:border-[#5B84C4] focus:ring-2 focus:ring-[#5B84C4]/15 resize-y min-h-[60px]" />

              {submitError && <div className="text-[12px] text-rose-600 mt-2">{submitError}</div>}

              <button onClick={submitDecision} disabled={!selectedAction || submitting}
                      className="w-full flex items-center justify-center gap-2 mt-4 py-3 rounded-xl font-bold text-[13.5px] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'linear-gradient(180deg,#12335E,#0A1F3D)' }}>
                {submitting ? 'Submitting…' : 'Submit decision'} <Icon name="chevronRight" size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PlanPortal() {
  // AssistantWidget is mounted here rather than inside PlanPortalInner's Shell so
  // it survives screen changes — the conversation stays intact while the payer
  // navigates from the dashboard into an NPI detail and back.
  return (
    <AlertsProvider>
      <PlanPortalInner />
      <AssistantWidget />
    </AlertsProvider>
  )
}

function VendorPortal() {
  return <VendorPortalInner />
}

// ─── Route guards ────────────────────────────────────────────────────────────
function FullScreenLoader() {
  return (
    <div className="h-full flex items-center justify-center bg-slate-100">
      <svg className="animate-spin text-ink" width="28" height="28" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// NOTE: the old TOTP "force /mfa/setup" gate was removed — login now uses Email OTP,
// which has no setup step. The /mfa/* screens remain in the codebase (deactivated).
//
// POST_LOGIN_REDIRECT_KEY: an unauthenticated hit on a deep link (e.g. a vendor
// clicking "Upload documentation" in an emailed dispute notice, which now points
// straight at /vendor/portal?case=...) would otherwise just bounce to /login and
// lose that destination. Stash the full path+query here before bouncing; Login.jsx
// and OtpLogin.jsx both check it once auth completes and prefer it over their
// normal post-login destination. sessionStorage (not router state) so it survives
// the login -> /otp/login -> dashboard hop chain intact.
const POST_LOGIN_REDIRECT_KEY = 'post_login_redirect'

function Protected({ role, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!user) {
    try { sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, location.pathname + location.search) } catch { /* ignore */ }
    return <Navigate to="/login" replace />
  }
  if (role && user.role !== role) return <Navigate to={DASHBOARD_PATH[user.role] || '/login'} replace />
  return children
}

// One-time amber banner for the "few backup codes remaining" warning surfaced
// after a backup-code login. Read on each route change (the warning is written to
// sessionStorage just before redirecting to the dashboard), shown once, then cleared.
function MfaWarningBanner() {
  const { pathname } = useLocation()
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    const w = sessionStorage.getItem('mfa_warning')
    if (w) { setMsg(w); sessionStorage.removeItem('mfa_warning') }
  }, [pathname])
  if (!msg) return null
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[calc(100%-2rem)]
                    rounded-lg bg-amber-50 ring-1 ring-amber-300 shadow-md px-4 py-3
                    flex items-start gap-3 text-sm text-amber-800">
      <span className="flex-1">{msg}</span>
      <button onClick={() => setMsg(null)} aria-label="Dismiss"
              className="shrink-0 text-amber-500 hover:text-amber-700 font-bold leading-none">×</button>
    </div>
  )
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (user) return <Navigate to={DASHBOARD_PATH[user.role] || '/'} replace />
  return children
}

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  // Logged in → role dashboard; otherwise → landing page (the app's first screen).
  return <Navigate to={user ? (DASHBOARD_PATH[user.role] || '/welcome') : '/welcome'} replace />
}

export default function App() {
  return (
    <>
      <MfaWarningBanner />
      <Routes>
        {/* App entry: send to the role dashboard if logged in, otherwise to /login. */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="/welcome" element={<LandingPage />} />
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        {/* Step 2 of login (Email OTP) — public: the user has no real session yet. */}
        <Route path="/otp/login" element={<OtpLogin />} />
        {/* Public registration (physician + payer). */}
        <Route path="/register" element={<Register />} />
        {/* Deactivated TOTP screens — kept reachable directly, no longer in the login flow. */}
        <Route path="/mfa/setup" element={<Protected><MfaSetup /></Protected>} />
        <Route path="/mfa/backup-codes" element={<Protected><MfaBackupCodes /></Protected>} />
        <Route path="/physician" element={<Protected role="physician"><PhysicianPortal /></Protected>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<PhysDashboardScreen />} />
          <Route path="claims" element={<PhysClaimsScreen />} />
          <Route path="claims/:claimId" element={<PhysClaimDetailScreen />} />
          <Route path="disputes" element={<PhysDisputesScreen />} />
          <Route path="disputes/:notifId" element={<PhysDisputeDetailScreen />} />
        </Route>
        <Route path="/payer/*" element={<Protected role="plan_investigator"><PlanPortal /></Protected>} />
        {/* Back-compat: old /plan/* links redirect to the new /payer/* path. */}
        <Route path="/plan/*" element={<Navigate to="/payer/dashboard" replace />} />
        {/* Vendor dispute portal — public, token-gated via signed URL */}
        <Route path="/vendor/disputes/:case_id" element={<VendorDisputePage />} />
        {/* Vendor session portal — requires vendor role */}
        <Route path="/vendor/portal/*" element={<Protected role="vendor"><VendorPortal /></Protected>} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </>
  )
}
