import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNpiRiskList, getSuppliers } from '../api'
import { Icon } from './ui'
import { Shield, Check } from 'lucide-react'

function Sidebar({ navItems, activeId, onNavigate, collapsed, onToggleCollapse, onClose }) {
  const navigate = useNavigate()
  return (
    <aside
      className="flex-shrink-0 flex flex-col h-screen sticky top-0 transition-all duration-300 ease-in-out overflow-hidden"
      style={{ backgroundColor: '#0d1f35', width: collapsed ? '64px' : onClose ? 'min(240px, 85vw)' : '240px' }}>

      {/* Logo row — with optional mobile close button */}
      <div className={`h-16 flex items-center flex-shrink-0 transition-all duration-300 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <div className={`flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer ${collapsed ? 'justify-center' : ''}`}
             onClick={() => navigate('/')}>
          <div className="bg-white p-1.5 rounded-lg shadow-sm relative flex-shrink-0">
            <Shield size={18} className="text-[#1e3a8a]" fill="#1e3a8a" fillOpacity={0.1} />
            <Check size={11} className="text-[#1e3a8a] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" strokeWidth={3} />
          </div>
          {!collapsed && (
            <span className="text-[15px] font-bold text-white tracking-tight whitespace-nowrap overflow-hidden">
              MedClaim Analytics
            </span>
          )}
        </div>
        {/* X close button — mobile overlay only */}
        {onClose && !collapsed && (
          <button onClick={onClose} aria-label="Close menu"
                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all duration-150">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className={`flex-1 py-4 space-y-1 ${collapsed ? 'px-2' : 'px-3'}`}>
        {navItems.map((n) => (
          <button key={n.id} onClick={() => onNavigate(n.id)}
                  title={collapsed ? n.label : undefined}
                  className={`transition-all duration-200 w-full flex items-center rounded-lg text-[13px] font-medium
                    ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-3'}
                    ${activeId === n.id
                      ? 'bg-white/10 text-white'
                      : 'text-white/60 hover:bg-white/5 hover:text-white'}`}>
            <Icon name={n.icon} size={18} stroke={activeId === n.id ? 2.2 : 1.9} />
            {!collapsed && <span className="truncate">{n.label}</span>}
          </button>
        ))}
      </nav>

      {/* Collapse toggle — desktop only (hidden when onClose is set = mobile overlay) */}
      {!onClose && (
        <div className="border-t border-white/10 p-3">
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`w-full flex items-center rounded-lg py-2 text-white/40 hover:text-white hover:bg-white/5 transition-all duration-150
              ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                 className={`transition-transform duration-300 flex-shrink-0 ${collapsed ? 'rotate-180' : ''}`}>
              <polyline points="11 17 6 12 11 7"/>
              <polyline points="18 17 13 12 18 7"/>
            </svg>
            {!collapsed && <span className="text-[11px] font-medium whitespace-nowrap">Collapse</span>}
          </button>
        </div>
      )}
    </aside>
  )
}

