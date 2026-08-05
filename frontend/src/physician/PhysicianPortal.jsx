// ─────────────────────────────────────────────────────────────────────────
// Physician portal — L2 nested-route layout + screens + the physician-side
// dispute-table helpers. The shared PFilterTh filter-header now lives in
// components/ui (imported below).
// ─────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, useParams, useOutletContext, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AlertsProvider } from '../context/AlertsContext'
import Shell from '../components/Shell'
import { Icon, fmtUSD, fmtDate, timeAgo, buildDisputeTimeline, PFilterTh } from '../components/ui'
import PhysicianDashboard from '../components/PhysicianDashboard'
import ClaimsTable, { ACTIONS, ClaimDetailScreen } from '../components/ClaimsTable'
import SummaryCardSkeleton from '../components/SummaryCardSkeleton'
import GhostBillingToast from '../components/GhostBillingToast'
import {
  PHYSICIAN_NPI, getPhysician, getClaim, getNotificationsCount, markNotificationsSeen,
  getNpiWatchNotifications, getNpiWatchStats, getPhysicianBellNotifications,
  confirmDisputeResolution, subscribeDisputeStream,
} from '../api'

const PHYS_NAV = [
  { id: 'summary', label: 'My Dashboard', icon: 'dashboard' },
  { id: 'claims', label: 'My Claims', icon: 'claims' },
  { id: 'alerts', label: 'My Disputes', icon: 'alertTri' },
]
const PHYS_TITLES = { summary: 'My Dashboard', claims: 'Claims Under My NPI', claimDetail: 'Claim Detail', alerts: 'My Disputes', disputeDetail: 'Dispute Detail' }
// Built from ClaimsTable's ACTIONS, so each filter is named exactly as the button
// the physician pressed — Confirm / Report Fraud / Flag Vendor / Reassign Patient /
// Deceased Patient — and stays in step if a button is ever renamed.
//
// No Disputes tab: DISPUTE-type cases (from the emailed CONFIRM/DISPUTE/FRAUD_REPORT
// links in respond.py) aren't one of the five in-app actions. They still arrive and
// still render; they're reachable under All rather than having a filter of their own.
// Shortened for the pill row: the buttons read "Report Fraud" / "Flag Vendor", which
// are too long as tabs in a 360px panel. ACTIONS still decides WHICH filters exist —
// add an action and its filter appears, falling back to the button's own label.
const NOTIF_TAB_LABEL = {
  confirmed:       'Confirm',
  fraud:           'Fraud',
  flagged:         'Flag',
  unknownPatient:  'Reassign Patient',
  deceasedPatient: 'Deceased Patient',
}
const PHYS_NOTIF_TABS = [
  { id: 'all', label: 'All' },
  ...ACTIONS.map((a) => ({ id: a.id, label: NOTIF_TAB_LABEL[a.id] || a.label })),
]

// Icon + tone per category, matching that action's own button in ClaimsTable so a
// row is recognisable at a glance as "the fraud report I filed". `dispute` has no
// tab but keeps an entry here so those rows still badge correctly under All.
const PHYS_NOTIF_STYLE = {
  confirmed:       { icon: 'check',       bg: '#E9F3ED', fg: '#3A7D5C' },
  fraud:           { icon: 'shieldAlert', bg: '#F7EBEA', fg: '#A6453F' },
  dispute:         { icon: 'message',     bg: '#E9F0F6', fg: '#5A9BC9' },
  flagged:         { icon: 'flag',        bg: '#F1F4F9', fg: '#647089' },
  unknownPatient:  { icon: 'userx',       bg: '#F1F4F9', fg: '#93A0B3' },
  deceasedPatient: { icon: 'heartOff',    bg: '#F2EEF7', fg: '#7A6899' },
}

// Physician bell — recent-activity dropdown for the dashboard's bell icon.
// Only shows events caused by someone else (a vendor responding, or an
// auto-escalation) — never the physician's own dispute/fraud/confirm actions,
// same convention as the vendor/payer bells.
function PhysicianNotifBell({ count, notifications, open, onToggle, onMarkRead, onSelect, marking }) {
  const [tab, setTab] = useState('all')
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onToggle(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onToggle])

  const filtered = tab === 'all' ? notifications : notifications.filter((n) => n.category === tab)

  return (
    <div ref={ref} className="relative">
      <button onClick={() => onToggle(!open)} title="Recent activity"
              className="relative w-9 h-9 rounded-full border bg-white flex items-center justify-center transition-colors hover:bg-slate-50"
              style={{ borderColor: '#E1E6EE', color: '#46586F' }}>
        <Icon name="alerts" size={16} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[9.5px] font-bold flex items-center justify-center"
                style={{ background: '#A6453F', border: '2px solid #fff' }}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-16px)] bg-white rounded-xl z-50 overflow-hidden border border-slate-200"
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>
          <div className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-slate-100">
            <span className="text-[14px] font-bold text-slate-800">Recent activity</span>
            <button onClick={onMarkRead} disabled={marking || count === 0}
                    className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-800 disabled:text-slate-300 disabled:cursor-default">
              Mark all read
            </button>
          </div>
          {/* Wraps: six filters don't fit one row in a 360px panel. */}
          <div className="flex flex-wrap gap-1 px-3 py-2.5">
            {PHYS_NOTIF_TABS.map((t) => (
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
              const st = PHYS_NOTIF_STYLE[n.category] || PHYS_NOTIF_STYLE.dispute
              return (
                <button key={n.id} onClick={() => onSelect(n)}
                        className={`w-full flex gap-2.5 text-left px-2 py-2.5 rounded-lg hover:bg-slate-50 ${!n.read ? 'bg-slate-50/80' : ''}`}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: st.bg }}>
                    <Icon name={st.icon} size={14} style={{ color: st.fg }} />
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
        </div>
      )}
    </div>
  )
}
// ─── Physician portal ──────────────────────────────────────────────────────
// ─── Physician portal routing (L2 — real nested routes) ─────────────────────
// URL is the single source of truth; each screen is its own route component.
// Shared state (profile, dispute feed, notifications, search) lives in the
// layout and reaches the screens via Outlet context — per-screen UI state
// (claim filters, dispute-list filters) stays inside the screen that owns it.
const PHYS_SCREEN_PATH = { summary: '/physician/dashboard', claims: '/physician/claims', alerts: '/physician/disputes' }

