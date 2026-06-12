import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
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
import { Icon } from './components/ui'
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
import { StatCardGrid, PhysicianHeader, ReviewBanner } from './components/SummaryCard'
import { PHYSICIAN_NPI, getPhysician, getFlaggedSuppliers, getNotificationsCount, markNotificationsSeen } from './api'

const PHYS_NAV = [
  { id: 'summary', label: 'My Dashboard', icon: 'dashboard' },
  { id: 'claims', label: 'My Claims', icon: 'claims' },
  { id: 'suppliers', label: 'Flagged Suppliers', icon: 'flag' },
]
const PLAN_NAV = [
  { id: 'home', label: 'Dashboard', icon: 'dashboard' },
  { id: 'leaderboard', label: 'NPI Leaderboard', icon: 'leaderboard' },
  { id: 'watchlist', label: 'Supplier Watchlist', icon: 'suppliers' },
  // Live Alerts removed — the feed now lives on the Dashboard.
]
const PHYS_TITLES = { summary: 'My Dashboard', claims: 'Claims Under My NPI', suppliers: 'Suppliers I Flagged' }
const PLAN_TITLES = { home: 'Payer Portal', leaderboard: 'NPI Risk Leaderboard', detail: 'NPI Detail', watchlist: 'Supplier Watchlist', supplierDetail: 'Supplier Case', alerts: 'Live Alerts' }

// ─── Physician portal ──────────────────────────────────────────────────────
function PhysicianPortal() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const npi = user?.npi || PHYSICIAN_NPI

  const [screen, setScreen] = useState('summary')
  const [physician, setPhysician] = useState(null)
  const [summary, setSummary] = useState(null)
  const [flaggedSuppliers, setFlaggedSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [supplierFilter, setSupplierFilter] = useState(null)   // active supplier filter on My Claims
  const [history, setHistory] = useState([])                   // backtrack stack of prior views

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
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { loadData() }, [npi])

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

  const PHYS_LABEL = { summary: 'My Dashboard', claims: 'My Claims', suppliers: 'Flagged Suppliers' }
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
    <Shell navItems={PHYS_NAV} activeId={screen} onNavigate={(s) => navTo(s)}
           canGoBack={history.length > 0 && screen !== 'summary'} onBack={goBack}
           title={PHYS_TITLES[screen]} user={user} subtitle={subtitle}
           notifCount={pendingCount} bellTitle="Claims pending your review"
           onBellClick={() => navTo('claims')}
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
              <div className="w-full px-7 pt-7 pb-0 flex flex-col gap-4">
                <PhysicianHeader physician={physician} />
                <StatCardGrid summary={summary} pendingCount={pendingCount}
                              setActiveScreen={(s) => navTo(s)} />
              </div>
              <div className="w-full px-7 pt-6">
                <PhysicianOverview npi={npi} />
              </div>
            </>
      ) : (
        loading ? <TableSkeleton /> : <FlaggedSuppliers suppliers={flaggedSuppliers} onSelectSupplier={selectSupplier} />
      )}
    </Shell>
  )
}

// ─── Plan portal ─────────────────────────────────────────────────────────────
function PlanPortalInner() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [screen, setScreen] = useState('home')
  const [selectedNPI, setSelectedNPI] = useState(null)
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [lbBand, setLbBand] = useState('all')
  const [notif, setNotif] = useState(0)
  const [search, setSearch] = useState('')      // top-nav search → filters the supplier watchlist
  const [npiBack, setNpiBack] = useState(null)   // NPI-detail return target; null = leaderboard
  const [history, setHistory] = useState([])     // backtrack stack of prior views
  const [npiInitialPattern, setNpiInitialPattern] = useState(null)  // fraud-pattern modal to reopen when backing into NPI detail

  useEffect(() => {
    const refresh = () => getNotificationsCount().then(setNotif).catch(() => {})
    refresh()
    const t = setInterval(refresh, 20000)
    return () => clearInterval(t)
  }, [])

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
    </Shell>
  )
}

function PlanPortal() {
  return <AlertsProvider><PlanPortalInner /></AlertsProvider>
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
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </>
  )
}
