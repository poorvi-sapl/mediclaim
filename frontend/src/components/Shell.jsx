import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNpiRiskList, getSuppliers } from '../api'
import { riskBand } from '../lib/risk'
import { Icon } from './ui'
import { Shield, Check } from 'lucide-react'

function Sidebar({ navItems, activeId, onNavigate, collapsed, onToggleCollapse, onClose, color = '#0d1f35', hoverExpand = false, brandName = 'MedClaim Analytics' }) {
  const navigate = useNavigate()

  // Vendor portal's "Scientific Blue" moodboard sidebar: always collapsed to an
  // icon rail, expands on hover via pure CSS (.app-sidebar in index.css) rather
  // than a persisted collapsed/expanded state — no toggle button, no localStorage.
  if (hoverExpand) {
    return (
      <aside className="app-sidebar flex-shrink-0 flex flex-col h-screen sticky top-0" style={{ backgroundColor: color }}>
        <div className="as-brand flex items-center gap-2.5 h-16 px-3 flex-shrink-0 cursor-pointer" onClick={() => navigate('/')}>
          <div className="bg-white p-1.5 rounded-lg shadow-sm relative flex-shrink-0">
            <Shield size={18} className="text-[#1e3a8a]" fill="#1e3a8a" fillOpacity={0.1} />
            <Check size={11} className="text-[#1e3a8a] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" strokeWidth={3} />
          </div>
          <span className="as-brand-name text-[14px] font-bold text-white">{brandName}</span>
        </div>
        <nav className="flex-1 py-3 px-3 space-y-1 overflow-hidden">
          {navItems.map((n) => (
            <button key={n.id} onClick={() => onNavigate(n.id)} title={n.label}
                    className={`as-item w-full ${activeId === n.id ? 'active' : ''}`}>
              <Icon name={n.icon} size={18} stroke={activeId === n.id ? 2.2 : 1.9} />
              <span className="as-label truncate">{n.label}</span>
            </button>
          ))}
        </nav>
      </aside>
    )
  }

  return (
    <aside
      className="flex-shrink-0 flex flex-col h-screen sticky top-0 transition-all duration-300 ease-in-out overflow-hidden"
      style={{ backgroundColor: color, width: collapsed ? '64px' : onClose ? 'min(240px, 85vw)' : '240px' }}>

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
              {brandName}
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
function NotifBell({ count = 0, onClick, title = 'Notifications', variant }) {
  // Vendor's "Scientific Blue" moodboard bell: a square .gicon-btn with a
  // small solid .badge-dot count, instead of the generic rounded-icon style.
  if (variant === 'vendor') {
    return (
      <button onClick={onClick} title={title} className={`gicon-btn ${onClick ? '' : 'cursor-default'}`}>
        <Icon name="alerts" size={16} />
        {count > 0 && <span className="badge-dot">{count > 9 ? '9+' : count}</span>}
      </button>
    )
  }
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

function UserChip({ user, subtitle, infoRows, profileStats, profileActions, profileContacts, onLogout, variant, compact = false }) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef(null)
  const isVendor = variant === 'vendor'

  const initials = (user?.full_name || user?.email || '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setMenuOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {/* Clickable profile chip */}
      {isVendor ? (
        // Vendor's "Scientific Blue" moodboard profile chip: square navy
        // avatar + stacked name/sub, no border/shadow/chevron wrapper.
        // `compact` (navbar mode) drops the name/sub — avatar only, detail
        // lives in the profile panel opened on click.
        <button onClick={() => setMenuOpen(v => !v)} className="profile-chip">
          <div className="profile-avatar">{initials}</div>
          {!compact && (
            <div className="hidden sm:flex flex-col leading-tight text-left">
              <span className="profile-name whitespace-nowrap">{user?.full_name || user?.email}</span>
              <span className="profile-sub whitespace-nowrap">{subtitle}</span>
            </div>
          )}
        </button>
      ) : (
        <button onClick={() => setMenuOpen(v => !v)}
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
      )}

      {/* Small dropdown: Profile (opens the detail panel/modal below) + Logout.
          Shared by the physician chip and the vendor chip — replaces the chip
          opening the profile card directly. */}
      {menuOpen && (
        <div className="absolute top-full right-0 mt-2 w-52 bg-white rounded-2xl shadow-lg ring-1 ring-slate-100 py-2 z-50">
          <button onClick={() => { setMenuOpen(false); setOpen(true) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[14px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            <Icon name="user" size={17} className="text-slate-400" />
            Profile
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button onClick={() => { setMenuOpen(false); onLogout?.() }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[14px] font-semibold text-[#8A423D] hover:bg-[#F7EBEA] transition-colors">
            <Icon name="logout" size={17} />
            Logout
          </button>
        </div>
      )}

      {/* Centered modal — vendor's "Provider profile panel" moodboard recipe: identity
          header with a quick-contact circle, label-above-value stats, two primary
          CTAs, then a grouped, dividered action list. Rendered centered over the
          whole screen (not a corner dropdown) so it reads as a proper profile card. */}
      {open && isVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4"
             onClick={() => setOpen(false)}>
          <div className="pp w-[340px] max-w-full relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} aria-label="Close"
                    className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
              <Icon name="x" size={14} stroke={2.3} />
            </button>
            <div className="pp-id">
              <div className="flex items-center gap-3">
                <div className="pp-avatar">{initials}</div>
                <div className="min-w-0">
                  <div className="font-bold text-[15px] truncate" style={{ color: 'var(--navy-900)' }}>{user?.full_name || user?.email}</div>
                  <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--slate-blue)' }}>{subtitle}</div>
                  {user?.npi && (
                    <div className="text-[11px] font-medium truncate mt-0.5" style={{ color: 'var(--n-500)' }}>NPI {user.npi}</div>
                  )}
                </div>
              </div>
              {(profileContacts?.length > 0 || user?.email) && (
                <div className="pp-contact">
                  {(profileContacts || [{ icon: 'mail', href: `mailto:${user.email}`, title: user.email }]).map((c) => (
                    c.href ? (
                      <a key={c.icon} href={c.href} className="pp-contact-btn" title={c.title}>
                        <Icon name={c.icon} size={15} />
                      </a>
                    ) : (
                      <button key={c.icon} type="button" className="pp-contact-btn" title={c.title}
                              onClick={() => { setOpen(false); c.onClick?.() }}>
                        <Icon name={c.icon} size={15} />
                      </button>
                    )
                  ))}
                </div>
              )}
            </div>

            {profileStats?.length > 0 && (
              <div className="pp-stats">
                {profileStats.map((s) => (
                  <div key={s.label} className="pp-stat">
                    <div className="text-[10.5px]" style={{ color: 'var(--n-500)' }}>{s.label}</div>
                    <div className="font-bold text-[16px] mt-1" style={{ color: s.tone ? `var(--${s.tone}-tx)` : 'var(--navy-900)' }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {profileActions?.slice(0, 2).length > 0 && (
              <div className="pp-cta">
                {profileActions.slice(0, 2).map((a, i) => (
                  <button key={a.label} type="button" className={`gbtn ${i === 0 ? 'gbtn-primary' : ''}`} style={{ flex: 1 }}
                          onClick={() => { setOpen(false); a.onClick?.() }}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            {profileActions?.slice(2).length > 0 && (
              <div className="pp-group">
                {profileActions.slice(2).map((a) => (
                  <div key={a.label} className={`pp-item ${a.danger ? 'danger' : ''}`}
                       onClick={() => { setOpen(false); a.onClick?.() }}>
                    <Icon name={a.icon} size={16} />{a.label}
                  </div>
                ))}
              </div>
            )}
            <div className="pp-group">
              <div className="pp-item danger" onClick={() => { setOpen(false); onLogout?.() }}>
                <Icon name="logout" size={16} />Sign out
              </div>
            </div>
          </div>
        </div>
      )}
      {open && !isVendor && (
        <div className="absolute right-0 sm:right-10 top-full mt-2 w-64 max-w-[calc(100vw-16px)] bg-white rounded-xl border border-slate-200 z-50"
             style={{ boxShadow: '0 4px 20px rgba(15,23,42,0.10)' }}>

          {/* Name header — visible on mobile only (hidden in chip) */}
          <div className="sm:hidden px-4 pt-3.5 pb-2.5 border-b border-slate-100 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0"
                 style={{ background: 'linear-gradient(135deg, #1a3d7c 0%, #0d1f35 100%)' }}>
              {initials}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-slate-800 truncate">{user?.full_name || user?.email}</div>
              <div className="text-[11px] text-slate-500 truncate">{subtitle}</div>
            </div>
          </div>

          {/* Info rows — caller may pass explicit rows (e.g. vendor billing contact);
              otherwise derive NPI / Specialty / Location from the subtitle. */}
          <div className="px-4 py-2">
            {(infoRows || [
              { label: 'NPI',       value: user?.npi || '—' },
              { label: 'Specialty', value: subtitle?.split(' · ')[0] || '—' },
              { label: 'Location',  value: subtitle?.split(' · ')[1] || '—' },
            ]).map(row => (
              <div key={row.label} className="flex items-start justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
                <span className="text-[11px] text-slate-400 flex-shrink-0">{row.label}</span>
                <span className="text-[12px] font-semibold text-slate-700 text-right break-words min-w-0">{row.value || '—'}</span>
              </div>
            ))}
          </div>

          {/* Sign out */}
          <div className="px-3 pb-3 border-t border-slate-100">
            <button onClick={onLogout}
                    className="mt-2 w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-medium text-rose-500 hover:bg-rose-50 transition-colors">
              <Icon name="logout" size={14} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Vendor portal's single top navbar — replaces the sidebar entirely (no
// left-hand chrome at all). Brand + nav links on the left, search/bell/profile
// on the right, single sticky row. Only ever rendered for `layout="navbar"`.
function Navbar({ navItems, activeId, onNavigate, brandName, searchValue, onSearchChange, showNavbarSearch = true,
                   bellSlot, notifCount, onBellClick, bellTitle, canGoBack = false, onBack,
                   user, subtitle, infoRows, profileStats, profileActions, profileContacts, onLogout }) {
  return (
    <header className="navbar">
      <div className="flex items-center gap-6 min-w-0">
        {canGoBack && (
          <button onClick={onBack} aria-label="Go back" title="Go back"
                  className="group flex items-center justify-center w-8 h-8 flex-shrink-0 rounded-full border border-slate-200 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-ink hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20">
            <Icon name="chevronRight" size={16} className="rotate-180 transition-transform duration-200 group-hover:-translate-x-0.5" stroke={2.3} />
          </button>
        )}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0"
               style={{ background: 'linear-gradient(135deg, var(--slate-blue), var(--navy-900))' }}>
            <Shield size={15} className="text-white" strokeWidth={2} />
          </div>
          <span className="text-[15px] font-extrabold whitespace-nowrap" style={{ fontFamily: 'var(--font-display)', color: 'var(--navy-900)' }}>
            {brandName}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <nav className="flex items-center gap-1">
          {navItems.map((n) => {
            const active = activeId === n.id
            // Icon-only unless active — same pattern as the physician/payer nav;
            // hover on a collapsed item shows a rounded navy tooltip.
            if (!active) {
              return (
                <button key={n.id} onClick={() => onNavigate(n.id)}
                        className="relative group flex items-center justify-center w-9 h-9 rounded-full text-[#5B84C4] hover:bg-[var(--n-50)] hover:text-[var(--n-700)] transition-colors border-0 cursor-pointer bg-transparent">
                  <Icon name={n.icon} size={17} stroke={1.9} />
                  <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold text-white whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible pointer-events-none transition-all duration-150 z-50"
                        style={{ background: 'var(--navy-900)', boxShadow: '0 6px 16px rgba(10,31,61,.25)' }}>
                    {n.label}
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2"
                          style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '5px solid var(--navy-900)' }} />
                  </span>
                </button>
              )
            }
            return (
              <button key={n.id} onClick={() => onNavigate(n.id)} className="nav-link active">
                <Icon name={n.icon} size={16} stroke={2.2} />
                <span>{n.label}</span>
              </button>
            )
          })}
        </nav>
        {showNavbarSearch && (
          <div className="relative hidden sm:block">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--n-400)' }}>
              <Icon name="search" size={13} />
            </span>
            <input
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Search claims, notes…"
              className="navbar-search"
              style={searchValue ? { paddingRight: 28 } : undefined}
            />
            {searchValue && (
              <button
                onClick={() => onSearchChange?.('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full hover:bg-[var(--n-200)] transition-colors"
                style={{ color: 'var(--n-500)' }}
              >
                <Icon name="x" size={11} stroke={2.4} />
              </button>
            )}
          </div>
        )}
        {bellSlot || <NotifBell count={notifCount} onClick={onBellClick} title={bellTitle} variant="vendor" />}
        <UserChip user={user} subtitle={subtitle} infoRows={infoRows} onLogout={onLogout}
                  profileStats={profileStats} profileActions={profileActions} profileContacts={profileContacts}
                  variant="vendor" compact />
      </div>
    </header>
  )
}

function ScoreBadge({ score = 0 }) {
  // Was a separate rose/orange/amber/emerald palette; now the same four band
  // colors every other risk indicator in the payer UI uses.
  const { color } = riskBand(score)
  return <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md flex-shrink-0" style={{ color, backgroundColor: `${color}1A` }}>{score}</span>
}

// Top-nav search: filters NPIs + suppliers client-side (datasets fetched once) and
// shows a dropdown; selecting a result navigates to its detail screen. Stays in sync
// with the leaderboard filter via value/onChange.
function SearchBox({ value = '', onChange, onOpenNpi, onOpenSupplier, plainMode = false, placeholder = 'Search NPIs, vendors…' }) {
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [npis, setNpis] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const ref = useRef(null)

  useEffect(() => {
    if (plainMode) return
    let cancelled = false
    Promise.all([getNpiRiskList().catch(() => []), getSuppliers().catch(() => [])])
      .then(([n, s]) => { if (!cancelled) { setNpis(n); setSuppliers(s) } })
    return () => { cancelled = true }
  }, [plainMode])

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
    <div ref={ref} className="relative hidden lg:block w-80">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon name="search" size={16} /></span>
      <input value={value} onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKeyDown} onFocus={() => setOpen(!plainMode && active)}
             placeholder={placeholder}
             className="w-full bg-slate-50 border border-slate-200/80 rounded-full pl-10 pr-9 py-2.5 text-[15px] text-slate-700 placeholder-slate-400 outline-none focus:bg-white focus:border-[#1E3A5F]/40 focus:ring-2 focus:ring-[#1E3A5F]/10 transition" />
      {value && (
        <button onClick={reset} aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
          <Icon name="x" size={10} stroke={2.4} />
        </button>
      )}
      {!plainMode && open && (
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
                  <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Vendors</div>
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

// Payer profile menu: avatar/name toggles a centered profile panel (same
// "Provider profile panel" recipe as the vendor portal's UserChip modal —
// identity header + contact icon + info rows + Sign out) instead of a corner
// dropdown. Org-level fields live in users.verification_results (not in the
// client auth payload), so the demo values are used as the fallback per spec.
// Wrapped in .vendor-theme so it can reuse the .pp/.pp-item classes and CSS
// vars (navy palette, fonts) without duplicating them for this non-vendor portal.
function ProfileMenu({ user, onLogout, compact = false }) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setMenuOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const name = user?.full_name || 'Payer Investigator'
  const email = user?.email || 'payer@mediclaim.com'
  const org = 'Meridian Health Plan'
  const uei = 'ABC123DEF456'
  const signatory = 'Dr. James Thornton'
  const signatoryTitle = 'Chief Compliance Officer'
  const initials = name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'PI'

  return (
    <div ref={ref} className="relative flex items-center gap-3">
      <button onClick={() => setMenuOpen((v) => !v)}
              className={compact ? 'flex items-center' : 'flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-50 transition-colors'}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-bold ring-2 ring-[#1E3A5F]/20 shadow-sm" style={{ backgroundColor: '#1E3A5F' }}>{initials}</div>
        {!compact && (
          <div className="hidden sm:flex flex-col leading-tight text-left">
            <span className="text-[13px] font-semibold text-slate-800">{name}</span>
            <span className="text-[11px] text-slate-400">Payer</span>
          </div>
        )}
      </button>

      {/* Small dropdown: Profile (opens the detail panel below) + Logout.
          Replaces the old behavior where clicking the avatar opened the full
          profile card directly. */}
      {menuOpen && (
        <div className="absolute top-full right-0 mt-2 w-52 bg-white rounded-2xl shadow-lg ring-1 ring-slate-100 py-2 z-50">
          <button onClick={() => { setMenuOpen(false); setOpen(true) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[14px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            <Icon name="user" size={17} className="text-slate-400" />
            Profile
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button onClick={() => { setMenuOpen(false); onLogout?.() }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[14px] font-semibold text-[#8A423D] hover:bg-[#F7EBEA] transition-colors">
            <Icon name="logout" size={17} />
            Logout
          </button>
        </div>
      )}

      {/* Centered modal — same recipe/classes as the vendor portal's provider
          profile panel, rendered over the whole screen instead of a corner dropdown. */}
      {open && (
        <div className="vendor-theme fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4"
             onClick={() => setOpen(false)}>
          <div className="pp w-[340px] max-w-full relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} aria-label="Close"
                    className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
              <Icon name="x" size={14} stroke={2.3} />
            </button>

            <div className="pp-id">
              <div className="flex items-center gap-3">
                <div className="pp-avatar">{initials}</div>
                <div className="min-w-0">
                  <div className="font-bold text-[15px] truncate" style={{ color: 'var(--navy-900)' }}>{name}</div>
                  <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--slate-blue)' }}>{org}</div>
                </div>
              </div>
              <div className="pp-contact">
                <a href={`mailto:${email}`} className="pp-contact-btn" title={email}>
                  <Icon name="mail" size={15} />
                </a>
              </div>
            </div>

            {/* Info rows */}
            <div className="px-[18px] pb-[14px]">
              {[
                { label: 'Organization',  value: org },
                { label: 'UEI',           value: uei },
                { label: 'Signatory',     value: signatory, sub: signatoryTitle },
                { label: 'SAM.gov',       value: '✓ Verified', green: true },
                { label: 'Member Since',  value: 'June 2026' },
              ].map(row => (
                <div key={row.label} className="flex items-start justify-between gap-4 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--n-100)' }}>
                  <span className="text-[11px] font-medium shrink-0 mt-px" style={{ color: 'var(--n-500)' }}>{row.label}</span>
                  <div className="text-right min-w-0">
                    <span className="text-[12px] font-semibold break-all" style={{ color: row.green ? 'var(--success-tx)' : 'var(--n-700)' }}>{row.value}</span>
                    {row.sub && <div className="text-[11px] mt-0.5" style={{ color: 'var(--n-500)' }}>{row.sub}</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="pp-group">
              <div className="pp-item danger" onClick={() => { setOpen(false); onLogout?.() }}>
                <Icon name="logout" size={16} />Sign out
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Breadcrumb trail — only shown when more than one level deep. Shared between
// the sidebar layout's header and the payer/vendor top-navbar layouts.
function Breadcrumbs({ breadcrumbs }) {
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
}

// Payer portal's top header — transparent row that blends into the light page
// background (no white bar, no brand). Left side is an inline breadcrumb trail
// (home icon + path back to Dashboard); right side keeps the nav pills (the
// only route to some screens), search, bell and profile.
function PlainNavbar({ navItems, activeId, onNavigate,
                       showSearch, searchValue, onSearchChange, searchPlainMode, searchPlaceholder,
                       onOpenNpi, onOpenSupplier, breadcrumbs, headerGreeting,
                       transparentHeader = false, iconOnlyNav = false,
                       bellSlot, notifCount, onBellClick, bellTitle, user, onLogout }) {
  const crumbs = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : [{ label: 'Dashboard', active: true }]
  const HomeIcon = () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
  const Sep = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 shrink-0 mx-0.5">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
  return (
    <header className={`flex items-center justify-between gap-4 px-4 sm:px-7 py-4 flex-shrink-0 sticky top-0 z-20 ${transparentHeader ? '' : 'bg-white border-b'}`}
             style={transparentHeader ? undefined : { borderColor: 'var(--color-border)' }}>
      {/* Left side — a personal greeting on the dashboard/overview screen
          ("Hey {name}" + today's date), otherwise the inline breadcrumb trail
          (home icon + path, straight on the page background). */}
      {headerGreeting ? (
        <div className="min-w-0">
          <h1 className="text-[17px] sm:text-[19px] font-extrabold leading-tight truncate"
              style={{ fontFamily: "'Manrope',sans-serif", color: 'var(--color-primary)', letterSpacing: '-0.01em' }}>
            {headerGreeting.title}
          </h1>
          {headerGreeting.sub && (
            <div className="text-[11.5px] font-medium leading-tight mt-0.5 truncate" style={{ color: 'var(--color-text-body)' }}>
              {headerGreeting.sub}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1
            return (
              <Fragment key={i}>
                {i > 0 && <Sep />}
                {isLast ? (
                  <span className="flex items-center gap-1.5 text-[15.5px] font-bold whitespace-nowrap px-1" style={{ color: 'var(--color-primary)' }}>
                    {i === 0 && <HomeIcon />}{crumb.label}
                  </span>
                ) : crumb.onClick ? (
                  <button onClick={crumb.onClick}
                          className="flex items-center gap-1.5 text-[15px] font-medium text-slate-500 hover:text-[var(--color-primary)] px-1 py-0.5 rounded transition-colors whitespace-nowrap">
                    {i === 0 && <HomeIcon />}{crumb.label}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 text-[15px] font-medium text-slate-400 px-1 whitespace-nowrap">
                    {i === 0 && <HomeIcon />}{crumb.label}
                  </span>
                )}
              </Fragment>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-3 flex-shrink-0 min-w-0">
        <nav className="flex items-center gap-1">
          {navItems.map((n) => {
            const active = activeId === n.id
            // iconOnlyNav: inactive items collapse to just their icon; only the
            // page you're on expands to the full icon+label navy pill.
            if (iconOnlyNav && !active) {
              return (
                <button key={n.id} onClick={() => onNavigate(n.id)}
                        className="relative group flex items-center justify-center w-9 h-9 rounded-full text-[var(--color-primary-tint)] hover:bg-white hover:text-[var(--color-text-dark)] transition-colors">
                  <Icon name={n.icon} size={17} stroke={1.9} />
                  {/* Custom hover tooltip — styled navy pill instead of the native title bubble */}
                  <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold text-white whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible pointer-events-none transition-all duration-150 z-50"
                        style={{ background: 'var(--color-primary)', boxShadow: '0 6px 16px rgba(10,31,61,.25)' }}>
                    {n.label}
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2"
                          style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '5px solid var(--color-primary)' }} />
                  </span>
                </button>
              )
            }
            return (
              <button key={n.id} onClick={() => onNavigate(n.id)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[13.5px] font-semibold whitespace-nowrap transition-colors
                        ${active ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-body)] hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text-dark)]'}`}>
                <Icon name={n.icon} size={15} stroke={active ? 2.2 : 1.9} className={active ? '' : 'text-[var(--color-primary-tint)]'} />
                <span className={iconOnlyNav ? '' : 'hidden md:inline'}>{n.label}</span>
              </button>
            )
          })}
        </nav>
        {showSearch && <SearchBox value={searchValue} onChange={onSearchChange} onOpenNpi={onOpenNpi} onOpenSupplier={onOpenSupplier}
                                   plainMode={searchPlainMode} placeholder={searchPlaceholder} />}
        {bellSlot || <NotifBell count={notifCount} onClick={onBellClick} title={bellTitle} />}
        <ProfileMenu user={user} onLogout={onLogout} compact />
      </div>
    </header>
  )
}

export default function Shell({ navItems, activeId, onNavigate, title, user, subtitle,
                                infoRows, profileStats, profileActions, profileContacts,
                                showSearch = false, searchValue = '', onSearchChange, showNavbarSearch = true,
                                searchPlainMode = false, searchPlaceholder,
                                onOpenNpi, onOpenSupplier, canGoBack = false, onBack,
                                breadcrumbs, headerGreeting, sidebarColor, sidebarHoverExpand = false, brandName, brandSubtitle, themeClass = '',
                                transparentHeader = false, iconOnlyNav = false,
                                layout = 'sidebar', scrollable = true,
                                notifCount = 0, bellTitle, onBellClick, bellSlot, onLogout, children }) {
  // Both declared unconditionally regardless of `layout` — the navbar branch
  // below returns before using them, but hooks can never be called
  // conditionally, so they're called up front either way.
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

  // Vendor portal's single top navbar — no sidebar, no header title/breadcrumbs/
  // back button at all, just brand+nav / search+bell+profile in one sticky row.
  if (layout === 'navbar') {
    return (
      <div className={`h-full flex flex-col bg-slate-100 overflow-hidden ${themeClass}`}>
        <Navbar
          navItems={navItems} activeId={activeId} onNavigate={onNavigate} brandName={brandName}
          searchValue={searchValue} onSearchChange={onSearchChange} showNavbarSearch={showNavbarSearch}
          bellSlot={bellSlot} notifCount={notifCount} onBellClick={onBellClick} bellTitle={bellTitle}
          canGoBack={canGoBack} onBack={onBack}
          user={user} subtitle={subtitle} infoRows={infoRows}
          profileStats={profileStats} profileActions={profileActions} profileContacts={profileContacts}
          onLogout={onLogout}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    )
  }

  // Payer portal's top header — transparent breadcrumb row on a light-blue
  // page background (no white navbar, no brand); crumbs render inline in the
  // header itself instead of a separate bar.
  if (layout === 'navbar-plain') {
    return (
      <div className={`h-full flex flex-col bg-slate-100 overflow-hidden ${themeClass}`}>
        <PlainNavbar
          navItems={navItems} activeId={activeId} onNavigate={onNavigate}
          showSearch={showSearch} searchValue={searchValue} onSearchChange={onSearchChange}
          searchPlainMode={searchPlainMode} searchPlaceholder={searchPlaceholder}
          onOpenNpi={onOpenNpi} onOpenSupplier={onOpenSupplier}
          breadcrumbs={breadcrumbs} headerGreeting={headerGreeting}
          transparentHeader={transparentHeader} iconOnlyNav={iconOnlyNav}
          bellSlot={bellSlot} notifCount={notifCount} onBellClick={onBellClick} bellTitle={bellTitle}
          user={user} onLogout={onLogout}
        />
        <main className={`flex-1 min-h-0 ${scrollable ? 'overflow-y-auto' : 'overflow-hidden'}`}>{children}</main>
      </div>
    )
  }

  return (
    <div className={`h-full flex bg-slate-100 overflow-hidden ${themeClass}`}>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex-shrink-0 animate-slide-in-left">
            <Sidebar navItems={navItems} activeId={activeId}
                     onNavigate={(id) => { onNavigate(id); setSidebarOpen(false) }}
                     collapsed={false} onToggleCollapse={() => {}}
                     onClose={() => setSidebarOpen(false)} color={sidebarColor} brandName={brandName} />
          </div>
        </div>
      )}

      {/* Desktop sidebar — always visible md+ */}
      <div className="hidden md:flex">
        <Sidebar navItems={navItems} activeId={activeId} onNavigate={onNavigate}
                 collapsed={collapsed} onToggleCollapse={toggleCollapse} color={sidebarColor}
                 hoverExpand={sidebarHoverExpand} brandName={brandName} />
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
                <SearchBox value={searchValue} onChange={onSearchChange} onOpenNpi={onOpenNpi} onOpenSupplier={onOpenSupplier}
                           plainMode={searchPlainMode} placeholder={searchPlaceholder} />
                {bellSlot || <NotifBell count={notifCount} onClick={onBellClick} title={bellTitle} />}
                <ProfileMenu user={user} onLogout={onLogout} />
              </>
            ) : (
              <>
                {bellSlot || <NotifBell count={notifCount} onClick={onBellClick} title={bellTitle} variant={themeClass === 'vendor-theme' ? 'vendor' : undefined} />}
                <UserChip user={user} subtitle={subtitle} infoRows={infoRows} onLogout={onLogout}
                          profileStats={profileStats} profileActions={profileActions} profileContacts={profileContacts}
                          variant={themeClass === 'vendor-theme' ? 'vendor' : undefined} />
              </>
            )}
          </div>
        </header>

        {showCrumbs && <Breadcrumbs breadcrumbs={breadcrumbs} />}

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