// pathname (+ preview query) → the internal screen name the Shell chrome keys
// off (title / activeId / breadcrumbs / search mode). Detail ids are read by
// the screen components themselves via useParams, not here.
function parsePhysicianRoute(location) {
  const q = new URLSearchParams(location.search)
  if (q.get('preview') === '1' && q.get('screen')) return { screen: q.get('screen'), preview: true }
  const rest = location.pathname.replace(/^\/physician\/?/, '').replace(/\/+$/, '')
  const seg = rest.split('/')[0]
  const hasId = rest.split('/').length > 1
  switch (seg) {
    case '':
    case 'dashboard': return { screen: 'summary' }
    case 'claims':    return { screen: hasId ? 'claimDetail' : 'claims' }
    case 'disputes':  return { screen: hasId ? 'disputeDetail' : 'alerts' }
    default:          return { screen: 'summary' }
  }
}

function usePhysCtx() { return useOutletContext() }

function PhysicianLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const npi = user?.npi || PHYSICIAN_NPI
  const route = parsePhysicianRoute(location)
  const screen = route.screen

  const [physician, setPhysician] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [npiAlerts, setNpiAlerts] = useState([])
  const [npiStats, setNpiStats] = useState(null)
  const [npiAlertsLoading, setNpiAlertsLoading] = useState(false)
  const [claimSearch, setClaimSearch] = useState('')
  const [confirmingCaseId, setConfirmingCaseId] = useState(null)
  const [notifCount, setNotifCount] = useState(0)
  const [physNotifications, setPhysNotifications] = useState([])
  const [physNotifOpen, setPhysNotifOpen] = useState(false)
  const [physNotifMarking, setPhysNotifMarking] = useState(false)

  useEffect(() => { getNotificationsCount().then(setNotifCount).catch(() => {}) }, [])
  useEffect(() => { getPhysicianBellNotifications().then(setPhysNotifications).catch(() => {}) }, [])

  function refreshPhysicianBellNotifications() {
    getPhysicianBellNotifications().then(setPhysNotifications).catch(() => {})
  }
  function togglePhysNotif(next) {
    setPhysNotifOpen(next)
    if (next) markAllPhysicianNotificationsRead()
  }
  function markAllPhysicianNotificationsRead() {
    setPhysNotifMarking(true)
    markNotificationsSeen()
      .then(() => { setNotifCount(0); setPhysNotifications((prev) => prev.map((n) => ({ ...n, read: true }))) })
      .catch(() => {})
      .finally(() => setPhysNotifMarking(false))
  }
  // A bell notification points at a dispute case — resolve it to the matching
  // NPI Watch notification and open that notification's Dispute Detail URL.
  function selectPhysicianNotification(n) {
    setPhysNotifOpen(false)
    if (!n.case_id) { navigate('/physician/disputes'); return }
    getNpiWatchNotifications().then((a) => {
      const match = a.notifications.find((x) => x.dispute?.case_id === n.case_id)
      navigate(match ? `/physician/disputes/${match.notification_id}` : '/physician/disputes')
    }).catch(() => navigate('/physician/disputes'))
  }

  async function loadData() {
    setLoading(true); setError(null)
    try {
      const p = await getPhysician(npi)
      setPhysician(p.physician); setSummary(p.summary)
      getNpiWatchStats().then(setNpiStats).catch(() => {})
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { loadData() }, [npi])

  async function loadAlerts() {
    setNpiAlertsLoading(true)
    try {
      const [a, s] = await Promise.all([getNpiWatchNotifications(), getNpiWatchStats()])
      setNpiAlerts(a.notifications); setNpiStats(s)
    } catch { /* keep last state */ } finally { setNpiAlertsLoading(false) }
  }
  // Load the dispute feed whenever a dispute screen is showing (list or detail,
  // incl. a cold deep link straight onto a case).
  useEffect(() => { if (screen === 'alerts' || screen === 'disputeDetail') loadAlerts() }, [screen])

  // Live push — a vendor responding, or a case reopening, refreshes the feed.
  useEffect(() => {
    const es = subscribeDisputeStream('/api/v1/physician/npi-watch/alerts/stream', () => {
      getNotificationsCount().then(setNotifCount).catch(() => {})
      refreshPhysicianBellNotifications()
      Promise.all([getNpiWatchNotifications(), getNpiWatchStats()]).then(([a, s]) => {
        setNpiAlerts(a.notifications); setNpiStats(s)
      }).catch(() => {})
    })
    return () => es.close()
  }, [])

  async function handleConfirmResolution(caseId, confirmed) {
    setConfirmingCaseId(caseId)
    try {
      await confirmDisputeResolution(caseId, confirmed)
      const [a, s] = await Promise.all([getNpiWatchNotifications(), getNpiWatchStats()])
      setNpiAlerts(a.notifications); setNpiStats(s)
    } catch { /* keep the card as-is; physician can retry */ }
    finally { setConfirmingCaseId(null) }
  }

  async function handleActioned() {
    try { const p = await getPhysician(npi); setPhysician(p.physician); setSummary(p.summary) }
    catch { /* keep last good state */ }
  }

  const pendingCount = summary?.pendingReview ?? 0

  function go(s) {
    setClaimSearch('')
    const path = PHYS_SCREEN_PATH[s] || '/physician/dashboard'
    if (location.pathname !== path) navigate(path)
  }

  // Route-derived breadcrumbs (no history walk).
  const breadcrumbs = (() => {
    const dash = { label: 'My Dashboard', onClick: () => navigate('/physician/dashboard') }
    switch (screen) {
      case 'claims':        return [dash, { label: 'My Claims', active: true }]
      case 'claimDetail':   return [dash, { label: 'My Claims', onClick: () => navigate('/physician/claims') }, { label: 'Claim Detail', active: true }]
      case 'alerts':        return [dash, { label: 'My Disputes', active: true }]
      case 'disputeDetail': return [dash, { label: 'My Disputes', onClick: () => navigate('/physician/disputes') }, { label: 'Dispute Detail', active: true }]
      default: return []
    }
  })()

  const activeId = screen === 'claimDetail' ? 'claims' : screen === 'disputeDetail' ? 'alerts' : screen

  const ctx = {
    npi, physician, summary, loading, error, pendingCount, loadData, handleActioned,
    claimSearch, npiAlerts, npiStats, npiAlertsLoading, confirmingCaseId, handleConfirmResolution,
  }

  return (
    <>
    <GhostBillingToast />
    <Shell navItems={PHYS_NAV}
           layout="navbar-plain"
           transparentHeader iconOnlyNav
           brandName={physician?.name || 'Physician'}
           activeId={activeId} onNavigate={go}
           canGoBack={screen !== 'summary'} onBack={() => navigate(-1)}
           showSearch searchPlainMode searchPlaceholder="Search claims…"
           searchValue={claimSearch}
           onSearchChange={(v) => { setClaimSearch(v); if (v && screen !== 'claims') navigate('/physician/claims') }}
           title={PHYS_TITLES[screen]} user={user}
           notifCount={notifCount} bellTitle="New dispute activity"
           onBellClick={() => { markNotificationsSeen().then(() => setNotifCount(0)).catch(() => {}); navigate('/physician/disputes') }}
           bellSlot={
             <PhysicianNotifBell
               count={notifCount}
               notifications={physNotifications}
               open={physNotifOpen}
               onToggle={togglePhysNotif}
               onMarkRead={markAllPhysicianNotificationsRead}
               marking={physNotifMarking}
               onSelect={selectPhysicianNotification}
             />
           }
           breadcrumbs={breadcrumbs}
           scrollable={screen !== 'summary' && screen !== 'claimDetail'}
           onLogout={async () => { await logout(); navigate('/welcome', { replace: true }) }}>
      <Outlet context={ctx} />
    </Shell>
    </>
  )
}

