import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import VendorDisputePage from './vendor/VendorDisputePage'
import VendorPortalInner from './vendor/VendorPortalInner'
import { AlertsProvider } from './context/AlertsContext'
import { useAuth, DASHBOARD_PATH } from './context/AuthContext'
import Shell from './components/Shell'
import Login from './screens/Login'
import LandingPage from './screens/LandingPage'
import PayerSignup from './screens/PayerSignup'
import PhysicianSignup from './screens/PhysicianSignup'
import MfaSetup from './screens/MfaSetup'
import MfaBackupCodes from './screens/MfaBackupCodes'
import OtpLogin from './screens/OtpLogin'
import Register from './screens/Register'
import { Icon, StatCard, fmtUSD, fmtDate } from './components/ui'
import SummaryCard from './components/SummaryCard'
import ClaimsTable from './components/ClaimsTable'
import FlaggedSuppliers from './components/FlaggedSuppliers'
import PlanHome from './plan/screens/PlanHome'
import NPILeaderboard from './plan/screens/NPILeaderboard'
import NPIDetail from './plan/screens/NPIDetail'
import SupplierWatchlist from './plan/screens/SupplierWatchlist'
import SupplierDetail from './plan/screens/SupplierDetail'
import SummaryCardSkeleton from './components/SummaryCardSkeleton'
import TableSkeleton from './components/TableSkeleton'
import AnalyticsPanel from './components/AnalyticsPanel'
import PhysicianOverview from './components/PhysicianOverview'
import PhysicianAlerts from './components/PhysicianAlerts'
import GhostBillingToast from './components/GhostBillingToast'
import { StatCardGrid, PhysicianHeader, ReviewBanner } from './components/SummaryCard'
import { PHYSICIAN_NPI, getPhysician, getFlaggedSuppliers, getNotificationsCount, markNotificationsSeen, getNpiWatchNotifications, getNpiWatchStats, getPlanDisputes, confirmDisputeResolution, decideDisputeClaim, API_BASE } from './api'

const PHYS_NAV = [
  { id: 'summary', label: 'My Dashboard', icon: 'dashboard' },
  { id: 'claims', label: 'My Claims', icon: 'claims' },
  { id: 'alerts', label: 'My Disputes', icon: 'alertTri' },
  { id: 'suppliers', label: 'Flagged Suppliers', icon: 'flag' },
]
const PLAN_NAV = [
  { id: 'home', label: 'Dashboard', icon: 'dashboard' },
  { id: 'leaderboard', label: 'NPI Leaderboard', icon: 'leaderboard' },
  { id: 'watchlist', label: 'Supplier Watchlist', icon: 'suppliers' },
  { id: 'disputes', label: 'NPI Disputes', icon: 'alertTri' },
]
const PHYS_TITLES = { summary: 'My Dashboard', claims: 'Claims Under My NPI', alerts: 'My Disputes', disputeDetail: 'Dispute Detail', suppliers: 'Suppliers I Flagged' }
const PLAN_TITLES = { home: 'Payer Portal', leaderboard: 'NPI Risk Leaderboard', detail: 'NPI Detail', watchlist: 'Supplier Watchlist', supplierDetail: 'Supplier Case', alerts: 'Live Alerts', disputes: 'NPI Disputes' }

