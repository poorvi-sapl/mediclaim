import { Icon, fmtUSD } from './ui'

function KpiTile({ icon, label, value, accent = 'slate', valueClass = '', loading, onClick }) {
  const styles = {
    slate:  { icon: 'bg-slate-100 text-slate-500',    chevDot: 'bg-slate-100 text-slate-400' },
    navy:   { icon: 'bg-[#EEF2F7] text-[#1B3A5C]',   chevDot: 'bg-[#EEF2F7] text-[#1B3A5C]' },
    amber:  { icon: 'bg-amber-50 text-amber-500',     chevDot: 'bg-amber-50 text-amber-400' },
    emerald:{ icon: 'bg-emerald-50 text-emerald-600', chevDot: 'bg-emerald-50 text-emerald-500' },
  }
  const s = styles[accent] || styles.slate
  const cls = `group mc-card p-4 flex flex-col transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-6px_rgba(15,23,42,0.15)] w-full text-left ${onClick ? 'cursor-pointer' : ''}`
  const inner = (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 group-hover:scale-110 group-hover:rotate-6 group-hover:brightness-90 group-hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.18)] ${s.icon}`}>
          <Icon name={icon} size={16} />
        </div>
        {onClick && (
          <span className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-200 group-hover:translate-x-0.5 ${s.chevDot}`}>
            <Icon name="chevronRight" size={12} stroke={2.5} />
          </span>
        )}
      </div>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">{label}</div>
      {loading
        ? <div className="h-7 w-16 rounded bg-slate-100 animate-pulse mt-1.5" />
        : <div className={`text-2xl font-bold tabular-nums mt-1 text-slate-900 ${valueClass}`}>{value}</div>}
    </>
  )
  if (onClick) return <button onClick={onClick} className={cls}>{inner}</button>
  return <div className={cls}>{inner}</div>
}

const DEFAULT_PHYSICIAN = { name: '', npi: '', specialty: '', city: '', state: '' }
const DEFAULT_SUMMARY = { totalClaimsMonth: 0, totalAmountBilled: 0 }

const HOW_IT_WORKS = [
  { icon: 'check',  label: 'Confirm',         desc: 'Claim is legitimate and you recognize the supplier', iconCls: 'bg-emerald-50 text-emerald-600',  badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',  badgeLabel: 'Approve'  },
  { icon: 'x',      label: 'Dispute',          desc: 'Amount or service details are incorrect',            iconCls: 'bg-rose-50 text-rose-500',         badge: 'bg-rose-50 text-rose-600 ring-rose-200/60',          badgeLabel: 'Dispute'  },
  { icon: 'flag',   label: 'Flag Supplier',    desc: 'Supplier is unknown or suspicious to you',           iconCls: 'bg-amber-50 text-amber-500',        badge: 'bg-amber-50 text-amber-700 ring-amber-200/60',        badgeLabel: 'Flag'     },
  { icon: 'userx',  label: 'Unknown Patient',  desc: "You don't recognize the patient on this claim",      iconCls: 'bg-violet-50 text-violet-500',      badge: 'bg-violet-50 text-violet-700 ring-violet-200/60',      badgeLabel: 'Unknown'  },
]

// Local date (not UTC) so "this month" matches the user's calendar.
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SummaryCard({ setActiveScreen, pendingCount = 0, unknownCount = 0,
                                      physician = DEFAULT_PHYSICIAN, summary = DEFAULT_SUMMARY }) {
  const initials = (physician.name || 'Dr')
    .replace('Dr. ', '').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  // Stash a filter intent, then switch to My Claims (ClaimsTable reads it on mount).
  function goClaims(intent) {
    try { sessionStorage.setItem('physician_claims_intent', JSON.stringify(intent)) } catch { /* ignore */ }
    setActiveScreen('claims')
  }
  const now = new Date()
  const monthStart = isoLocal(new Date(now.getFullYear(), now.getMonth(), 1))
  const today = isoLocal(now)

  return (
    <div className="w-full px-7 py-7">
      {/* Header card */}
      <div className="mc-card px-5 py-3.5 mb-6 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#1B3A5C] flex items-center justify-center text-sm font-bold text-white flex-shrink-0">{initials}</div>
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <h1 className="text-[15px] font-bold text-slate-900 whitespace-nowrap">{physician.name || '—'}</h1>
            <span className="text-slate-300 hidden sm:inline text-xs">·</span>
            <p className="text-xs text-slate-500 whitespace-nowrap hidden sm:block">
              {physician.specialty || 'Physician'} · {[physician.city, physician.state].filter(Boolean).join(', ') || '—'}
            </p>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#EEF2F7] text-[#1B3A5C] ring-1 ring-[#1B3A5C]/10 tabular-nums whitespace-nowrap">NPI {physician.npi}</span>
          </div>
          <div className="ml-auto hidden sm:block text-slate-200"><Icon name="shield" size={32} stroke={1.4} /></div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiTile icon="claims" label="Claims This Month"     value={(summary.totalClaimsMonth || 0).toLocaleString()} accent="navy"
                 onClick={() => goClaims({ reviewed: 'all' })} />
        <KpiTile icon="clock"  label="Pending Your Review"   value={pendingCount} accent="amber"
                 valueClass={pendingCount > 0 ? 'text-amber-600' : ''}
                 onClick={() => goClaims({ reviewed: 'unreviewed' })} />
        <KpiTile icon="bolt"   label="Total Billed This Month" value={fmtUSD(summary.totalAmountBilled)} accent="emerald"
                 onClick={() => goClaims({ reviewed: 'all', dateFrom: monthStart, dateTo: today })} />
      </div>

      {/* Review banner */}
      <div className="mc-card px-6 py-4 mb-6 flex items-center gap-4">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center flex-shrink-0"><Icon name="alertTri" size={18} /></div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">
            {pendingCount > 0 ? `You have ${pendingCount} claims that need a quick review.` : "You're all caught up — no claims pending review."}
          </div>
          {unknownCount > 0 && <div className="text-xs text-slate-500 mt-0.5">{unknownCount} came from suppliers flagged on your account.</div>}
        </div>
        <button onClick={() => setActiveScreen('claims')}
                className="ml-auto flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-[#1B3A5C] bg-[#EEF2F7] hover:bg-[#dde6f0] border border-[#1B3A5C]/10 hover:border-[#1B3A5C]/20 transition-all duration-200 hover:-translate-y-px">
          Review Pending Claims
          <Icon name="chevronRight" size={13} stroke={2.5} />
        </button>
      </div>

      {/* How it works */}
      <div className="mc-card overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">How Review Works</h2>
            <p className="text-xs text-slate-400 mt-0.5">Five actions you can take on each claim</p>
          </div>
          <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">5 actions</span>
        </div>
        <div className="divide-y divide-slate-100">
          {HOW_IT_WORKS.map((item, i) => (
            <div key={item.label} className="group flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors duration-150">
              {/* Step number */}
              <span className="text-[11px] font-bold text-slate-300 tabular-nums w-5 flex-shrink-0 group-hover:text-slate-400 transition-colors">{String(i + 1).padStart(2, '0')}</span>
              {/* Icon */}
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 group-hover:scale-105 group-hover:shadow-sm ${item.iconCls}`}>
                <Icon name={item.icon} size={15} stroke={2.2} />
              </div>
              {/* Text */}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-slate-800">{item.label}</div>
                <div className="text-xs text-slate-400 mt-0.5 leading-snug">{item.desc}</div>
              </div>
              {/* Badge */}
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ring-1 flex-shrink-0 whitespace-nowrap hidden sm:inline-flex ${item.badge}`}>
                {item.badgeLabel}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