// ── Physician screen route components ──
function PhysDashboardScreen() {
  const { physician, summary, loading, error, pendingCount, npi, loadData } = usePhysCtx()
  const navigate = useNavigate()
  const selectClaim = (claim) => navigate(`/physician/claims/${claim.id}`, { state: { claim } })
  if (error) return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <div className="mc-card border-rose-200 bg-rose-50/50 px-6 py-5">
        <div className="text-sm font-semibold text-rose-600">Couldn't load dashboard data</div>
        <div className="text-xs text-slate-500 mt-1">{error}. Is the backend running on :4001?</div>
        <button onClick={loadData} className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg btn-navy">Retry</button>
      </div>
    </div>
  )
  if (loading) return <SummaryCardSkeleton />
  return <PhysicianDashboard physician={physician} summary={summary} pendingCount={pendingCount}
                             npi={npi} onSelectClaim={selectClaim}
                             setActiveScreen={(s) => navigate(PHYS_SCREEN_PATH[s] || '/physician/dashboard')} />
}

function PhysClaimsScreen() {
  const { npi, claimSearch, handleActioned } = usePhysCtx()
  const navigate = useNavigate()
  const [supplierFilter, setSupplierFilter] = useState(null)
  return (
    <ClaimsTable npi={npi} onActioned={handleActioned}
                 onSelectClaim={(claim) => navigate(`/physician/claims/${claim.id}`, { state: { claim } })}
                 supplierFilter={supplierFilter} onSupplierFilterChange={setSupplierFilter}
                 externalSearch={claimSearch} />
  )
}

