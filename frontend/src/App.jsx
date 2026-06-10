import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AlertsProvider } from './context/AlertsContext'
import { useAuth, DASHBOARD_PATH } from './context/AuthContext'
import Shell from './components/Shell'
import Login from './screens/Login'
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

  // From Flagged Suppliers: jump to My Claims filtered to that supplier.
  function selectSupplier(name) { setSupplierFilter(name); setScreen('claims') }

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

  return (
    <Shell navItems={PHYS_NAV} activeId={screen} onNavigate={setScreen}
           title={PHYS_TITLES[screen]} user={user} subtitle={subtitle}
           notifCount={pendingCount} bellTitle="Claims pending your review"
           onBellClick={() => setScreen('claims')}
           onLogout={async () => { await logout(); navigate('/login', { replace: true }) }}>
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
          : <SummaryCard setActiveScreen={setScreen} pendingCount={pendingCount}
                         unknownCount={summary?.unknownCount ?? flaggedSuppliers.length}
                         physician={physician} summary={summary} />
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

  useEffect(() => {
    const refresh = () => getNotificationsCount().then(setNotif).catch(() => {})
    refresh()
    const t = setInterval(refresh, 20000)
    return () => clearInterval(t)
  }, [])

  function go(s, band = 'all') {
    if (s !== 'detail') { setSelectedNPI(null); setNpiBack(null) }
    if (s === 'leaderboard') setLbBand(band)
    setSearch('')
    setScreen(s)
  }

  // Open NPI detail from a physician row on a supplier case, remembering the supplier
  // so NPI detail can offer a "← Back to {supplier}" link.
  function openNpiFromSupplier(npiVal) {
    setSelectedNPI({ npi: npiVal })   // NPIDetail reads row.npi, then fetches full detail
    setNpiBack({ to: 'supplierDetail', label: selectedSupplier?.name })
    setScreen('detail')
  }
  const fromSupplier = npiBack?.to === 'supplierDetail'

  return (
    <Shell navItems={PLAN_NAV}
           activeId={screen === 'detail' ? (fromSupplier ? 'watchlist' : 'leaderboard') : screen === 'supplierDetail' ? 'watchlist' : screen}
           onNavigate={go}
           title={PLAN_TITLES[screen]} user={user} subtitle="Payer" showSearch
           searchValue={search} onSearchChange={setSearch}
           onOpenNpi={(row) => { setSelectedNPI(row); setNpiBack(null); setScreen('detail') }}
           onOpenSupplier={(sup) => { setSelectedSupplier(sup); setScreen('supplierDetail') }}
           notifCount={notif} bellTitle="New physician alerts"
           onBellClick={() => { markNotificationsSeen().then(() => setNotif(0)).catch(() => {}); go('home') }}
           onLogout={async () => { await logout(); navigate('/login', { replace: true }) }}>
      {screen === 'home' && <PlanHome setActiveScreen={go}
          onOpenNpi={(npiObj) => { setSelectedNPI(npiObj); setNpiBack(null); setScreen('detail') }}
          onOpenSupplier={(supObj) => { setSelectedSupplier(supObj); setScreen('supplierDetail') }} />}
      {screen === 'leaderboard' && <NPILeaderboard search={search} setSelectedNPI={setSelectedNPI} setActiveScreen={(s) => { if (s === 'detail') setNpiBack(null); setScreen(s) }} initialBand={lbBand} />}
      {screen === 'detail' && <NPIDetail npi={selectedNPI}
          onBack={() => fromSupplier ? setScreen('supplierDetail') : go('leaderboard')}
          backLabel={fromSupplier ? `Back to ${npiBack.label || 'supplier'}` : null}
          onOpenSupplier={(sup) => { setSelectedSupplier(sup); setScreen('supplierDetail') }} />}
      {screen === 'watchlist' && <SupplierWatchlist search={search} onSelect={(s) => { setSelectedSupplier(s); setScreen('supplierDetail') }} />}
      {screen === 'supplierDetail' && <SupplierDetail supplier={selectedSupplier} onBack={() => go('watchlist')} onSelectPhysician={openNpiFromSupplier} />}
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
  return <Navigate to={user ? (DASHBOARD_PATH[user.role] || '/login') : '/login'} replace />
}

export default function App() {
  return (
    <>
      <MfaWarningBanner />
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        {/* Step 2 of login (Email OTP) — public: the user has no real session yet. */}
        <Route path="/otp/login" element={<OtpLogin />} />
        {/* Public registration (physician + payer). */}
        <Route path="/register" element={<Register />} />
        {/* Deactivated TOTP screens — kept reachable directly, no longer in the login flow. */}
        <Route path="/mfa/setup" element={<Protected><MfaSetup /></Protected>} />
        <Route path="/mfa/backup-codes" element={<Protected><MfaBackupCodes /></Protected>} />
        <Route path="/physician/*" element={<Protected role="physician"><PhysicianPortal /></Protected>} />
        <Route path="/plan/*" element={<Protected role="plan_investigator"><PlanPortal /></Protected>} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </>
  )
}
