import { useState, useRef } from 'react'
import { Icon, fmtUSD } from './ui'

/* ─── KPI Card Hover Preview (iframe thumbnail) ──────────────────── */
const IS_PREVIEW = typeof window !== 'undefined' && window.location.search.includes('preview=1')
const PREVIEW_SCALE = 360 / 1440
const THUMB_W = 360
const THUMB_H = Math.round(900 * PREVIEW_SCALE)  // 225

function HoverPreview({ children, url }) {
  const [visible, setVisible]       = useState(false)
  const [shouldLoad, setShouldLoad] = useState(false)
  const [loaded, setLoaded]         = useState(false)
  const enterTimer = useRef(null)
  const leaveTimer = useRef(null)

  const show = () => {
    clearTimeout(leaveTimer.current)
    enterTimer.current = setTimeout(() => { setShouldLoad(true); setVisible(true) }, 320)
  }
  const hide = () => {
    clearTimeout(enterTimer.current)
    leaveTimer.current = setTimeout(() => setVisible(false), 160)
  }

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {shouldLoad && (
        <div
          onMouseEnter={show} onMouseLeave={hide}
          style={{
            position: 'absolute', top: 'calc(100% + 12px)', left: '50%',
            transform: 'translateX(-50%)', zIndex: 50,
            opacity: visible ? 1 : 0, visibility: visible ? 'visible' : 'hidden',
            pointerEvents: visible ? 'auto' : 'none',
            transition: 'opacity 0.18s cubic-bezier(0.16,1,0.3,1), visibility 0.18s',
            filter: 'drop-shadow(0 16px 48px rgba(15,23,42,0.22))',
          }}
        >
          <div style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: '7px solid #1e1e2e' }} />
          <div style={{ width: THUMB_W, background: '#1e1e2e', borderRadius: '10px 10px 0 0', padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              {['#ff5f57', '#febc2e', '#28c840'].map(col => (
                <span key={col} style={{ width: 9, height: 9, borderRadius: '50%', background: col, display: 'block' }} />
              ))}
            </div>
            <div style={{ flex: 1, background: '#2d2d3f', borderRadius: 5, padding: '2px 8px', fontSize: 9, color: '#9ca3af', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {typeof window !== 'undefined' ? window.location.host : ''}/claims
            </div>
          </div>
          <div style={{ width: THUMB_W, height: THUMB_H, overflow: 'hidden', borderRadius: '0 0 10px 10px', border: '1px solid #1e1e2e', borderTop: 'none', position: 'relative', background: '#f8fafc' }}>
            <iframe
              src={url}
              title="page-preview"
              tabIndex={-1}
              style={{ width: 1440, height: 900, transform: `scale(${PREVIEW_SCALE})`, transformOrigin: '0 0', border: 'none', pointerEvents: 'none' }}
              onLoad={() => setLoaded(true)}
            />
            {!loaded && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
                <div className="preview-spinner" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function KpiTile({ icon, label, value, accent = 'slate', valueClass = '', loading, onClick }) {
  const styles = {
    slate:  { icon: 'bg-slate-100 text-slate-500',    chevDot: 'bg-slate-100 text-slate-400' },
    navy:   { icon: 'bg-[#EEF2F7] text-[#1B3A5C]',   chevDot: 'bg-[#EEF2F7] text-[#1B3A5C]' },
    amber:  { icon: 'bg-amber-50 text-amber-500',     chevDot: 'bg-amber-50 text-amber-400' },
    emerald:{ icon: 'bg-emerald-50 text-emerald-600', chevDot: 'bg-emerald-50 text-emerald-500' },
    rose:   { icon: 'bg-red-100 text-red-400',         chevDot: 'bg-red-100 text-red-400' },
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

export function PhysicianHeader({ physician = DEFAULT_PHYSICIAN }) {
  const initials = (physician.name || 'Dr')
    .replace('Dr. ', '').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="mc-card px-5 py-3.5 relative overflow-hidden">
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
  )
}

export function ReviewBanner({ pendingCount = 0, unknownCount = 0, setActiveScreen }) {
  return (
    <div className="mc-card px-6 py-4 flex items-center gap-4">
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
  )
}

export function StatCardGrid({ summary = DEFAULT_SUMMARY, pendingCount = 0, setActiveScreen }) {
  function goClaims(intent) {
    try { sessionStorage.setItem('physician_claims_intent', JSON.stringify(intent)) } catch { /* ignore */ }
    setActiveScreen('claims')
  }
  const now = new Date()
  const monthStart = isoLocal(new Date(now.getFullYear(), now.getMonth(), 1))
  const today = isoLocal(now)
  const _base = `${window.location.origin}${window.location.pathname}?preview=1&screen=claims`
  const wrap = (url, tile) => IS_PREVIEW ? tile : <HoverPreview url={url}>{tile}</HoverPreview>
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {wrap(_base,
        <KpiTile icon="claims" label="Claims This Month"       value={(summary.totalClaimsMonth || 0).toLocaleString()} accent="navy"
                 onClick={() => goClaims({ reviewed: 'all' })} />
      )}
      {wrap(_base,
        <KpiTile icon="clock"  label="Pending Your Review"     value={pendingCount} accent="amber"
                 valueClass={pendingCount > 0 ? 'text-amber-600' : ''}
                 onClick={() => goClaims({ reviewed: 'unreviewed' })} />
      )}
      {wrap(_base,
        <KpiTile icon="bolt"   label="Total Billed This Month" value={fmtUSD(summary.totalAmountBilled)} accent="rose"
                 onClick={() => goClaims({ reviewed: 'all', dateFrom: monthStart, dateTo: today })} />
      )}
    </div>
  )
}

export default function SummaryCard({ setActiveScreen, pendingCount = 0, unknownCount = 0,
                                      physician = DEFAULT_PHYSICIAN, summary = DEFAULT_SUMMARY,
                                      hideStatCards = false, hideHeader = false, hideReviewBanner = false }) {
  function goClaims(intent) {
    try { sessionStorage.setItem('physician_claims_intent', JSON.stringify(intent)) } catch { /* ignore */ }
    setActiveScreen('claims')
  }

  return (
    <div className="w-full px-7 py-7">
      {/* Header card — hidden when rendered separately at the top */}
      {!hideHeader && <div className="mb-6"><PhysicianHeader physician={physician} /></div>}

      {/* Stat cards — hidden when rendered separately at the top */}
      {!hideStatCards && (
        <div className="mb-6">
          <StatCardGrid summary={summary} pendingCount={pendingCount} setActiveScreen={setActiveScreen} />
        </div>
      )}

      {/* Review banner — hidden when rendered separately */}
      {!hideReviewBanner && (
        <div className="mb-6">
          <ReviewBanner pendingCount={pendingCount} unknownCount={unknownCount} setActiveScreen={setActiveScreen} />
        </div>
      )}

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