// Physician portal keeps its notification bell.
function NotifBell({ count = 0, onClick, title = 'Notifications' }) {
  return (
    <button onClick={onClick} title={title}
            className={`relative w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors ${onClick ? '' : 'cursor-default'}`}>
      <Icon name="alerts" size={18} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}

function UserChip({ user, subtitle, onLogout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const initials = (user?.full_name || user?.email || '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {/* Clickable profile chip */}
      <button onClick={() => setOpen(v => !v)}
              className="flex items-center gap-2.5 pl-1.5 sm:pr-3 pr-1.5 py-1.5 rounded-xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-150">
        {/* Avatar + online dot */}
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-white text-[12px] sm:text-[13px] font-bold"
               style={{ background: 'linear-gradient(135deg, #1a3d7c 0%, #0d1f35 100%)' }}>
            {initials}
          </div>
          <span className="absolute bottom-0 right-0 w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-emerald-400 ring-2 ring-white" />
        </div>
        {/* Name + subtitle — hidden on small screens */}
        <div className="hidden sm:flex flex-col leading-tight text-left">
          <span className="text-[13px] font-bold text-slate-800 whitespace-nowrap tracking-tight">
            {user?.full_name || user?.email}
          </span>
          <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">{subtitle}</span>
        </div>
        {/* Chevron — hidden on small screens */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
             strokeLinecap="round" strokeLinejoin="round"
             className={`hidden sm:block text-slate-400 transition-transform duration-200 ml-0.5 ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Logout button — hidden on small screens (use dropdown instead) */}
      <button onClick={onLogout} title="Sign out"
              className="hidden sm:flex w-8 h-8 rounded-lg border border-slate-200/80 bg-white shadow-sm hover:bg-rose-50 hover:border-rose-200 items-center justify-center text-slate-400 hover:text-rose-500 transition-all duration-150">
        <Icon name="logout" size={14} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-10 top-full mt-2 w-64 bg-white rounded-xl border border-slate-200 z-50"
             style={{ boxShadow: '0 4px 20px rgba(15,23,42,0.10)' }}>

          {/* Info rows */}
          <div className="px-4 py-2">
            {[
              { label: 'NPI',       value: user?.npi || '—' },
              { label: 'Specialty', value: subtitle?.split(' · ')[0] || '—' },
              { label: 'Location',  value: subtitle?.split(' · ')[1] || '—' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <span className="text-[11px] text-slate-400">{row.label}</span>
                <span className="text-[12px] font-semibold text-slate-700">{row.value}</span>
              </div>
            ))}
          </div>

          {/* Sign out */}
          <div className="px-3 pb-3 border-t border-slate-100">
            <button onClick={onLogout}
                    className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium text-rose-500 hover:bg-rose-50 transition-colors">
              <Icon name="logout" size={13} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreBadge({ score = 0 }) {
  const color = score > 80 ? '#e11d48' : score > 60 ? '#ea580c' : score > 30 ? '#d97706' : '#059669'
  return <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md flex-shrink-0" style={{ color, backgroundColor: `${color}1A` }}>{score}</span>
}

// Top-nav search: filters NPIs + suppliers client-side (datasets fetched once) and
// shows a dropdown; selecting a result navigates to its detail screen. Stays in sync
// with the leaderboard filter via value/onChange.
function SearchBox({ value = '', onChange, onOpenNpi, onOpenSupplier }) {
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [npis, setNpis] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const ref = useRef(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getNpiRiskList().catch(() => []), getSuppliers().catch(() => [])])
      .then(([n, s]) => { if (!cancelled) { setNpis(n); setSuppliers(s) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 300)
    return () => clearTimeout(t)
  }, [value])

  const active = debounced.trim().length >= 2
  useEffect(() => { setOpen(active) }, [active])

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const ql = debounced.trim().toLowerCase()
  const physMatches = active ? npis.filter((n) => (n.name || '').toLowerCase().includes(ql) || (n.npi || '').includes(ql)).slice(0, 5) : []
  const supMatches = active ? suppliers.filter((s) => (s.name || '').toLowerCase().includes(ql)).slice(0, 5) : []
  const none = active && physMatches.length === 0 && supMatches.length === 0

  function reset() { onChange?.(''); setDebounced(''); setOpen(false) }
  function onKeyDown(e) { if (e.key === 'Escape') reset() }
  function pickNpi(n) { setOpen(false); onChange?.(''); setDebounced(''); onOpenNpi?.(n) }
  function pickSup(s) { setOpen(false); onChange?.(''); setDebounced(''); onOpenSupplier?.(s) }

  return (
    <div ref={ref} className="relative hidden lg:block w-72">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon name="search" size={14} /></span>
      <input value={value} onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKeyDown} onFocus={() => setOpen(active)}
             placeholder="Search NPIs, suppliers…"
             className="w-full bg-slate-50 border border-slate-200/80 rounded-full pl-9 pr-4 py-2 text-sm text-slate-700 placeholder-slate-400 outline-none focus:bg-white focus:border-[#1E3A5F]/40 focus:ring-2 focus:ring-[#1E3A5F]/10 transition" />
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg z-50 overflow-hidden py-1.5" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
          {none ? (
            <div className="px-4 py-3 text-sm text-slate-400">No results for "{debounced.trim()}"</div>
          ) : (
            <>
              {physMatches.length > 0 && (
                <div>
                  <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Physicians</div>
                  {physMatches.map((n) => (
                    <button key={n.npi} onClick={() => pickNpi(n)} className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-800 truncate">{n.name}</div>
                        <div className="text-[11px] text-slate-400 tabular-nums">NPI {n.npi}</div>
                      </div>
                      <ScoreBadge score={n.score} />
                    </button>
                  ))}
                </div>
              )}
              {supMatches.length > 0 && (
                <div>
                  <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Suppliers</div>
                  {supMatches.map((s) => (
                    <button key={s.id} onClick={() => pickSup(s)} className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
                        <div className="text-[11px] text-slate-400 tabular-nums">{(s.distinctNPIs ?? 0)} NPIs</div>
                      </div>
                      {s.oig && <span className="text-[10px] font-bold text-rose-600 flex-shrink-0">OIG</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-0.5">{children}</div>
}
function Section({ label, value }) {
  return <div><SectionLabel>{label}</SectionLabel><div className="text-[13px] font-medium text-[#111827]">{value}</div></div>
}

// Payer profile menu: avatar/name toggles a dropdown with org / UEI / signatory /
// status. Org-level fields live in users.verification_results (not in the client auth
// payload), so the demo values are used as the fallback per spec.
function ProfileMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const name = user?.full_name || 'Payer Investigator'
  const email = user?.email || 'payer@mediclaim.com'
  const org = 'Meridian Health Plan'
  const uei = 'ABC123DEF456'
  const signatory = 'Dr. James Thornton'
  const signatoryTitle = 'Chief Compliance Officer'

  return (
    <div ref={ref} className="relative flex items-center gap-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-50 transition-colors">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold ring-2 ring-[#1E3A5F]/20 shadow-sm" style={{ backgroundColor: '#1E3A5F' }}>PI</div>
        <div className="hidden sm:flex flex-col leading-tight text-left">
          <span className="text-[13px] font-semibold text-slate-800">{name}</span>
          <span className="text-[11px] text-slate-400">Payer</span>
        </div>
      </button>
      <button onClick={onLogout} title="Sign out"
              className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
        <Icon name="logout" size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[288px] bg-white rounded-xl z-50 overflow-hidden border border-slate-200" style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>

          {/* Info rows */}
          <div className="px-4 py-2">
            {[
              { label: 'Organization',  value: org },
              { label: 'UEI',           value: uei },
              { label: 'Signatory',     value: signatory, sub: signatoryTitle },
              { label: 'SAM.gov',       value: '✓ Verified', green: true },
              { label: 'Member Since',  value: 'June 2026' },
            ].map(row => (
              <div key={row.label} className="flex items-start justify-between gap-6 py-2.5 border-b border-slate-50 last:border-0">
                <span className="text-[11px] font-medium text-slate-400 shrink-0 mt-px">{row.label}</span>
                <div className="text-right">
                  <span className={`text-[12px] font-semibold ${row.green ? 'text-emerald-600' : 'text-slate-700'}`}>{row.value}</span>
                  {row.sub && <div className="text-[11px] text-slate-400 mt-0.5">{row.sub}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Sign out */}
          <div className="px-3 pb-3 pt-1 border-t border-slate-100">
            <button onClick={onLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium text-rose-600 hover:bg-rose-50 transition-colors">
              <Icon name="logout" size={13} stroke={2} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Shell({ navItems, activeId, onNavigate, title, user, subtitle,
                                showSearch = false, searchValue = '', onSearchChange,
                                onOpenNpi, onOpenSupplier, canGoBack = false, onBack,
                                breadcrumbs,
                                notifCount = 0, bellTitle, onBellClick, onLogout, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const showCrumbs = breadcrumbs && breadcrumbs.length > 1

  function toggleCollapse() {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
      return next
    })
  }

  return (
    <div className="h-full flex bg-slate-100 overflow-hidden">

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex-shrink-0 animate-slide-in-left">
            <Sidebar navItems={navItems} activeId={activeId}
                     onNavigate={(id) => { onNavigate(id); setSidebarOpen(false) }}
                     collapsed={false} onToggleCollapse={() => {}}
                     onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar — always visible md+ */}
      <div className="hidden md:flex">
        <Sidebar navItems={navItems} activeId={activeId} onNavigate={onNavigate}
                 collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[60px] bg-white border-b border-slate-200/70 shadow-[0_1px_6px_rgba(15,23,42,0.06)] flex items-center gap-2 sm:gap-3 px-3 sm:px-7 flex-shrink-0">
          {/* Hamburger — mobile only */}
          <button onClick={() => setSidebarOpen(true)} aria-label="Open menu"
                  className="md:hidden flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          {canGoBack && (
            <button onClick={onBack} aria-label="Go back" title="Go back"
                    className="group flex items-center justify-center w-8 h-8 flex-shrink-0 rounded-full border border-slate-200 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-ink hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20">
              <Icon name="chevronRight" size={16} className="rotate-180 transition-transform duration-200 group-hover:-translate-x-0.5" stroke={2.3} />
            </button>
          )}
          <h1 className="text-[15px] sm:text-[17px] font-bold text-slate-900 tracking-tight truncate min-w-0 flex-1">{title}</h1>
          <div className="flex-shrink-0 flex items-center gap-2">
            {showSearch ? (
              <>
                <SearchBox value={searchValue} onChange={onSearchChange} onOpenNpi={onOpenNpi} onOpenSupplier={onOpenSupplier} />
                <ProfileMenu user={user} onLogout={onLogout} />
              </>
            ) : (
              <>
                <NotifBell count={notifCount} onClick={onBellClick} title={bellTitle} />
                <UserChip user={user} subtitle={subtitle} onLogout={onLogout} />
              </>
            )}
          </div>
        </header>

        {/* Breadcrumb trail — only shown when more than one level deep */}
        {showCrumbs && (() => {
          const Sep = () => (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                 strokeLinecap="round" strokeLinejoin="round" className="text-slate-200 shrink-0 mx-0.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          )
          const HomeIcon = () => (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          )

          const total = breadcrumbs.length
          const root  = breadcrumbs[0]
          const last  = breadcrumbs[total - 1]
          const parent = total >= 2 ? breadcrumbs[total - 2] : null

          // Render a single crumb item (shared between mobile and desktop)
          function CrumbItem({ crumb, isRoot, isLast, maxW = 'max-w-[140px]' }) {
            if (isLast) {
              return (
                <span className={`text-[11px] sm:text-[12px] font-semibold text-slate-800 truncate ${maxW} sm:max-w-[240px] px-1 whitespace-nowrap`}>
                  {crumb.label}
                </span>
              )
            }
            if (crumb.onClick) {
              return (
                <button onClick={crumb.onClick}
                        className={`text-[11px] sm:text-[12px] font-medium px-1 py-0.5 rounded transition-colors whitespace-nowrap hover:text-[#0d1f35] hover:bg-slate-50 ${isRoot ? 'text-slate-400' : 'text-slate-500'}`}>
                  {isRoot
                    ? <span className="flex items-center gap-1"><HomeIcon /><span className="hidden sm:inline">{crumb.label}</span></span>
                    : <span className={`truncate block max-w-[100px] sm:max-w-[160px]`}>{crumb.label}</span>}
                </button>
              )
            }
            return (
              <span className="text-[11px] sm:text-[12px] font-medium text-slate-400 px-1 flex items-center gap-1 whitespace-nowrap">
                {isRoot && <HomeIcon />}
                <span className="max-w-[100px] sm:max-w-none truncate">{crumb.label}</span>
              </span>
            )
          }

          return (
            <nav className="px-3 sm:px-7 py-1.5 sm:py-2 bg-white border-b border-slate-100/80 flex-shrink-0">

              {/* ── Mobile: collapsed to root › … › parent › current ── */}
              <div className="sm:hidden flex items-center gap-0 min-w-0 overflow-hidden">
                {/* Root (home icon only on mobile) */}
                <CrumbItem crumb={root} isRoot isLast={total === 1} maxW="max-w-[60px]" />

                {total > 3 && (
                  <>
                    <Sep />
                    <span className="text-[11px] font-medium text-slate-400 px-1 select-none">…</span>
                  </>
                )}

                {/* Parent — second-to-last, shown if it exists and isn't root */}
                {parent && parent !== root && (
                  <>
                    <Sep />
                    <CrumbItem crumb={parent} isRoot={false} isLast={false} maxW="max-w-[90px]" />
                  </>
                )}

                {/* Current page */}
                {total > 1 && (
                  <>
                    <Sep />
                    <CrumbItem crumb={last} isRoot={false} isLast maxW="max-w-[110px]" />
                  </>
                )}
              </div>

              {/* ── Desktop: full trail ── */}
              <div className="hidden sm:flex items-center gap-0 min-w-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {breadcrumbs.map((crumb, i) => (
                  <Fragment key={i}>
                    {i > 0 && <Sep />}
                    <CrumbItem crumb={crumb} isRoot={i === 0} isLast={i === total - 1} />
                  </Fragment>
                ))}
              </div>

            </nav>
          )
        })()}

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