function PhysClaimDetailScreen() {
  const { npi, handleActioned } = usePhysCtx()
  const { claimId } = useParams()
  const location = useLocation()
  // In-session nav hands the row over via state (instant); a deep link / refresh
  // arrives with only the id, so fetch it.
  const [claim, setClaim] = useState(() =>
    location.state?.claim && String(location.state.claim.id) === String(claimId) ? location.state.claim : null)
  useEffect(() => {
    if (claim && String(claim.id) === String(claimId)) return
    let cancelled = false
    getClaim(npi, claimId).then((c) => { if (!cancelled) setClaim(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [claimId, npi])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!claim) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-7 w-7 rounded-full border-2 border-navy border-t-transparent" />
    </div>
  )
  return <ClaimDetailScreen claim={claim} npi={npi} onActioned={handleActioned} />
}

function PhysDisputesScreen() {
  const { npiAlerts, npiAlertsLoading } = usePhysCtx()
  const navigate = useNavigate()
  const [disputeStatusFilter, setDisputeStatusFilter] = useState('ALL')
  const [resolutionFilter, setResolutionFilter] = useState('ALL')
  const [vendorFilter, setVendorFilter] = useState('ALL')
  const [disputeSort, setDisputeSort] = useState({ key: null, dir: null })

  const vendorOptions = [
    { id: 'ALL', label: 'All' },
    ...Array.from(new Set(npiAlerts.map((n) => n.vendor_name).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ id: name, label: name })),
  ]
  const filteredNpiAlerts = npiAlerts.filter((n) =>
    (disputeStatusFilter === 'ALL' || disputeRowKind(n) === disputeStatusFilter) &&
    (resolutionFilter === 'ALL' || resolutionInfo(n.dispute).tone === resolutionFilter) &&
    (vendorFilter === 'ALL' || n.vendor_name === vendorFilter)
  )
  function onDisputeSort(key) {
    setDisputeSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }
  const sortedNpiAlerts = (() => {
    const arr = [...filteredNpiAlerts]
    if (disputeSort.key && DISPUTE_COMPARATORS[disputeSort.key]) {
      arr.sort(DISPUTE_COMPARATORS[disputeSort.key])
      if (disputeSort.dir === 'desc') arr.reverse()
    }
    return arr
  })()
  const openRow = (n) => navigate(`/physician/disputes/${n.notification_id}`, { state: { dispute: n } })

  if (npiAlertsLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-7 w-7 rounded-full border-2 border-navy border-t-transparent" />
    </div>
  )
  if (npiAlerts.length === 0) return (
    <div className="w-full px-4 sm:px-7 py-6">
      <div className="mc-card px-6 py-8 text-center text-slate-400 text-sm">
        No disputes yet. When you dispute a claim or report fraud from My Claims, it will appear here for tracking.
      </div>
    </div>
  )
  return (
    <div className="w-full h-full flex flex-col px-4 sm:px-7 py-6 min-h-0">
      <div className="mc-card flex flex-col flex-1 min-h-0 overflow-hidden">
        {filteredNpiAlerts.length === 0 && (
          <div className="px-6 py-8 text-center text-slate-400 text-sm">No disputes match the selected filters.</div>
        )}
        {/* Mobile card view (<sm) */}
        <div className="sm:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
          {sortedNpiAlerts.map((n) => {
            const d = n.dispute
            const res = resolutionInfo(d)
            const review = needsReview(d)
            return (
              <div key={n.notification_id} onClick={() => openRow(n)} className="px-4 py-3 cursor-pointer active:bg-slate-50">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-mono text-[12px] font-semibold text-[#2B3A52] truncate">{n.claim_number}</span>
                  <span className="text-sm font-bold text-[#111827] flex-shrink-0">{n.amount_billed != null ? fmtUSD(n.amount_billed) : '—'}</span>
                </div>
                <div className="text-[13px] text-slate-700 truncate mb-0.5">{n.vendor_name}{n.vendor_type ? ` · ${n.vendor_type}` : ''}</div>
                <div className="text-[11px] text-slate-400 mb-2">
                  {n.dos_from ? fmtDate(n.dos_from) : '—'}{n.dos_to && n.dos_to !== n.dos_from ? ` – ${fmtDate(n.dos_to)}` : ''}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {statusBadge(disputeRowKind(n))}
                    <span className={`pbadge ${RESOLUTION_TONE[res.tone]}`} style={{ fontSize: 11, padding: '4px 10px' }}>
                      {res.icon && <Icon name={res.icon} size={11} stroke={2.4} />}
                      {res.label}
                    </span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); openRow(n) }} className={`flex-shrink-0 ${review ? 'take-action-btn' : 'view-btn'}`}>
                    {review ? 'Review' : 'View'} →
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {/* Desktop table view (sm+) */}
        <div className="hidden sm:block flex-1 min-h-0 overflow-auto">
          <table className="w-full text-[13px]" style={{ minWidth: 760 }}>
            <thead className="sticky top-0 z-10">
              <tr>
                <SortableDisputeTh label="Claim" sortKey="claim" sort={disputeSort} onSort={onDisputeSort} />
                <PFilterTh label="Vendor" options={vendorOptions} value={vendorFilter} onChange={setVendorFilter} />
                <SortableDisputeTh label="DOS" sortKey="dos" sort={disputeSort} onSort={onDisputeSort} />
                <SortableDisputeTh label="Billed" sortKey="billed" sort={disputeSort} onSort={onDisputeSort} right />
                <PFilterTh label="Status" options={DISPUTE_STATUS_OPTIONS} value={disputeStatusFilter} onChange={setDisputeStatusFilter} />
                <PFilterTh label="Resolution" options={RESOLUTION_OPTIONS} value={resolutionFilter} onChange={setResolutionFilter} />
                <th className={DISPUTE_TH}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedNpiAlerts.map((n) => {
                const d = n.dispute
                const res = resolutionInfo(d)
                const review = needsReview(d)
                return (
                  <tr key={n.notification_id} onClick={() => openRow(n)} className="cursor-pointer hover:bg-slate-50 transition-colors">
                    <td className={`${DISPUTE_TD} font-mono text-[#2B3A52]`}>{n.claim_number}</td>
                    <td className={DISPUTE_TD}>{n.vendor_name}{n.vendor_type ? ` · ${n.vendor_type}` : ''}</td>
                    <td className={`${DISPUTE_TD} whitespace-nowrap`}>{n.dos_from ? fmtDate(n.dos_from) : '—'}{n.dos_to && n.dos_to !== n.dos_from ? ` – ${fmtDate(n.dos_to)}` : ''}</td>
                    <td className={`${DISPUTE_TD} text-right font-bold whitespace-nowrap`}>{n.amount_billed != null ? fmtUSD(n.amount_billed) : '—'}</td>
                    <td className={DISPUTE_TD}>{statusBadge(disputeRowKind(n))}</td>
                    <td className={DISPUTE_TD}>
                      <span className={`pbadge ${RESOLUTION_TONE[res.tone]}`}>
                        {res.icon && <Icon name={res.icon} size={12} stroke={2.4} />}
                        {res.label}
                      </span>
                    </td>
                    <td className={DISPUTE_TD}>
                      <button onClick={(e) => { e.stopPropagation(); openRow(n) }} className={review ? 'take-action-btn' : 'view-btn'}>
                        {review ? 'Review' : 'View'} →
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function PhysDisputeDetailScreen() {
  const { npiAlerts, confirmingCaseId, handleConfirmResolution } = usePhysCtx()
  const { notifId } = useParams()
  const location = useLocation()
  const dispute = npiAlerts.find((x) => String(x.notification_id) === String(notifId)) || location.state?.dispute || null
  if (!dispute) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-7 w-7 rounded-full border-2 border-navy border-t-transparent" />
    </div>
  )
  return (
    <DisputeDetailScreenPhysician
      dispute={dispute}
      confirmingCaseId={confirmingCaseId}
      onConfirm={handleConfirmResolution}
    />
  )
}

// ─── My Disputes table — cell helpers ───────────────────────────────────────
const DISPUTE_TH = 'text-left py-2.5 px-3.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-slate-400 bg-slate-50 border-b border-slate-100 whitespace-nowrap'
const DISPUTE_TD = 'py-3 px-3.5 align-middle'
const RESOLUTION_TONE = { responded: 'success', waiting: 'warning', overdue: 'error', none: 'neutral' }

// Client-side column sort for the Claim/DOS/Billed headers — same idea as
// ClaimsTable.jsx's CLAIM_COMPARATORS (My Claims).
const DISPUTE_COMPARATORS = {
  claim:  (a, b) => (a.claim_number || '').localeCompare(b.claim_number || ''),
  dos:    (a, b) => (a.dos_from ? new Date(a.dos_from).getTime() : 0) - (b.dos_from ? new Date(b.dos_from).getTime() : 0),
  billed: (a, b) => (a.amount_billed || 0) - (b.amount_billed || 0),
}

const DISPUTE_STATUS_OPTIONS = [
  { id: 'ALL',              label: 'All' },
  { id: 'DISPUTED',         label: 'Disputed',         dot: '#C99A3E' },
  { id: 'FRAUD_REPORTED',   label: 'Fraud reported',   dot: '#9A3F39' },
  { id: 'DECEASED_PATIENT', label: 'Deceased patient', dot: '#7A6899' },
]

// Deceased-patient cases share the FRAUD_REPORTED notification status (see
// backend _STATUS_MAP) — the case's dispute_type is what actually tells them
// apart, so the Status column/filter key off it when a case exists.
function disputeRowKind(n) {
  if (n.dispute?.dispute_type === 'DECEASED_PATIENT') return 'DECEASED_PATIENT'
  return n.status
}
const RESOLUTION_OPTIONS = [
  { id: 'ALL',       label: 'All' },
  { id: 'waiting',   label: 'Awaiting vendor',  dot: '#C99A3E' },
  { id: 'responded', label: 'Vendor responded', dot: '#3A7D5C' },
  { id: 'overdue',   label: 'Overdue',          dot: '#A6453F' },
  { id: 'none',      label: 'Not yet notified', dot: '#93A0B3' },
]

// Same status precedence as the Dispute Detail timeline, condensed to one
// line + icon for the list row instead of the full timeline/response text.
function resolutionInfo(d) {
  if (!d) return { label: 'Awaiting vendor notification', tone: 'none', icon: null }
  if (d.status === 'NON_RESPONSIVE' || d.deadline_passed) {
    return { label: 'Overdue — escalated to compliance', tone: 'overdue', icon: 'alertTri' }
  }
  if (d.status === 'PENDING_PHYSICIAN_REVIEW') {
    return { label: 'Vendor uploaded docs — review', tone: 'responded', icon: 'check' }
  }
  if (d.status === 'RESOLVED_BY_PHYSICIAN' || d.status === 'REFERRED_TO_PAYER' ||
      d.status === 'RESPONDED_TO_MEDICARE' || d.status === 'PENDING_PHYSICIAN_CONFIRMATION') {
    return { label: 'Vendor responded', tone: 'responded', icon: 'check' }
  }
  return { label: `Awaiting vendor${d.days_remaining != null ? ` · ${d.days_remaining}d left` : ''}`, tone: 'waiting', icon: 'clock' }
}

// "Review" when the vendor has uploaded documents and the physician's
// approve/decline is what the case is waiting on — "View" otherwise.
function needsReview(d) {
  return !!d && d.status === 'PENDING_PHYSICIAN_REVIEW'
}

function statusBadge(status) {
  if (status === 'DECEASED_PATIENT') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#F2EEF7,#EAE3F2)', color: '#5F4E80' }}>
        Deceased patient
      </span>
    )
  }
  if (status === 'FRAUD_REPORTED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white whitespace-nowrap"
            style={{ background: 'linear-gradient(180deg,#B95951,#9A3F39)' }}>
        Fraud reported
      </span>
    )
  }
  if (status === 'DISPUTED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-200 whitespace-nowrap">
        Disputed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-slate-600 bg-slate-100 whitespace-nowrap">
      {status}
    </span>
  )
}

// Claim/DOS/Billed column header — click cycles asc → desc → cleared (see
// onDisputeSort), same convention as My Claims' own sortable headers.
function SortableDisputeTh({ label, sortKey, sort, onSort, right = false }) {
  const active = sort.key === sortKey
  return (
    <th onClick={() => onSort(sortKey)}
        className={`${DISPUTE_TH} ${right ? 'text-right' : ''} cursor-pointer select-none group`}>
      <span className={`inline-flex items-center gap-1 group-hover:text-[#1E3A5F] transition-colors ${right ? 'justify-end' : ''}`}>
        {label}
        {active
          ? <span className="text-[#1E3A5F] font-bold">{sort.dir === 'asc' ? '↑' : '↓'}</span>
          : <span className="text-slate-300 group-hover:text-[#1E3A5F] transition-colors">↕</span>}
      </span>
    </th>
  )
}

// Same enum both sides of a case share — mirrors the vendor portal's own
// DISPUTE_STATUS_TONE/ICON/LABEL maps (VendorPortalInner.jsx) exactly, just
// rendered with the unscoped .pbadge recipe since this file isn't wrapped
// in .vendor-theme.
const PDISPUTE_STATUS_TONE = {
  OPEN:                  'warning',
  NON_RESPONSIVE:        'error',
  RESPONDED_TO_MEDICARE: 'success',
  RESOLVED_BY_PHYSICIAN: 'success',
  PENDING_PHYSICIAN_CONFIRMATION: 'info',
  PENDING_PHYSICIAN_REVIEW: 'info',
  REFERRED_TO_PAYER:     'error',
}
const PDISPUTE_STATUS_ICON = {
  OPEN:                  'clock',
  NON_RESPONSIVE:        'x',
  RESPONDED_TO_MEDICARE: 'check',
  RESOLVED_BY_PHYSICIAN: 'check',
  PENDING_PHYSICIAN_CONFIRMATION: 'clock',
  PENDING_PHYSICIAN_REVIEW: 'clock',
  REFERRED_TO_PAYER:     'alertTri',
}
const PDISPUTE_STATUS_LABEL = {
  OPEN:                  'Open',
  NON_RESPONSIVE:        'Non-responsive',
  RESPONDED_TO_MEDICARE: 'Responded to Medicare',
  RESOLVED_BY_PHYSICIAN: 'Resolved',
  PENDING_PHYSICIAN_CONFIRMATION: 'Pending confirmation',
  PENDING_PHYSICIAN_REVIEW: 'Review vendor docs',
  REFERRED_TO_PAYER:     'Referred to payer',
}

function PDisputeStatusBadge({ status }) {
  const tone = PDISPUTE_STATUS_TONE[status] || 'neutral'
  const label = PDISPUTE_STATUS_LABEL[status] || status?.replace(/_/g, ' ') || '—'
  return <span className={`pbadge ${tone}`}><Icon name={PDISPUTE_STATUS_ICON[status] || 'clock'} size={12} />{label}</span>
}

function PDisputeTypeBadge({ type }) {
  if (type === 'DECEASED_PATIENT') {
    return (
      <span className="pbadge" style={{ background: 'linear-gradient(180deg,#F2EEF7,#EAE3F2)', color: '#5F4E80' }}>
        <Icon name="heartOff" size={12} />
        Deceased patient
      </span>
    )
  }
  const isFraud = type === 'FRAUD_REPORT'
  return (
    <span className={`pbadge ${isFraud ? 'solid' : 'warning'}`}>
      <Icon name={isFraud ? 'shieldAlert' : 'message'} size={12} />
      {isFraud ? 'Fraud report' : 'Dispute'}
    </span>
  )
}

// Live split-flap countdown to a response deadline — mirrors the vendor
// portal's own useCountdown hook exactly.
function usePCountdown(targetDate) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!targetDate) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [targetDate])

  if (!targetDate) return null
  const target = new Date(targetDate).getTime()
  const diff = target - now
  const expired = diff <= 0
  const totalSeconds = Math.max(0, Math.floor(diff / 1000))
  return {
    days:    Math.floor(totalSeconds / 86400),
    hours:   Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    expired,
  }
}

function PDigitGroup({ value, unit, bg }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-[3px]">
        {String(value).padStart(2, '0').split('').map((ch, i) => (
          <div key={i} className="pcountdown-digit" style={{ background: bg }}>{ch}</div>
        ))}
      </div>
      <span className="text-[9px] uppercase tracking-wide text-slate-400">{unit}</span>
    </div>
  )
}

