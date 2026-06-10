import { StatCard, Icon, fmtUSD } from './ui'

const DEFAULT_PHYSICIAN = { name: '', npi: '', specialty: '', city: '', state: '' }
const DEFAULT_SUMMARY = { totalClaimsMonth: 0, totalAmountBilled: 0 }

const HOW_IT_WORKS = [
  { icon: 'check', label: 'Confirm', desc: 'Claim is legitimate and you recognize the supplier' },
  { icon: 'x', label: 'Dispute', desc: 'Amount or service details are incorrect' },
  { icon: 'flag', label: 'Flag Supplier', desc: 'Supplier is unknown or suspicious to you' },
  { icon: 'userx', label: 'Unknown Patient', desc: "You don't recognize the patient on this claim" },
  { icon: 'ban', label: 'Did Not Order', desc: 'You never prescribed or ordered this service' },
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
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      {/* Header card */}
      <div className="rounded-2xl p-6 mb-6 text-white relative overflow-hidden" style={{ backgroundColor: '#1B3A5C' }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center text-xl font-bold flex-shrink-0">{initials}</div>
          <div className="min-w-0">
            <h1 className="text-display text-2xl font-bold">{physician.name || '—'}</h1>
            <p className="text-sm text-white/70 mt-0.5">
              {physician.specialty || 'Physician'} · {[physician.city, physician.state].filter(Boolean).join(', ') || '—'}
            </p>
            <span className="inline-block mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white/10 ring-1 ring-white/20 tabular-nums">NPI {physician.npi}</span>
          </div>
          <div className="ml-auto hidden sm:block text-white/20"><Icon name="shield" size={48} stroke={1.4} /></div>
        </div>
      </div>

      {/* Stat cards — 3 across (change 1: Unknown Suppliers card removed) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
        <StatCard icon="claims" label="Claims This Month" value={(summary.totalClaimsMonth || 0).toLocaleString()} accent="navy"
                  onClick={() => goClaims({ reviewed: 'all' })} />
        <StatCard icon="clock" label="Pending Your Review" value={pendingCount} accent="amber" valueClass={pendingCount > 0 ? 'text-amber-600' : ''}
                  onClick={() => goClaims({ reviewed: 'unreviewed' })} />
        <StatCard icon="bolt" label="Total Billed This Month" value={fmtUSD(summary.totalAmountBilled)} accent="emerald"
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
        <button onClick={() => setActiveScreen('claims')} className="ml-auto btn-navy flex-shrink-0">
          Review Pending Claims <Icon name="leaderboard" size={14} />
        </button>
      </div>

      {/* How it works */}
      <div className="mc-card p-6">
        <h2 className="text-base font-bold text-slate-900 mb-4">How Review Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.label} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-100 text-ink flex items-center justify-center mt-0.5"><Icon name={item.icon} size={14} stroke={2.2} /></span>
              <div>
                <span className="text-sm font-semibold text-slate-800">{item.label}</span>
                <span className="text-sm text-slate-500 ml-1.5">{item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
