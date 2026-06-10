import { useState, useEffect, useRef } from 'react'
import { getNpiRiskList, getSuppliers } from '../api'
import { Icon } from './ui'

function Sidebar({ navItems, activeId, onNavigate }) {
  return (
    <aside className="w-60 flex-shrink-0 flex flex-col" style={{ backgroundColor: '#1B3A5C' }}>
      <div className="h-16 flex items-center gap-2.5 px-5">
        <div className="w-9 h-9 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center text-white">
          <Icon name="shield" size={18} stroke={2.1} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-bold text-white tracking-tight">MediClaim</div>
          <div className="text-[10px] font-semibold text-white/50 tracking-[0.18em] uppercase">Analytics</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((n) => (
          <button key={n.id} onClick={() => onNavigate(n.id)}
                  className={`nav-link w-full ${activeId === n.id ? 'nav-link-active' : ''}`}>
            <Icon name={n.icon} size={18} stroke={activeId === n.id ? 2.2 : 1.9} />
            {n.label}
          </button>
        ))}
      </nav>
      <div className="px-5 py-4 text-[10px] text-white/30 border-t border-white/10">
        Fraud Detection Platform
      </div>
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
  const initials = (user?.full_name || user?.email || '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: '#1B3A5C' }}>
        {initials}
      </div>
      <div className="hidden sm:flex flex-col leading-tight">
        <span className="text-sm font-semibold text-slate-800">{user?.full_name || user?.email}</span>
        <span className="text-[11px] text-slate-400">{subtitle}</span>
      </div>
      <button onClick={onLogout} title="Sign out"
              className="ml-1 w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
        <Icon name="logout" size={17} />
      </button>
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
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon name="search" size={15} /></span>
      <input value={value} onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKeyDown} onFocus={() => setOpen(active)}
             placeholder="Search NPIs, suppliers…"
             className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/15 transition" />
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
  const email = user?.email || 'plan@claimlens.com'
  const org = 'Meridian Health Plan'
  const uei = 'ABC123DEF456'
  const signatory = 'Dr. James Thornton'
  const signatoryTitle = 'Chief Compliance Officer'

  return (
    <div ref={ref} className="relative flex items-center gap-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: '#1E3A5F' }}>PI</div>
        <div className="hidden sm:flex flex-col leading-tight text-left">
          <span className="text-sm font-semibold text-slate-800">{name}</span>
          <span className="text-[11px] text-slate-400">Payer</span>
        </div>
      </button>
      <button onClick={onLogout} title="Sign out"
              className="ml-1 w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
        <Icon name="logout" size={17} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[280px] bg-white rounded-lg z-50 overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
          <div className="px-4 py-3.5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ backgroundColor: '#1E3A5F' }}>PI</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#111827]">{name}</div>
              <div className="text-xs text-[#6B7280] truncate">Payer · {email}</div>
            </div>
          </div>
          <div className="h-px bg-[#F3F4F6]" />
          <div className="px-4 py-3 space-y-3">
            <Section label="Organization" value={org} />
            <Section label="UEI" value={uei} />
            <div>
              <SectionLabel>Authorized Signatory</SectionLabel>
              <div className="text-[13px] font-medium text-[#111827]">{signatory}</div>
              <div className="text-[13px] text-[#6B7280]">{signatoryTitle}</div>
            </div>
            <div>
              <SectionLabel>Account Status</SectionLabel>
              <div className="text-[13px] font-medium text-slate-700 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#10B981' }} /> Active</div>
            </div>
            <div>
              <SectionLabel>SAM.gov</SectionLabel>
              <div className="text-[13px] font-medium" style={{ color: '#10B981' }}>✓ Verified</div>
            </div>
            <Section label="Member Since" value="June 2026" />
          </div>
          <div className="h-px bg-[#F3F4F6]" />
          <button onClick={onLogout} className="w-full text-left px-4 py-3 text-[13px] text-[#DC2626] hover:bg-[#FEF2F2] transition-colors">Sign out</button>
        </div>
      )}
    </div>
  )
}

export default function Shell({ navItems, activeId, onNavigate, title, user, subtitle,
                                showSearch = false, searchValue = '', onSearchChange,
                                onOpenNpi, onOpenSupplier,
                                notifCount = 0, bellTitle, onBellClick, onLogout, children }) {
  return (
    <div className="h-full flex bg-slate-100">
      <Sidebar navItems={navItems} activeId={activeId} onNavigate={onNavigate} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-4 px-7 flex-shrink-0">
          <h1 className="text-lg font-bold text-slate-900">{title}</h1>
          <div className="ml-auto flex items-center gap-3">
            {showSearch ? (
              // Payer top nav: search + profile menu, no notification bell.
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
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