function PCountdownDigits({ days, hours, minutes, bg }) {
  const sep = <span className="font-bold self-start text-slate-400" style={{ marginTop: 6 }}>:</span>
  return (
    <div className="flex items-center gap-1">
      <PDigitGroup value={days} unit="days" bg={bg} />
      {sep}
      <PDigitGroup value={hours} unit="hours" bg={bg} />
      {sep}
      <PDigitGroup value={minutes} unit="mins" bg={bg} />
    </div>
  )
}

// Header countdown widget — a LIVE ticking clock ("Response due in") while
// the vendor hasn't responded yet, or a static elapsed-time readout
// ("Resolved in") once they have. Mirrors the vendor's DisputeCountdown.
function PDisputeCountdown({ d }) {
  const stillOpen = !d.vendor_responded_at && d.status !== 'NON_RESPONSIVE'
  const live = usePCountdown(stillOpen ? d.response_due_date : null)

  if (d.vendor_responded_at) {
    const start = d.billing_provider_notified_at ? new Date(d.billing_provider_notified_at).getTime() : null
    const end = new Date(d.vendor_responded_at).getTime()
    const totalSeconds = start != null ? Math.max(0, Math.floor((end - start) / 1000)) : 0
    return (
      <div className="text-right">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Resolved in</div>
        <PCountdownDigits
          days={Math.floor(totalSeconds / 86400)}
          hours={Math.floor((totalSeconds % 86400) / 3600)}
          minutes={Math.floor((totalSeconds % 3600) / 60)}
          bg="#3A7D5C"
        />
      </div>
    )
  }

  if (d.status === 'NON_RESPONSIVE') {
    return (
      <div className="text-right">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Response window closed</div>
        <PCountdownDigits days={0} hours={0} minutes={0} bg="#8A3B35" />
      </div>
    )
  }

  if (!live) return null
  return (
    <div className="text-right">
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-slate-500">
        {live.expired ? 'Response window closed' : 'Response due in'}
      </div>
      <PCountdownDigits
        days={live.expired ? 0 : live.days}
        hours={live.expired ? 0 : live.hours}
        minutes={live.expired ? 0 : live.minutes}
        bg={live.expired ? '#8A3B35' : '#0A1F3D'}
      />
    </div>
  )
}