// ─── Physician portal ──────────────────────────────────────────────────────
function PhysicianPortalInner() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const npi = user?.npi || PHYSICIAN_NPI

  const [screen, setScreen] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return (p.get('preview') === '1' && p.get('screen')) || 'summary'
  })
  const [physician, setPhysician] = useState(null)
  const [summary, setSummary] = useState(null)
  const [flaggedSuppliers, setFlaggedSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [supplierFilter, setSupplierFilter] = useState(null)   // active supplier filter on My Claims
  const [history, setHistory] = useState([])                   // backtrack stack of prior views
  const [npiAlerts, setNpiAlerts] = useState([])
  const [npiStats, setNpiStats] = useState(null)
  const [npiAlertsLoading, setNpiAlertsLoading] = useState(false)
  const [confirmingCaseId, setConfirmingCaseId] = useState(null)
  const [decidingCaseId, setDecidingCaseId] = useState(null)
  const [decideError, setDecideError] = useState(null)
  const [decideResult, setDecideResult] = useState(null)
  const [selectedDispute, setSelectedDispute] = useState(null)
  const [disputeFilter, setDisputeFilter] = useState('ALL')  // ALL | OPEN | RESOLVED — set by clicking the KPI tiles or the status dropdown
  const [disputeTypeFilter, setDisputeTypeFilter] = useState('ALL')  // ALL | DISPUTE | FRAUD_REPORT
  const [disputeSortOrder, setDisputeSortOrder] = useState('NONE')   // NONE | DAYS_ASC | DAYS_DESC

  // Navigate forward, recording the current view so the header back button can restore it.
  function navTo(s, filter = null) {
    setHistory((h) => [...h, { screen, supplierFilter }])
    setSupplierFilter(filter)
    setScreen(s)
  }
  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setScreen(prev.screen)
      setSupplierFilter(prev.supplierFilter)
      return h.slice(0, -1)
    })
  }

  // From Flagged Suppliers: jump to My Claims filtered to that supplier.
  function selectSupplier(name) { navTo('claims', name) }

  async function loadData() {
    setLoading(true); setError(null)
    try {
      const [p, s] = await Promise.all([getPhysician(npi), getFlaggedSuppliers(npi)])
      setPhysician(p.physician); setSummary(p.summary); setFlaggedSuppliers(s)
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
  useEffect(() => { if (screen === 'alerts') loadAlerts() }, [screen])

  // Refresh on entering the detail screen too — otherwise it just shows whatever
  // was in npiAlerts when the list was last fetched, which goes stale the moment
  // the vendor responds in a separate session (no live push/websocket here).
  useEffect(() => {
    if (screen !== 'disputeDetail') return
    let cancelled = false
    Promise.all([getNpiWatchNotifications(), getNpiWatchStats()]).then(([a, s]) => {
      if (cancelled) return
      setNpiAlerts(a.notifications); setNpiStats(s)
      setSelectedDispute((prev) => (prev ? a.notifications.find((n) => n.notification_id === prev.notification_id) || prev : prev))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [screen])

  async function handleConfirmResolution(caseId, confirmed) {
    setConfirmingCaseId(caseId)
    try {
      await confirmDisputeResolution(caseId, confirmed)
      const [a, s] = await Promise.all([getNpiWatchNotifications(), getNpiWatchStats()])
      setNpiAlerts(a.notifications); setNpiStats(s)
      // Keep the open detail screen in sync with the freshly confirmed/rejected case.
      setSelectedDispute((prev) => (prev ? a.notifications.find((n) => n.notification_id === prev.notification_id) || prev : prev))
    } catch { /* keep the card as-is; physician can retry */ }
    finally { setConfirmingCaseId(null) }
  }

  async function handleDecideClaim(caseId, actionType) {
    setDecidingCaseId(caseId)
    setDecideError(null)
    setDecideResult(null)
    try {
      const result = await decideDisputeClaim(caseId, actionType)
      setDecideResult({ caseId, actionType })
      const [a, s] = await Promise.all([getNpiWatchNotifications(), getNpiWatchStats()])
      setNpiAlerts(a.notifications); setNpiStats(s)
      setSelectedDispute((prev) => (prev ? a.notifications.find((n) => n.notification_id === prev.notification_id) || prev : prev))
    } catch (e) {
      setDecideError(e.message || 'Could not record your decision. Please try again.')
    } finally {
      setDecidingCaseId(null)
    }
  }

  async function handleActioned() {
    try {
      const [p, s] = await Promise.all([getPhysician(npi), getFlaggedSuppliers(npi)])
      setPhysician(p.physician); setSummary(p.summary); setFlaggedSuppliers(s)
    } catch { /* keep last good state */ }
  }

  const pendingCount = summary?.pendingReview ?? 0
  const subtitle = physician?.specialty
    ? `${physician.specialty}${physician.city ? ' · ' + physician.city : ''}`
    : 'Physician'

  const PHYS_LABEL = { summary: 'My Dashboard', claims: 'My Claims', alerts: 'My Disputes', disputeDetail: 'Dispute Detail', suppliers: 'Flagged Suppliers' }
  const physBreadcrumbs = (() => {
    if (screen === 'summary') return []
    const trail = []
    // Walk history backwards to find the path back to dashboard
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i]
      if (h.screen === 'summary') { trail.push({ label: 'My Dashboard', onClick: () => { setScreen('summary'); setHistory(history.slice(0, i)) } }); break }
      const lbl = PHYS_LABEL[h.screen]
      if (lbl) trail.push({ label: lbl, onClick: () => { setScreen(h.screen); setSupplierFilter(h.supplierFilter); setHistory(history.slice(0, i)) } })
    }
    if (!trail.find(c => c.label === 'My Dashboard')) trail.push({ label: 'My Dashboard', onClick: () => { setScreen('summary'); setHistory([]) } })
    const items = trail.reverse()
    items.push({ label: PHYS_LABEL[screen], active: true })
    return items
  })()

  return (
    <>
    <GhostBillingToast />
    <Shell navItems={PHYS_NAV} activeId={screen} onNavigate={(s) => navTo(s)}
           canGoBack={history.length > 0 && screen !== 'summary'} onBack={goBack}
           title={PHYS_TITLES[screen]} user={user} subtitle={subtitle}
           notifCount={npiStats?.open ?? pendingCount} bellTitle="Open disputes"
           onBellClick={() => navTo('alerts')}
           breadcrumbs={physBreadcrumbs}
           onLogout={async () => { await logout(); navigate('/welcome', { replace: true }) }}>
      {screen === 'claims' ? (
        <ClaimsTable npi={npi} onActioned={handleActioned}
                     supplierFilter={supplierFilter} onSupplierFilterChange={setSupplierFilter} />
      ) : error ? (
        <div className="max-w-screen-xl mx-auto px-7 py-7">
          <div className="mc-card border-rose-200 bg-rose-50/50 px-6 py-5">
            <div className="text-sm font-semibold text-rose-600">Couldn't load dashboard data</div>
            <div className="text-xs text-slate-500 mt-1">{error}. Is the backend running on :8000?</div>
            <button onClick={loadData} className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg btn-navy">Retry</button>
          </div>
        </div>
      ) : screen === 'summary' ? (
        loading ? <SummaryCardSkeleton />
          : <>
              <div className="w-full px-4 sm:px-7 pt-4 sm:pt-7 pb-0 flex flex-col gap-3 sm:gap-4">
                <PhysicianHeader physician={physician} />
                <StatCardGrid summary={summary} pendingCount={pendingCount}
                              setActiveScreen={(s) => navTo(s)} />
              </div>
              <PhysicianAlerts />
              <div className="w-full px-4 sm:px-7 pt-4 sm:pt-6">
                <PhysicianOverview npi={npi} />
              </div>
            </>
      ) : screen === 'alerts' ? (
        npiAlertsLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-7 w-7 rounded-full border-2 border-navy border-t-transparent" />
          </div>
        ) : (
          <div className="max-w-screen-xl mx-auto px-4 sm:px-7 py-6 space-y-6">
            {npiStats && (
              <div className="grid grid-cols-3 gap-3">
                <StatCard icon="claims" label="Total Disputes" value={npiStats.total}
                          accent="navy" spark={false} onClick={() => setDisputeFilter('ALL')} />
                <StatCard icon="clock" label="Open" value={npiStats.open}
                          accent="amber" spark={false} onClick={() => setDisputeFilter('OPEN')} />
                <StatCard icon="check" label="Resolved" value={npiStats.resolved}
                          accent="teal" spark={false} onClick={() => setDisputeFilter('RESOLVED')} />
              </div>
            )}
            {npiAlerts.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <select value={disputeTypeFilter} onChange={(e) => setDisputeTypeFilter(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-700 outline-none focus:border-navy/40 focus:ring-2 focus:ring-navy/10">
                  <option value="ALL">All Types</option>
                  <option value="DISPUTE">Disputes</option>
                  <option value="FRAUD_REPORT">Fraud Reports</option>
                </select>
                <select value={disputeFilter} onChange={(e) => setDisputeFilter(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-700 outline-none focus:border-navy/40 focus:ring-2 focus:ring-navy/10">
                  <option value="ALL">All Statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
                <select value={disputeSortOrder} onChange={(e) => setDisputeSortOrder(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-700 outline-none focus:border-navy/40 focus:ring-2 focus:ring-navy/10">
                  <option value="NONE">Default Order</option>
                  <option value="DAYS_ASC">Days Left: Low to High</option>
                  <option value="DAYS_DESC">Days Left: High to Low</option>
                </select>
                {(disputeFilter !== 'ALL' || disputeTypeFilter !== 'ALL' || disputeSortOrder !== 'NONE') && (
                  <button onClick={() => { setDisputeFilter('ALL'); setDisputeTypeFilter('ALL'); setDisputeSortOrder('NONE') }}
                          className="text-[12px] font-semibold text-slate-500 hover:text-rose-500 transition-colors flex items-center gap-1">
                    <Icon name="x" size={11} stroke={2.5} /> Clear all
                  </button>
                )}
              </div>
            )}
            {(() => {
              const OPEN_STATUSES = ['OPEN', 'PENDING_PHYSICIAN_CONFIRMATION']
              const RESOLVED_STATUSES = ['RESPONDED_TO_MEDICARE', 'RESOLVED_BY_PHYSICIAN']
              const filtered = npiAlerts.filter((n) => {
                const matchType = disputeTypeFilter === 'ALL' || n.dispute?.dispute_type === disputeTypeFilter
                const matchStatus = disputeFilter === 'ALL'
                  || (disputeFilter === 'OPEN' && OPEN_STATUSES.includes(n.dispute?.status))
                  || (disputeFilter === 'RESOLVED' && RESOLVED_STATUSES.includes(n.dispute?.status))
                return matchType && matchStatus
              })
              if (disputeSortOrder === 'DAYS_ASC') {
                filtered.sort((a, b) => (a.dispute?.days_remaining ?? 0) - (b.dispute?.days_remaining ?? 0))
              } else if (disputeSortOrder === 'DAYS_DESC') {
                filtered.sort((a, b) => (b.dispute?.days_remaining ?? 0) - (a.dispute?.days_remaining ?? 0))
              }
              if (npiAlerts.length === 0) {
                return (
                  <div className="mc-card px-6 py-8 text-center text-slate-400 text-sm">
                    No disputes yet. When you dispute a claim or report fraud from My Claims, it will appear here for tracking.
                  </div>
                )
              }
              if (filtered.length === 0) {
                return <div className="mc-card px-6 py-8 text-center text-slate-400 text-sm">No disputes match these filters.</div>
              }
              return (
              <div className="space-y-3">
                {filtered.map((n) => {
                  return (
                    <div key={n.notification_id}
                         onClick={() => { setSelectedDispute(n); setDecideError(null); setDecideResult(null); navTo('disputeDetail') }}
                         className="mc-card px-5 py-4 cursor-pointer hover:border-slate-300 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-semibold text-sm text-ink">{n.claim_number}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              n.status === 'PENDING'       ? 'bg-amber-100 text-amber-700'   :
                              n.status === 'CONFIRMED'     ? 'bg-emerald-100 text-emerald-700' :
                              n.status === 'DISPUTED'      ? 'bg-rose-100 text-rose-700'     :
                              n.status === 'FRAUD_REPORTED'? 'bg-red-100 text-red-700'       :
                              'bg-slate-100 text-slate-600'
                            }`}>{n.status}</span>
                          </div>
                          <div className="text-xs text-slate-500 space-y-0.5">
                            <div><span className="font-medium text-slate-700">{n.vendor_name}</span>{n.vendor_type ? ` · ${n.vendor_type}` : ''}</div>
                            <div>Patient: {n.patient_name_partial || '—'} · DOS: {n.dos_from ? fmtDate(n.dos_from) : '—'}{n.dos_to && n.dos_to !== n.dos_from ? ` – ${fmtDate(n.dos_to)}` : ''}</div>
                            <div>Billed: {n.amount_billed != null ? fmtUSD(n.amount_billed) : '—'} · Role: {n.physician_npi_role || '—'}</div>
                          </div>
                        </div>
                      </div>

                      {/* Vendor response tracking, compact — click the card for the full detail + decision */}
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <DisputeStatusPanel d={n.dispute} compact />
                      </div>
                    </div>
                  )
                })}
              </div>
              )
            })()}
          </div>
        )
      ) : screen === 'disputeDetail' ? (
        <DisputeDetailScreenPhysician
          dispute={selectedDispute}
          confirmingCaseId={confirmingCaseId}
          onConfirm={handleConfirmResolution}
          decidingCaseId={decidingCaseId}
          decideError={decideError}
          decideResult={decideResult}
          onDecide={handleDecideClaim}
        />
      ) : (
        loading ? <TableSkeleton /> : <FlaggedSuppliers suppliers={flaggedSuppliers} onSelectSupplier={selectSupplier} />
      )}
    </Shell>
    </>
  )
}

// ─── Dispute vendor-response status — shared between the My Disputes list
// (compact, no actions) and the Dispute Detail screen (full, with the
// confirm/reject decision when a vendor response is pending physician review).
function DisputeStatusPanel({ d, compact = false, busy = false, onConfirm }) {
  if (!d) {
    return <span className="text-[11px] font-medium text-slate-400">Awaiting vendor notification</span>
  }

  if (d.status === 'PENDING_PHYSICIAN_CONFIRMATION') {
    if (compact) {
      return (
        <span className="text-[11px] font-semibold text-navy flex items-center gap-1.5">
          <Icon name="clock" size={12} /> Vendor responded — tap to review and decide
        </span>
      )
    }
    return (
      <div className="space-y-3">
        <span className="text-[13px] font-bold text-navy flex items-center gap-1.5">
          <Icon name="clock" size={14} /> Vendor says this is resolved — your confirmation needed
          {d.physician_confirmation_due_date ? ` (by ${fmtDate(d.physician_confirmation_due_date)})` : ''}
        </span>
        {d.vendor_response && <p className="text-[13px] text-slate-600 italic">"{d.vendor_response}"</p>}
        {d.docs?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {d.docs.map((doc) => (
              <a key={doc.stored_name} href={doc.download_url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-[11px] font-medium text-slate-600 hover:bg-slate-200 transition-colors">
                <Icon name="doc" size={11} /> {doc.filename}
              </a>
            ))}
          </div>
        )}
        <p className="text-[12px] text-slate-500">
          Review what the vendor said above, then decide: did this actually resolve your dispute?
        </p>
        <div className="flex gap-2">
          <button onClick={() => onConfirm(d.case_id, true)} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50">
            ✓ Confirm Resolved
          </button>
          <button onClick={() => onConfirm(d.case_id, false)} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors disabled:opacity-50">
            ✗ Not Resolved — Still Disputing
          </button>
        </div>
      </div>
    )
  }

  if (d.status === 'RESPONDED_TO_MEDICARE' || d.status === 'RESOLVED_BY_PHYSICIAN') {
    return (
      <div className="space-y-1">
        <span className={`font-semibold text-emerald-600 flex items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
          <Icon name="check" size={compact ? 12 : 14} />
          {compact ? 'Vendor responded' : `Resolved — ${d.status.replace(/_/g, ' ')}`}
        </span>
        {d.vendor_response && <p className={`text-slate-600 italic ${compact ? 'text-xs' : 'text-[13px]'}`}>"{d.vendor_response}"</p>}
        {d.docs?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1.5">
            {d.docs.map((doc) => (
              <a key={doc.stored_name} href={doc.download_url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-[11px] font-medium text-slate-600 hover:bg-slate-200 transition-colors">
                <Icon name="doc" size={11} /> {doc.filename}
              </a>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (d.status === 'NON_RESPONSIVE' || d.deadline_passed) {
    return (
      <span className="text-[11px] font-medium text-red-600 flex items-center gap-1.5">
        <Icon name="alertTri" size={12} /> Overdue — escalated to compliance
      </span>
    )
  }

  return (
    <span className="text-[11px] font-medium text-amber-600 flex items-center gap-1.5">
      <Icon name="clock" size={12} /> Awaiting vendor response{d.days_remaining != null ? ` · ${d.days_remaining}d left` : ''}
    </span>
  )
}

// ─── Physician-side dispute detail — click-through from My Disputes, mirrors
// the vendor portal's own Dispute Detail screen so both sides of the same
// case get an equivalent full view instead of everything crammed into a card.
function DisputeDetailScreenPhysician({ dispute: n, confirmingCaseId, onConfirm, decidingCaseId, decideError, decideResult, onDecide }) {
  if (!n) return <div className="px-7 py-8 text-slate-400">No dispute selected.</div>
  const d = n.dispute
  const busy = !!d && confirmingCaseId === d.case_id

  return (
    <div className="px-4 sm:px-7 py-5 space-y-5">
      <div className="mc-card p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Claim {n.claim_number}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${n.status === 'FRAUD_REPORTED' ? 'bg-rose-100 text-rose-700' : 'bg-orange-100 text-orange-700'}`}>
                {n.status?.replace(/_/g, ' ')}
              </span>
              {d && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  d.status === 'PENDING_PHYSICIAN_CONFIRMATION' ? 'bg-blue-100 text-blue-700' :
                  d.status === 'RESPONDED_TO_MEDICARE' || d.status === 'RESOLVED_BY_PHYSICIAN' ? 'bg-emerald-100 text-emerald-700' :
                  d.status === 'NON_RESPONSIVE' ? 'bg-red-100 text-red-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {d.status?.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
          {[
            ['Vendor', `${n.vendor_name || '—'}${n.vendor_type ? ` · ${n.vendor_type}` : ''}`],
            ['Patient', n.patient_name_partial || '—'],
            ['Date of Service', n.dos_from ? `${fmtDate(n.dos_from)}${n.dos_to && n.dos_to !== n.dos_from ? ` – ${fmtDate(n.dos_to)}` : ''}` : '—'],
            ['Billed', n.amount_billed != null ? fmtUSD(n.amount_billed) : '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
              <div className="font-medium text-slate-700">{value}</div>
            </div>
          ))}
        </div>

      </div>

      <div className="mc-card p-5">
        <h3 className="text-[13px] font-bold text-slate-900 mb-3">Timeline</h3>
        {d ? (
          <PhysicianDisputeTimeline d={d} busy={busy} onConfirm={onConfirm} />
        ) : (
          <span className="text-[12px] font-medium text-slate-400">Awaiting vendor notification</span>
        )}
      </div>

      {d && VENDOR_RESPONDED_STATUSES.includes(d.status) && (
        <DisputeReviewPanel
          caseId={d.case_id}
          decidingCaseId={decidingCaseId}
          decideError={decideError}
          decideResult={decideResult}
          onDecide={onDecide}
        />
      )}
    </div>
  )
}

// Chronological history of a single dispute case, from the physician's side —
// every step that happened (reported → vendor notified → vendor responded,
// with their notes/docs → your confirmation decision), not just the current
// status snapshot. Mirrors DisputeDetailModal's timeline (payer/compliance view).
function PhysicianDisputeTimeline({ d, busy, onConfirm }) {
  const past = [
    { at: d.opened_at, label: d.dispute_type === 'FRAUD_REPORT' ? 'You reported this as fraud' : 'You disputed this claim', note: d.physician_notes },
    d.billing_provider_notified_at && { at: d.billing_provider_notified_at, label: 'Vendor notified — 15 days to respond' },
    d.vendor_responded_at && {
      at: d.vendor_responded_at,
      label: d.provider_response_type === 'RESPONDED_TO_MEDICARE' ? 'Vendor responded to Medicare' : 'Vendor resolved this with you directly',
      detail: d.vendor_response,
      docs: d.docs,
    },
    d.status === 'RESOLVED_BY_PHYSICIAN' && { at: d.closed_at || d.vendor_responded_at, label: 'You confirmed this was resolved' },
    d.status === 'NON_RESPONSIVE' && { at: d.response_due_date, label: 'Vendor did not respond in time — escalated to compliance' },
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at))

  // Live/pending steps have no timestamp yet — rendered after the dated history.
  const pending =
    d.status === 'PENDING_PHYSICIAN_CONFIRMATION' ? 'confirm'
    : d.status === 'OPEN' && !d.deadline_passed      ? 'awaiting'
    : null

  return (
    <div className="space-y-3">
      {past.map((t, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full bg-navy" />
            {(i < past.length - 1 || pending) && <div className="w-px flex-1 bg-slate-200 mt-1" />}
          </div>
          <div className="pb-3 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[12px] font-semibold text-slate-800">{t.label}</span>
              <span className="text-[11px] text-slate-400">{fmtDate(t.at)}</span>
            </div>
            {t.note && <p className="text-[12px] text-slate-500 italic mt-0.5">"{t.note}"</p>}
            {t.detail && <p className="text-[12px] text-slate-600 mt-0.5">"{t.detail}"</p>}
            {t.docs?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1.5">
                {t.docs.map((doc) => (
                  <a key={doc.stored_name} href={doc.download_url} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-[11px] font-medium text-slate-600 hover:bg-slate-200 transition-colors">
                    <Icon name="doc" size={11} /> {doc.filename}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {pending === 'confirm' && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full bg-navy ring-4 ring-navy/15" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[12px] font-semibold text-navy">Your confirmation needed</span>
              {d.physician_confirmation_due_date && <span className="text-[11px] text-slate-400">by {fmtDate(d.physician_confirmation_due_date)}</span>}
            </div>
            <p className="text-[12px] text-slate-500 mt-0.5">Did the vendor's response above actually resolve this dispute?</p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => onConfirm(d.case_id, true)} disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50">
                ✓ Confirm Resolved
              </button>
              <button onClick={() => onConfirm(d.case_id, false)} disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors disabled:opacity-50">
                ✗ Not Resolved
              </button>
            </div>
          </div>
        </div>
      )}

      {pending === 'awaiting' && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full bg-slate-300" />
          </div>
          <span className="text-[12px] font-medium text-slate-400">
            Awaiting vendor response{d.days_remaining != null ? ` · ${d.days_remaining}d left` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

// Mirrors the same 5 actions from My Claims (ClaimsTable.jsx's ACTIONS array) —
// shown once the vendor has actually responded, so there's something concrete
// to react to. Posts a normal Action against the claim; doesn't touch the
// dispute case's own status (that stays as history of the vendor exchange).
const VENDOR_RESPONDED_STATUSES = ['RESOLVED_BY_PHYSICIAN', 'RESPONDED_TO_MEDICARE', 'NON_RESPONSIVE']
const REVIEW_ACTIONS = [
  { type: 'confirm',        label: 'Confirm',         desc: 'The claim is legitimate — this resolves it for good.', cls: 'bg-emerald-50/70 text-emerald-600 ring-emerald-200 hover:bg-emerald-100' },
  { type: 'dispute',        label: 'Dispute',         desc: "Still not right — you don't accept the vendor's explanation.", cls: 'bg-rose-50/70 text-rose-500 ring-rose-200 hover:bg-rose-100' },
  { type: 'flag_supplier',  label: 'Flag Supplier',   desc: 'The vendor itself looks unknown or suspicious.', cls: 'bg-amber-50/70 text-amber-600 ring-amber-200 hover:bg-amber-100' },
  { type: 'unknown_patient',label: 'Unknown Patient',  desc: "You still don't recognize this patient.", cls: 'bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100' },
  { type: 'fraud',          label: 'Report Fraud',    desc: 'The vendor response confirms this is fraudulent.', cls: 'bg-slate-800 text-white ring-slate-800 hover:bg-slate-900' },
]

function DisputeReviewPanel({ caseId, decidingCaseId, decideError, decideResult, onDecide }) {
  const busy = decidingCaseId === caseId
  const justDecided = decideResult?.caseId === caseId ? decideResult.actionType : null

  return (
    <div className="mc-card p-5 space-y-3">
      <div>
        <h3 className="text-[13px] font-bold text-slate-900">Your Decision</h3>
        <p className="text-[12px] text-slate-500 mt-0.5">
          Now that you've reviewed the vendor's response, apply the same call you'd make on any claim in My Claims.
        </p>
      </div>

      {justDecided && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 text-[12px] font-medium text-emerald-700">
          <Icon name="check" size={13} /> Recorded as "{REVIEW_ACTIONS.find((a) => a.type === justDecided)?.label}" — visible in My Claims.
        </div>
      )}
      {decideError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-[12px] font-medium text-rose-700">
          <Icon name="alertTri" size={13} /> {decideError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {REVIEW_ACTIONS.map((a) => (
          <button key={a.type} onClick={() => onDecide(caseId, a.type)} disabled={busy}
                  className={`text-left p-3 rounded-xl ring-1 ring-inset transition-all disabled:opacity-50 ${a.cls}`}>
            <div className="text-[12px] font-bold mb-0.5">{a.label}</div>
            <p className="text-[10px] leading-snug opacity-80">{a.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function PhysicianPortal() {
  return <AlertsProvider><PhysicianPortalInner /></AlertsProvider>
}

// ─── Plan portal ─────────────────────────────────────────────────────────────
function PlanPortalInner() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [screen, setScreen] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return (p.get('preview') === '1' && p.get('screen')) || 'home'
  })
  const [selectedNPI, setSelectedNPI] = useState(null)
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [lbBand, setLbBand] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return (p.get('preview') === '1' && p.get('band')) || 'all'
  })
  const [notif, setNotif] = useState(0)
  const [search, setSearch] = useState('')      // top-nav search → filters the supplier watchlist
  const [npiBack, setNpiBack] = useState(null)   // NPI-detail return target; null = leaderboard
  const [history, setHistory] = useState([])     // backtrack stack of prior views
  const [npiInitialPattern, setNpiInitialPattern] = useState(null)  // fraud-pattern modal to reopen when backing into NPI detail
  const [planDisputes, setPlanDisputes] = useState([])
  const [planDisputesLoading, setPlanDisputesLoading] = useState(false)
  const [disputeStatusFilter, setDisputeStatusFilter] = useState('open')
  const [disputesRefreshKey, setDisputesRefreshKey] = useState(0)
  const [disputeTypeFilter, setDisputeTypeFilter] = useState('ALL')  // ALL | DISPUTE | FRAUD_REPORT
  const [disputeSortOrder, setDisputeSortOrder] = useState('NONE')   // NONE | DAYS_ASC | DAYS_DESC
  const [selectedDispute, setSelectedDispute] = useState(null)

  useEffect(() => {
    const refresh = () => getNotificationsCount().then(setNotif).catch(() => {})
    refresh()
    const t = setInterval(refresh, 20000)
    return () => clearInterval(t)
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
    }
  }, [screen, disputeStatusFilter, disputesRefreshKey])

  // Snapshot the current view onto the backtrack stack before navigating forward, so the
  // header back button can restore the exact prior screen + selection.
  function pushHist(extra = {}) {
    setHistory((h) => [...h, { screen, selectedNPI, selectedSupplier, lbBand, npiBack, npiPattern: null, ...extra }])
  }
  // Pop the stack and restore the previous view (incl. any fraud-pattern modal that was
  // open on the NPI detail we're returning to).
  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setScreen(prev.screen)
      setSelectedNPI(prev.selectedNPI)
      setSelectedSupplier(prev.selectedSupplier)
      setLbBand(prev.lbBand)
      setNpiBack(prev.npiBack)
      setNpiInitialPattern(prev.npiPattern || null)
      setSearch('')
      return h.slice(0, -1)
    })
  }

  function go(s, band = 'all') {
    pushHist()
    if (s !== 'detail') { setSelectedNPI(null); setNpiBack(null) }
    if (s === 'leaderboard') setLbBand(band)
    setNpiInitialPattern(null)
    setSearch('')
    setScreen(s)
  }

  function openNpi(row, back = null) {
    pushHist()
    setNpiInitialPattern(null)
    setSelectedNPI(row); setNpiBack(back); setScreen('detail')
  }
  // sup = supplier row; fromPattern = the fraud-pattern modal open when this was clicked,
  // so backing out of the Supplier Case can reopen that modal.
  function openSupplier(sup, fromPattern = null) {
    pushHist({ npiPattern: fromPattern })
    setSelectedSupplier(sup); setScreen('supplierDetail')
  }
  // Open NPI detail from a physician row on a supplier case, remembering the supplier
  // so NPI detail can offer a "← Back to {supplier}" link.
  function openNpiFromSupplier(physRow) {
    pushHist()
    setNpiInitialPattern(null)
    // physRow may be a full { npi, name } object or just an NPI string
    const npiVal = typeof physRow === 'string' ? physRow : physRow?.npi
    setSelectedNPI({ npi: npiVal, name: typeof physRow === 'object' ? physRow?.name : undefined })
    setNpiBack({ to: 'supplierDetail', label: selectedSupplier?.name })
    setScreen('detail')
  }
  // Opens a new NPI detail from within the current NPI detail (e.g. Cross-NPI modal click).
  // Saves the currently open fraud-pattern modal so pressing Back reopens it automatically.
  function openNpiFromDetail(npiRow, fromPattern = null) {
    pushHist({ npiPattern: fromPattern })
    setNpiInitialPattern(null)
    setSelectedNPI(npiRow)
    setNpiBack(null)
    setScreen('detail')
  }
  // Pop exactly N entries off the history stack in one shot (used by breadcrumb clicks).
  function goBackN(n) {
    if (n <= 0) return
    setHistory((h) => {
      const idx = Math.max(0, h.length - n)
      const prev = h[idx]
      if (!prev) return h
      setScreen(prev.screen)
      setSelectedNPI(prev.selectedNPI)
      setSelectedSupplier(prev.selectedSupplier)
      setLbBand(prev.lbBand)
      setNpiBack(prev.npiBack)
      setNpiInitialPattern(prev.npiPattern || null)
      setSearch('')
      return h.slice(0, idx)
    })
  }

  const fromSupplier = npiBack?.to === 'supplierDetail'

  // Build a clean breadcrumb trail: walk history backwards, de-duplicate by screen key,
  // stop at the first 'home' entry — so bouncing through Dashboard mid-session doesn't
  // pollute the path (e.g. home→watchlist→home→leaderboard→detail shows just
  // Dashboard > NPI Leaderboard > Dr. X, not the full round-trip).
  const breadcrumbs = (() => {
    if (screen === 'home') return []
    const LABEL = { home: 'Dashboard', leaderboard: 'NPI Leaderboard', watchlist: 'Supplier Watchlist' }
    const toLabel = (s, npi, sup) =>
      LABEL[s] || (s === 'detail' ? (npi?.name || 'NPI Detail') : s === 'supplierDetail' ? (sup?.name || 'Supplier Case') : null)

    const trail = []  // built in reverse
    const seen = new Set()
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i]
      const key = h.screen === 'detail' ? `d:${h.selectedNPI?.npi}` : h.screen === 'supplierDetail' ? `s:${h.selectedSupplier?.id}` : h.screen
      if (seen.has(key)) continue
      seen.add(key)
      const label = toLabel(h.screen, h.selectedNPI, h.selectedSupplier)
      if (!label) continue
      const stepsBack = history.length - i
      trail.push({ label, onClick: () => goBackN(stepsBack), active: false })
      if (h.screen === 'home') break
    }
    // If we never reached a 'home' entry, prepend a non-clickable Dashboard anchor.
    if (!trail.find((c) => c.label === 'Dashboard')) trail.push({ label: 'Dashboard', active: false })

    const items = trail.reverse()
    const curLabel = toLabel(screen, selectedNPI, selectedSupplier)
    if (curLabel) items.push({ label: curLabel, active: true })
    return items
  })()

  return (
    <Shell navItems={PLAN_NAV}
           activeId={screen === 'detail' ? (fromSupplier ? 'watchlist' : 'leaderboard') : screen === 'supplierDetail' ? 'watchlist' : screen}
           onNavigate={go}
           canGoBack={history.length > 0 && screen !== 'home'} onBack={goBack}
           title={PLAN_TITLES[screen]} user={user} subtitle="Payer" showSearch
           searchValue={search} onSearchChange={setSearch}
           onOpenNpi={(row) => openNpi(row, null)}
           onOpenSupplier={openSupplier}
           breadcrumbs={breadcrumbs}
           notifCount={notif} bellTitle="New physician alerts"
           onBellClick={() => { markNotificationsSeen().then(() => setNotif(0)).catch(() => {}); go('home') }}
           onLogout={async () => { await logout(); navigate('/welcome', { replace: true }) }}>
      {screen === 'home' && <PlanHome setActiveScreen={go}
          onOpenNpi={(npiObj) => openNpi(npiObj, null)}
          onOpenSupplier={openSupplier} />}
      {screen === 'leaderboard' && <NPILeaderboard search={search} setSelectedNPI={setSelectedNPI} setActiveScreen={(s) => { if (s === 'detail') { pushHist(); setNpiBack(null) } setScreen(s) }} initialBand={lbBand} />}
      {screen === 'detail' && <NPIDetail npi={selectedNPI}
          onBack={goBack}
          backLabel={fromSupplier ? `Back to ${npiBack.label || 'supplier'}` : null}
          initialPattern={npiInitialPattern}
          onOpenNpi={openNpiFromDetail}
          onOpenSupplier={openSupplier} />}
      {screen === 'watchlist' && <SupplierWatchlist search={search} onSelect={openSupplier} />}
      {screen === 'supplierDetail' && <SupplierDetail supplier={selectedSupplier} onBack={goBack} onSelectPhysician={openNpiFromSupplier} />}
      {screen === 'disputes' && (
        <div className="max-w-screen-xl mx-auto px-4 sm:px-7 py-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-1">
              {[
                { id: 'open',     label: 'Open' },
                { id: 'resolved', label: 'Resolved' },
                { id: 'all',      label: 'All' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setDisputeStatusFilter(t.id); setDisputesRefreshKey((k) => k + 1) }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    disputeStatusFilter === t.id
                      ? 'bg-navy text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {!planDisputesLoading && (
                <p className="text-sm text-slate-500">{planDisputes.length} dispute{planDisputes.length !== 1 ? 's' : ''}</p>
              )}
              <button
                onClick={() => setDisputesRefreshKey((k) => k + 1)}
                disabled={planDisputesLoading}
                title="Refresh"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-navy transition-colors disabled:opacity-50"
              >
                <Icon name="refresh" size={14} />
              </button>
            </div>
          </div>

          {planDisputes.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <select value={disputeTypeFilter} onChange={(e) => setDisputeTypeFilter(e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-700 outline-none focus:border-navy/40 focus:ring-2 focus:ring-navy/10">
                <option value="ALL">All Types</option>
                <option value="DISPUTE">Disputes</option>
                <option value="FRAUD_REPORT">Fraud Reports</option>
              </select>
              <select value={disputeSortOrder} onChange={(e) => setDisputeSortOrder(e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-700 outline-none focus:border-navy/40 focus:ring-2 focus:ring-navy/10">
                <option value="NONE">Default Order</option>
                <option value="DAYS_ASC">Days Left: Low to High</option>
                <option value="DAYS_DESC">Days Left: High to Low</option>
              </select>
              {(disputeTypeFilter !== 'ALL' || disputeSortOrder !== 'NONE') && (
                <button onClick={() => { setDisputeTypeFilter('ALL'); setDisputeSortOrder('NONE') }}
                        className="text-[12px] font-semibold text-slate-500 hover:text-rose-500 transition-colors flex items-center gap-1">
                  <Icon name="x" size={11} stroke={2.5} /> Clear
                </button>
              )}
            </div>
          )}

          {planDisputesLoading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-7 w-7 rounded-full border-2 border-navy border-t-transparent" />
            </div>
          ) : planDisputes.length === 0 ? (
            <div className="mc-card px-6 py-8 text-center text-slate-400 text-sm">No disputes match this filter.</div>
          ) : (() => {
            const filteredDisputes = planDisputes.filter((d) => disputeTypeFilter === 'ALL' || d.dispute_type === disputeTypeFilter)
            if (disputeSortOrder === 'DAYS_ASC') {
              filteredDisputes.sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))
            } else if (disputeSortOrder === 'DAYS_DESC') {
              filteredDisputes.sort((a, b) => (b.days_remaining ?? 0) - (a.days_remaining ?? 0))
            }
            if (filteredDisputes.length === 0) {
              return <div className="mc-card px-6 py-8 text-center text-slate-400 text-sm">No disputes match these filters.</div>
            }
            return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="text-left py-2.5 pr-4">Claim #</th>
                    <th className="text-left py-2.5 pr-4">Vendor</th>
                    <th className="text-left py-2.5 pr-4">Type</th>
                    <th className="text-left py-2.5 pr-4">Status</th>
                    <th className="text-right py-2.5 pr-4">Due Date</th>
                    <th className="text-right py-2.5">Days Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDisputes.map((d) => {
                    const overdue = d.deadline_passed
                    const warn    = !overdue && d.days_remaining <= 3
                    const caution = !overdue && !warn && d.days_remaining <= 7
                    const daysClass = overdue ? 'text-red-600 font-bold' : warn ? 'text-rose-600 font-semibold' : caution ? 'text-amber-600 font-medium' : 'text-slate-700'
                    const resolved = !['OPEN', 'NON_RESPONSIVE'].includes(d.status)
                    const statusCls = d.status === 'NON_RESPONSIVE' ? 'bg-red-100 text-red-700'
                      : resolved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    return (
                      <tr key={d.case_id} onClick={() => {
                          setSelectedDispute(d)
                          // Refresh in the background in case the vendor/physician changed this
                          // case's status in a separate session since the list was last fetched.
                          getPlanDisputes(disputeStatusFilter).then((fresh) => {
                            setPlanDisputes(fresh.disputes)
                            const match = fresh.disputes.find((x) => x.case_id === d.case_id)
                            if (match) setSelectedDispute((prev) => (prev?.case_id === d.case_id ? match : prev))
                          }).catch(() => {})
                        }}
                          className="hover:bg-slate-50 transition-colors cursor-pointer">
                        <td className="py-3 pr-4 font-mono text-xs text-slate-700">{d.claim_number}</td>
                        <td className="py-3 pr-4">
                          <div className="font-medium text-ink">{d.vendor_name || d.vendor_npi}</div>
                          <div className="text-xs text-slate-400">{d.vendor_npi}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{d.dispute_type || '—'}</span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusCls}`}>{d.status?.replace(/_/g, ' ')}</span>
                        </td>
                        <td className="py-3 pr-4 text-right text-xs text-slate-500">{d.response_due_date ? fmtDate(d.response_due_date) : '—'}</td>
                        <td className={`py-3 text-right text-xs ${daysClass}`}>
                          {resolved ? '—' : overdue ? 'OVERDUE' : `${d.days_remaining}d`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )
          })()}
        </div>
      )}
      {selectedDispute && (
        <DisputeDetailModal dispute={selectedDispute} onClose={() => setSelectedDispute(null)} />
      )}
    </Shell>
  )
}

// ─── Dispute detail modal (payer/compliance view) ────────────────────────────
const RESPONSE_TYPE_LABELS = {
  RESPONDED_TO_MEDICARE:      'Responded to Medicare',
  RESOLVED_WITH_PHYSICIAN:    'Resolved with physician',
  PHYSICIAN_CHANGED_RESPONSE: 'Physician changed response',
  NONE:                       'No response type recorded',
}

function DisputeDetailModal({ dispute: d, onClose }) {
  const timeline = [
    { at: d.opened_at, label: 'Physician disputed', note: d.physician_notes },
    d.billing_provider_notified_at && { at: d.billing_provider_notified_at, label: 'Vendor notified' },
    d.vendor_responded_at && {
      at: d.vendor_responded_at,
      label: 'Vendor responded',
      note: RESPONSE_TYPE_LABELS[d.provider_response_type] || d.provider_response_type,
      detail: d.vendor_response,
    },
    d.closed_at && { at: d.closed_at, label: 'Case closed', note: d.resolution_notes },
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at))

  const resolved = !['OPEN', 'NON_RESPONSIVE'].includes(d.status)
  const statusCls = d.status === 'NON_RESPONSIVE' ? 'bg-red-100 text-red-700'
    : resolved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative mc-card w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Case #{d.case_id} — Claim {d.claim_number}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d.dispute_type === 'FRAUD_REPORT' ? 'bg-rose-100 text-rose-700' : 'bg-orange-100 text-orange-700'}`}>
                {d.dispute_type === 'FRAUD_REPORT' ? 'FRAUD REPORT' : 'DISPUTE'}
              </span>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${statusCls}`}>{d.status?.replace(/_/g, ' ')}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex-shrink-0 w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex items-center justify-center transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Vendor</div>
            <div className="font-medium text-slate-700">{d.vendor_name || d.vendor_npi || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Physician NPI</div>
            <div className="font-medium text-slate-700">{d.physician_npi || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Response Due</div>
            <div className="font-medium text-slate-700">{d.response_due_date ? fmtDate(d.response_due_date) : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Days Left</div>
            <div className={`font-medium ${d.deadline_passed ? 'text-red-600' : 'text-slate-700'}`}>
              {resolved ? '—' : d.deadline_passed ? 'OVERDUE' : `${d.days_remaining}d`}
            </div>
          </div>
        </div>

        {d.claim && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Claim Details</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
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
                  <div className="font-medium text-slate-700">{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Timeline</div>
          <div className="space-y-3">
            {timeline.map((t, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                  <div className="w-2 h-2 rounded-full bg-navy" />
                  {i < timeline.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                </div>
                <div className="pb-3 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[12px] font-semibold text-slate-800">{t.label}</span>
                    <span className="text-[11px] text-slate-400">{fmtDate(t.at)}</span>
                  </div>
                  {t.note && <p className="text-[12px] text-slate-500 italic mt-0.5">"{t.note}"</p>}
                  {t.detail && <p className="text-[12px] text-slate-600 mt-0.5">{t.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {d.vendor_docs?.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Vendor's Supporting Documents</div>
            <div className="flex flex-wrap gap-2">
              {d.vendor_docs.map((doc) => (
                <a
                  key={doc.stored_name}
                  href={`${API_BASE}/api/v1/vendor/disputes/${d.case_id}/docs/${doc.stored_name}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 ring-1 ring-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <Icon name="doc" size={12} /> {doc.filename}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PlanPortal() {
  return <AlertsProvider><PlanPortalInner /></AlertsProvider>
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
function Protected({ role, children }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace />
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
        <Route path="/payer/signup" element={<PayerSignup />} />
        <Route path="/physician/signup" element={<PhysicianSignup />} />
        {/* Deactivated TOTP screens — kept reachable directly, no longer in the login flow. */}
        <Route path="/mfa/setup" element={<Protected><MfaSetup /></Protected>} />
        <Route path="/mfa/backup-codes" element={<Protected><MfaBackupCodes /></Protected>} />
        <Route path="/physician/*" element={<Protected role="physician"><PhysicianPortal /></Protected>} />
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
