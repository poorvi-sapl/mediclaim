// Shared UI primitives for the MedClaim Analytics light theme.

const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  leaderboard: <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
  suppliers: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  alerts: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
  claims: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></>,
  search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  alertTri: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  check: <polyline points="20 6 9 17 4 12"/>,
  x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  userx: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></>,
  ban: <><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></>,
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>,
  chevronRight: <polyline points="9 18 15 12 9 6"/>,
}

export function Icon({ name, size = 18, stroke = 1.9, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      {ICONS[name] || null}
    </svg>
  )
}

export const fmtUSD = (n, dp = 0) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: dp }).format(n || 0)

// Backend sends naive UTC ISO strings (no 'Z'); mark them UTC so the browser
// doesn't misread them as local time.
function toDate(d) {
  if (typeof d === 'string' && d.includes('T') && !/[zZ]|[+-]\d\d:?\d\d$/.test(d)) d += 'Z'
  return new Date(d)
}

export const fmtDate = (d) => {
  if (!d) return '—'
  const dt = toDate(d)
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

export function timeAgo(d) {
  const t = toDate(d).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s} sec ago`
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
  const dd = Math.floor(h / 24); return `${dd} day${dd > 1 ? 's' : ''} ago`
}

const ACCENTS = {
  navy:   { chip: 'bg-slate-100 text-ink',          line: '#1B3A5C' },
  rose:   { chip: 'bg-rose-50 text-rose-500',       line: '#f43f5e' },
  amber:  { chip: 'bg-amber-50 text-amber-500',     line: '#f59e0b' },
  blue:   { chip: 'bg-blue-50 text-blue-500',       line: '#3b82f6' },
  emerald:{ chip: 'bg-emerald-50 text-emerald-500', line: '#10b981' },
}

// tiny deterministic sparkline (no randomness)
function Spark({ color }) {
  const pts = [6, 10, 7, 12, 9, 14, 11, 16].map((y, i) => `${i * 14},${24 - y}`).join(' ')
  return (
    <svg width="100%" height="28" viewBox="0 0 98 24" preserveAspectRatio="none" className="mt-3">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
    </svg>
  )
}

export function StatCard({ icon, label, value, accent = 'navy', valueClass = '', spark = true, loading, onClick }) {
  const a = ACCENTS[accent] || ACCENTS.navy
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.chip}`}>
          <Icon name={icon} size={18} />
        </div>
      </div>
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-4">{label}</div>
      {loading
        ? <div className="h-8 w-20 rounded bg-slate-100 animate-pulse mt-1" />
        : <div className={`text-display text-3xl font-bold tabular-nums mt-0.5 text-slate-900 ${valueClass}`}>{value}</div>}
      {spark && <Spark color={a.line} />}
    </>
  )
  if (onClick) {
    // change 5: clickable card — shadow lift on hover (no border change) + a chevron
    // in the bottom-right that fades in on hover to signal clickability.
    return (
      <button onClick={onClick}
              className="group relative mc-card p-5 text-left w-full cursor-pointer transition-shadow duration-150 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
        {inner}
        <span className="absolute bottom-3 right-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
          <Icon name="chevronRight" size={14} />
        </span>
      </button>
    )
  }
  return <div className="mc-card p-5">{inner}</div>
}

const RISK_PILL = {
  Critical: 'pill-critical', critical: 'pill-critical',
  High: 'pill-high', high: 'pill-high',
  Medium: 'pill-medium', medium: 'pill-medium',
  Low: 'pill-low', low: 'pill-low',
}
export function RiskPill({ band, score }) {
  const label = band || (score > 80 ? 'Critical' : score > 60 ? 'High' : score > 30 ? 'Medium' : 'Low')
  const cap = label.charAt(0).toUpperCase() + label.slice(1)
  return <span className={`pill ${RISK_PILL[label] || 'pill-low'}`}>{score != null && <span className="tabular-nums">{score}</span>}{cap}</span>
}

const PLAN_STATUS = {
  pending:       { cls: 'pill-medium', label: 'Pending', icon: 'clock' },
  under_review:  { cls: 'pill-high',   label: 'Under Review', icon: 'alertTri' },
  acknowledged:  { cls: 'pill-low',    label: 'Acknowledged', icon: 'check' },
  case_opened:   { cls: 'pill-critical', label: 'Case Opened', icon: 'flag' },
  dismissed:     { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'Dismissed', icon: 'x' },
}
export function PlanStatusPill({ status }) {
  const s = PLAN_STATUS[status] || PLAN_STATUS.pending
  return <span className={`pill ${s.cls}`}><Icon name={s.icon} size={11} stroke={2.5} />{s.label}</span>
}

export function SearchInput({ value, onChange, placeholder, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
        <Icon name="search" size={15} />
      </span>
      <input value={value} onChange={onChange} placeholder={placeholder}
             className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/15 transition" />
    </div>
  )
}