// ─── Physician-side dispute detail — click-through from My Disputes, mirrors
// the vendor portal's own Dispute Detail screen so both sides of the same
// case get an equivalent full view instead of everything crammed into a card.
function DisputeDetailScreenPhysician({ dispute: n, confirmingCaseId, onConfirm }) {
  if (!n) return <div className="px-7 py-8 text-slate-400">No dispute selected.</div>
  const d = n.dispute
  const busy = !!d && confirmingCaseId === d.case_id

  return (
    <div className="px-4 sm:px-7 py-5 space-y-5">
      {/* Case header — same title/badge/countdown layout as the vendor's own
          Dispute Detail screen. */}
      <div className="mc-card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">{d ? `Case #${d.case_id} — ` : ''}Claim {n.claim_number}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {d ? <PDisputeTypeBadge type={d.dispute_type} /> : (
                <span className={`pbadge ${n.status === 'FRAUD_REPORTED' ? 'solid' : 'warning'}`}>{n.status?.replace(/_/g, ' ')}</span>
              )}
              {d && <PDisputeStatusBadge status={d.status} />}
            </div>
          </div>
          {d && <PDisputeCountdown d={d} />}
        </div>
      </div>

      {/* Claim details on the left, full case history on the right — same
          capped-height + internal-scroll pairing as the vendor's screen so
          neither card pushes the page taller than its neighbor. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
        <div className="mc-card flex flex-col lg:max-h-[520px]" style={{ padding: '22px 24px' }}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-[18px] flex-shrink-0 text-slate-500">Claim Details</h3>
          <div className="overflow-y-auto flex-1 min-h-0">
            {(() => {
              const fields = [
                ['Patient',         n.patient_name_partial || '—'],
                ['Vendor',          `${n.vendor_name || '—'}${n.vendor_type ? ` · ${n.vendor_type}` : ''}`],
                ['Service',         n.service_description || '—'],
                ['HCPCS Codes',     Array.isArray(n.hcpcs_codes) ? (n.hcpcs_codes.join(', ') || '—') : (n.hcpcs_codes || '—')],
                ['Date of Service', n.dos_from ? `${fmtDate(n.dos_from)}${n.dos_to && n.dos_to !== n.dos_from ? ` – ${fmtDate(n.dos_to)}` : ''}` : '—'],
                ['Your Role',       n.physician_npi_role || '—'],
              ]
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2" style={{ columnGap: 24 }}>
                  {fields.map(([label, value], i) => (
                    <div key={label} className="py-3" style={{ borderBottom: i < fields.length - 2 ? '1px solid #F1F4F9' : 'none' }}>
                      <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1 text-slate-400">{label}</div>
                      <div className="text-[14px] font-semibold text-[#0A1F3D]">{value}</div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>

        <div className="mc-card flex flex-col lg:max-h-[520px]" style={{ padding: '22px 24px' }}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-[18px] flex-shrink-0 text-slate-500">Timeline</h3>
          <div className="overflow-y-auto flex-1 min-h-0">
            {d ? (
              <PhysicianDisputeTimeline d={d} busy={busy} onConfirm={onConfirm} />
            ) : (
              <span className="text-[12px] font-medium text-slate-400">Awaiting vendor notification</span>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}

// Icon + color per timeline step type (see buildDisputeTimeline's `type` tag) —
// a colored icon badge instead of a plain dot, one glance tells you what kind
// of thing happened at each step instead of just that something did.
const PCTL_STEP_STYLE = {
  fraud:           { icon: 'shieldAlert', bg: '#F7EBEA', fg: '#A6453F' },
  dispute:         { icon: 'alertTri',    bg: '#FBF3E4', fg: '#8A6A34' },
  deceased:        { icon: 'heartOff',    bg: '#F2EEF7', fg: '#7A6899' },
  notified:        { icon: 'mail',        bg: '#E9F0F6', fg: '#35607D' },
  vendorResponse:  { icon: 'message',     bg: '#E9F0F6', fg: '#35607D' },
  confirmed:       { icon: 'check',       bg: '#E9F3ED', fg: '#2E6B4F' },
  rejected:        { icon: 'x',           bg: '#F7EBEA', fg: '#A6453F' },
  escalated:       { icon: 'alertTri',    bg: '#F7EBEA', fg: '#A6453F' },
  expired:         { icon: 'clock',       bg: '#FBF3E4', fg: '#8A6A34' },
  pendingConfirm:  { icon: 'clock',       bg: '#FBF3E4', fg: '#8A6A34' },
  pendingAwaiting: { icon: 'clock',       bg: '#F1F4F9', fg: '#647089' },
}
function PctlIcon({ type }) {
  const s = PCTL_STEP_STYLE[type] || PCTL_STEP_STYLE.pendingAwaiting
  return (
    <div className="pctl-icon" style={{ background: s.bg, color: s.fg }}>
      <Icon name={s.icon} size={14} stroke={2.2} />
    </div>
  )
}

// Chronological history of a single dispute case, from the physician's side —
// every step that happened (reported → vendor notified → vendor responded,
// with their notes/docs → your confirmation decision), not just the current
// status snapshot. Same icon/line/box recipe as the vendor's own
// VendorDisputeTimeline (.pctl-* mirrors its .ctl-* classes).
function PhysicianDisputeTimeline({ d, busy, onConfirm }) {
  // Built from the full event log (one row per state transition, oldest first)
  // instead of DisputeCase's own snapshot fields — those only ever hold the
  // latest vendor response, so a case that bounced (resolve w/ physician ->
  // rejected -> responded to Medicare) used to silently lose everything
  // before the last round. Falls back to just the opening fact for any case
  // that somehow has no event log at all (shouldn't happen — the migration
  // backfilled one for every existing case).
  const isFraud = d.dispute_type === 'FRAUD_REPORT'
  const past = [
    ...(d.events?.length
      ? buildDisputeTimeline(d, 'physician')
      : [{ at: d.opened_at, label: isFraud ? 'You reported this as fraud' : 'You disputed this claim', note: d.physician_notes, type: isFraud ? 'fraud' : 'dispute' }]),
    d.billing_provider_notified_at && { at: d.billing_provider_notified_at, label: 'Vendor notified — 15 days to respond', type: 'notified' },
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at))

  // Live/pending steps have no timestamp yet — rendered after the dated history.
  const pending =
    d.status === 'PENDING_PHYSICIAN_REVIEW' ? 'review'
    : d.status === 'OPEN' && !d.deadline_passed ? 'awaiting'
    : null
  const hasTrailingItem = !!pending

  return (
    <div>
      {past.map((t, i) => {
        const isLast = i === past.length - 1 && !hasTrailingItem
        const dt = new Date(t.at)
        return (
          <div key={i} className="pctl-item">
            <div className="pctl-marker-col">
              <PctlIcon type={t.type} />
              {!isLast && <div className="pctl-line" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pctl-date">
                {dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </div>
              <div className="pctl-box">
                <div className="pctl-title">{t.label}</div>
                {t.note && <div className="pctl-quote">"{t.note}"</div>}
                {t.detail && <div className="pctl-quote">"{t.detail}"</div>}
                {t.docs?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {t.docs.map((doc) => (
                      <a key={doc.stored_name} href={doc.download_url} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors">
                        <Icon name="doc" size={11} /> {doc.filename}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {pending === 'review' && (
        <div className="pctl-item">
          <div className="pctl-marker-col"><PctlIcon type="pendingConfirm" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pctl-date">Awaiting</div>
            <div className="pctl-box pending">
              <div className="pctl-title">Review the vendor's documents</div>
              <div className="pctl-quote" style={{ fontStyle: 'normal' }}>
                Do the proof-of-work documents above satisfy your concern on this claim?
                Approving closes the case; declining refers it to the payer.
              </div>
              <div className="flex gap-2 mt-2.5">
                <button onClick={() => onConfirm(d.case_id, true)} disabled={busy} className="pgbtn pgbtn-success pgbtn-sm">
                  ✓ Approve
                </button>
                <button onClick={() => onConfirm(d.case_id, false)} disabled={busy} className="pgbtn pgbtn-danger pgbtn-sm">
                  ✗ Decline
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pending === 'awaiting' && (
        <div className="pctl-item">
          <div className="pctl-marker-col"><PctlIcon type="pendingAwaiting" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pctl-date">Awaiting</div>
            <div className="pctl-box pending">
              <div className="pctl-title">
                Awaiting vendor response{d.days_remaining != null ? ` · ${d.days_remaining}d left` : ''}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PhysicianPortal() {
  return <AlertsProvider><PhysicianLayout /></AlertsProvider>
}

export {
  PhysicianPortal,
  PhysDashboardScreen, PhysClaimsScreen, PhysClaimDetailScreen,
  PhysDisputesScreen, PhysDisputeDetailScreen,
}
