import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Shell from '../components/Shell'
import { Icon, StatCard, fmtUSD, fmtDate, timeAgo, normalizeSearchQuery } from '../components/ui'
import { KpiCard } from '../components/ui/kpi-card-flat'
import { FileText, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  API_BASE,
  getVendorStats,
  getVendorClaims,
  getVendorDisputes,
  getVendorNotifications,
  submitVendorResponse,
  subscribeDisputeStream,
  getNotificationsCount,
  markNotificationsSeen,
} from '../api'

// Dashboard/Claims/Action Required — the standalone "Disputes" list stayed
// gone (My Claims' own status pills + column sort already cover browsing all
// of them), but a dedicated "Action Required" queue was added back for the
// narrower job of surfacing exactly what's still waiting on a vendor response
// (and, concretely, proof-of-work documents) so it isn't buried in the table.
const VENDOR_NAV = [
  { id: 'dashboard',       label: 'Dashboard',        icon: 'dashboard' },
  { id: 'claims',          label: 'Claims',           icon: 'claims'    },
  { id: 'actionRequired',  label: 'Action Required',  icon: 'alertTri'  },
]

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
        <div className="hidden sm:block">
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
            {/* Arrow */}
            <div style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: '7px solid #1e1e2e' }} />
            {/* Browser chrome */}
            <div style={{ width: THUMB_W, background: '#1e1e2e', borderRadius: '10px 10px 0 0', padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 5 }}>
                {['#ff5f57', '#febc2e', '#28c840'].map(col => (
                  <span key={col} style={{ width: 9, height: 9, borderRadius: '50%', background: col, display: 'block' }} />
                ))}
              </div>
              <div style={{ flex: 1, background: '#2d2d3f', borderRadius: 5, padding: '2px 8px', fontSize: 9, color: '#9ca3af', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {window.location.host}/claims
              </div>
            </div>
            {/* Scaled iframe */}
            <div style={{ width: THUMB_W, height: THUMB_H, overflow: 'hidden', borderRadius: '0 0 10px 10px', border: '1px solid #1e1e2e', borderTop: 'none', position: 'relative', background: '#f8fafc' }}>
              <iframe
                src={url}
                title="claims-preview"
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
        </div>
      )}
    </div>
  )
}

// ─── Sortable claim tables ──────────────────────────────────────────────────
// Shared by every `table.vclaims` in the portal (My Claims, dashboard "Needs
// your attention") so clicking Claim #/Service/Billed/DOS/Status always
// behaves the same way: first click sorts ascending, second flips to
// descending, clicking a different column resets to ascending on that column.
function useTableSort(defaultKey = null) {
  const [sortKey, setSortKey] = useState(defaultKey)
  const [sortDir, setSortDir] = useState('asc')
  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  return { sortKey, sortDir, toggleSort }
}

const CLAIM_SORT_VALUE = {
  claim_number:        (c) => c.claim_number || '',
  patient_name_partial: (c) => (c.patient_name_partial || '').toLowerCase(),
  service_description: (c) => (c.service_description || '').toLowerCase(),
  amount_billed:        (c) => c.amount_billed ?? 0,
  dos_from:             (c) => c.dos_from || '',
  status:               (c) => c.status || '',
}

function sortClaims(rows, sortKey, sortDir) {
  if (!sortKey) return rows
  const getVal = CLAIM_SORT_VALUE[sortKey]
  const sorted = [...rows].sort((a, b) => {
    const av = getVal(a), bv = getVal(b)
    if (av < bv) return -1
    if (av > bv) return 1
    return 0
  })
  return sortDir === 'desc' ? sorted.reverse() : sorted
}

// Clickable column header — shows a neutral up/down glyph at rest, a single
// filled chevron in the active sort direction once selected.
function SortTh({ label, sortKey, active, dir, onSort, align, width }) {
  return (
    <th style={{ ...(align === 'right' ? { textAlign: 'right' } : null), ...(width ? { width } : null) }}>
      <button
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors bg-transparent border-0 p-0 m-0 cursor-pointer"
        style={{ color: active ? 'var(--navy-900)' : 'inherit', font: 'inherit' }}
      >
        {label}
        <Icon name={active ? (dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'sort'} size={active ? 10 : 11} style={{ opacity: active ? 1 : 0.4 }} />
      </button>
    </th>
  )
}

// Status -> the moodboard's light-glass badge tone (.vbadge.<tone>) + icon,
// matching its own worked examples exactly: Pending=neutral/clock,
// Type-blind by design: the vendor is never shown WHY a physician flagged a
// claim (dispute / fraud / flag / deceased / reassign) — both of those map to
// one neutral "Action needed" badge here, so the status column can't leak the
// physician's action. Pending/Confirmed(=Approved) are benign and stay.
const STATUS_TONE = {
  PENDING:        'neutral',
  CONFIRMED:      'info',
  DISPUTED:       'warning',
  FRAUD_REPORTED: 'warning',
}
const STATUS_ICON = {
  PENDING:        'clock',
  CONFIRMED:      'check',
  DISPUTED:       'doc',
  FRAUD_REPORTED: 'doc',
}
const STATUS_LABEL = {
  PENDING:        'Pending',
  CONFIRMED:      'Approved',
  DISPUTED:       'Action needed',
  FRAUD_REPORTED: 'Action needed',
}

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || 'neutral'
  const label = STATUS_LABEL[status] || status?.replace(/_/g, ' ') || '—'
  return <span className={`vbadge ${tone}`}><Icon name={STATUS_ICON[status] || 'clock'} size={12} />{label}</span>
}

// Live split-flap countdown to a response deadline — ticks every second so
// the minutes digit visibly moves instead of a static "Xd left" chip.
function useCountdown(targetDate) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!targetDate) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [targetDate])

  if (!targetDate) return null
  const target = new Date(targetDate).getTime()
  const diff = target - now
  const expired = diff <= 0
  const totalSeconds = Math.max(0, Math.floor(diff / 1000))
  return {
    days:    Math.floor(totalSeconds / 86400),
    hours:   Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired,
  }
}

// One digit-pair (e.g. "12") plus its unit label underneath — matches the
// dispute-detail moodboard's flip-clock countdown exactly.
function DigitGroup({ value, unit, bg }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-[3px]">
        {String(value).padStart(2, '0').split('').map((ch, i) => (
          <div key={i} className="flex items-center justify-center rounded-md font-bold tabular-nums"
               style={{ width: 20, height: 26, fontSize: 14, fontFamily: 'var(--font-mono)', background: bg, color: '#fff' }}>
            {ch}
          </div>
        ))}
      </div>
      <span className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--n-400)' }}>{unit}</span>
    </div>
  )
}

function CountdownDigits({ days, hours, minutes, bg }) {
  const sep = <span className="font-bold self-start" style={{ color: 'var(--n-400)', marginTop: 6 }}>:</span>
  return (
    <div className="flex items-center gap-1">
      <DigitGroup value={days} unit="days" bg={bg} />
      {sep}
      <DigitGroup value={hours} unit="hours" bg={bg} />
      {sep}
      <DigitGroup value={minutes} unit="mins" bg={bg} />
    </div>
  )
}

// Header countdown widget — a LIVE ticking clock ("Response due in") while the
// case is still open, or a static elapsed-time readout ("Resolved in") once
// the vendor has actually responded — matches the two moodboard variants.
function DisputeCountdown({ dispute: d }) {
  const stillOpen = !d.vendor_responded_at && d.status !== 'NON_RESPONSIVE'
  const live = useCountdown(stillOpen ? d.response_due_date : null)

  if (d.vendor_responded_at) {
    const start = d.billing_provider_notified_at ? new Date(d.billing_provider_notified_at).getTime() : null
    const end = new Date(d.vendor_responded_at).getTime()
    const totalSeconds = start != null ? Math.max(0, Math.floor((end - start) / 1000)) : 0
    return (
      <div className="text-right">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--n-500)' }}>Resolved in</div>
        <CountdownDigits
          days={Math.floor(totalSeconds / 86400)}
          hours={Math.floor((totalSeconds % 86400) / 3600)}
          minutes={Math.floor((totalSeconds % 3600) / 60)}
          bg="var(--success)"
        />
      </div>
    )
  }

  if (d.status === 'NON_RESPONSIVE') {
    return (
      <div className="text-right">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--n-500)' }}>Response window closed</div>
        <CountdownDigits days={0} hours={0} minutes={0} bg="#8A3B35" />
      </div>
    )
  }

  if (!live) return null
  return (
    <div className="text-right">
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--n-500)' }}>
        {live.expired ? 'Response window closed' : 'Response due in'}
      </div>
      <CountdownDigits
        days={live.expired ? 0 : live.days}
        hours={live.expired ? 0 : live.hours}
        minutes={live.expired ? 0 : live.minutes}
        bg={live.expired ? '#8A3B35' : 'var(--navy-900)'}
      />
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin text-slate-400" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// ─── Dashboard analytics helpers ───────────────────────────────────────────────
// All four cards below are derived from the same `claims`/`disputes` arrays the
// rest of the portal already fetches — no new endpoints, just client-side
// bucketing — so the dashboard never shows a number that isn't backed by a
// real claim or dispute record.

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const HEATMAP_SCALE = ['var(--n-100)', 'var(--palest-blue)', 'var(--sky)', 'var(--slate-blue)', 'var(--blue-600)', 'var(--navy-900)']

// Monday-first weekday index (0=Mon..6=Sun) — JS Date.getDay() is Sunday-first.
function mondayIndex(date) {
  return (date.getDay() + 6) % 7
}

function buildSubmissionHeatmap(claims) {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  claims.forEach((c) => {
    const d = new Date(c.created_at || c.dos_from)
    if (Number.isNaN(d.getTime())) return
    counts[mondayIndex(d)]++
  })
  const max = Math.max(...counts)
  const steps = counts.map((n) => {
    if (max === 0 || n === 0) return 0
    return Math.max(1, Math.ceil((n / max) * (HEATMAP_SCALE.length - 1)))
  })
  const colors = steps.map((step) => HEATMAP_SCALE[step])
  // Steps 3+ (slate-blue/blue-600/navy-900) are dark enough to need white text.
  const textColors = steps.map((step) => (step >= 3 ? '#fff' : 'var(--navy-900)'))
  const peakDay = max > 0 ? WEEKDAY_FULL[counts.indexOf(max)] : null
  return { counts, colors, textColors, peakDay }
}

const WEEK_STATUS_SERIES = [
  { key: 'CONFIRMED',      label: 'Approved', color: 'var(--success)' },
  { key: 'PENDING',        label: 'Pending',  color: 'var(--warning)' },
]
const WEEKLY_BUCKET_COUNT = 8

function buildWeeklyStatusSeries(claims) {
  const buckets = Array.from({ length: WEEKLY_BUCKET_COUNT }, () => ({ CONFIRMED: 0, PENDING: 0, DISPUTED: 0, FRAUD_REPORTED: 0, weekLabel: '' }))
  const msWeek = 7 * 24 * 60 * 60 * 1000
  const now = new Date()
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  thisMonday.setDate(thisMonday.getDate() - mondayIndex(now))

  // Label each bucket with the short date of that week's Monday, so the x-axis
  // reads as real dates instead of an unlabeled line with no sense of scale.
  buckets.forEach((b, idx) => {
    const weeksAgo = WEEKLY_BUCKET_COUNT - 1 - idx
    const monday = new Date(thisMonday)
    monday.setDate(monday.getDate() - weeksAgo * 7)
    b.weekLabel = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })

  claims.forEach((c) => {
    const raw = c.created_at || c.dos_from
    if (!raw) return
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const weeksAgo = Math.floor((thisMonday - day) / msWeek)
    const idx = WEEKLY_BUCKET_COUNT - 1 - weeksAgo
    if (idx < 0 || idx >= WEEKLY_BUCKET_COUNT) return
    if (buckets[idx][c.status] != null) buckets[idx][c.status]++
  })
  return buckets
}

// The single most pressing open case: whichever deadline is closest — this is
// what "Respond now" should jump straight to. (The vendor payload is type-blind,
// so there's no fraud-first priority to sort by here.)
function pickUrgentDispute(disputes) {
  const open = disputes.filter((d) => d.status === 'OPEN' && !d.deadline_passed)
  if (!open.length) return null
  return [...open].sort((a, b) => (a.days_remaining ?? 999) - (b.days_remaining ?? 999))[0]
}

function buildUrgencyBreakdown(disputes) {
  if (!disputes.length) return null
  const total = disputes.length
  const overdue = disputes.filter((d) => d.status === 'NON_RESPONSIVE').length
  const urgent = disputes.filter((d) => d.status === 'OPEN' && !d.deadline_passed && d.days_remaining <= 3).length
  const recent = total - overdue - urgent
  return {
    overduePct: Math.round((overdue / total) * 100),
    urgentPct:  Math.round((urgent / total) * 100),
    recentPct:  Math.round((recent / total) * 100),
  }
}

// A single ring + percentage/label pair, laid out as a row — matches the
// moodboard's compact vertical urgency-breakdown list (ring, then text beside it).
function UrgencyRing({ pct, color, label }) {
  const r = 50, c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(100, pct || 0)) / 100)
  return (
    <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
      <div className="relative shrink-0" style={{ width: 130, height: 130 }}>
        <svg viewBox="0 0 130 130" width={130} height={130}>
          <circle cx="65" cy="65" r={r} fill="none" stroke="var(--n-100)" strokeWidth="12" />
          <circle cx="65" cy="65" r={r} fill="none" stroke={color} strokeWidth="12"
                  strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
                  transform="rotate(-90 65 65)" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[23px] font-bold" style={{ color: 'var(--navy-900)' }}>
          {pct}%
        </div>
      </div>
      <div className="text-[14px] text-center truncate max-w-full" style={{ color: 'var(--n-500)' }}>{label}</div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardScreen({ stats, claims, disputes, loading, error, onViewDisputes, onRespondDispute,
                           onViewAllClaims, onViewConfirmed, onViewOpenDisputes, onViewOverdue }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="mc-card px-5 py-4" style={{ background: 'var(--error-bg)', border: 'none' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--error-tx)' }}>Failed to load dashboard</p>
          <p className="text-xs text-slate-500 mt-1">{error}</p>
        </div>
      </div>
    )
  }

  const _base = `${window.location.origin}${window.location.pathname}?preview=1&screen=claims`
  const wrap = (url, tile) => IS_PREVIEW ? tile : <HoverPreview url={url}>{tile}</HoverPreview>

  return (
    <div className="px-4 sm:px-7 py-5 space-y-6 lg:h-full lg:flex lg:flex-col">
      {/* Greeting row — vendor name left, today's date right, same pattern as
          the physician and payer dashboards */}
      <div className="flex items-baseline justify-between flex-wrap gap-2 flex-shrink-0 !mt-0">
        <div>
          <div className="text-[19px] font-bold" style={{ color: 'var(--navy-900)' }}>
            {(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()}, {stats?.vendor_name || 'Vendor'}
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--n-500)' }}>Here's how your claims book looks today.</div>
        </div>
        <span className="text-[12px]" style={{ color: 'var(--n-500)' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 flex-shrink-0">
        {wrap(`${_base}&status=ALL&disputeStatus=ALL`,
          <KpiCard tone="default" label="Total Claims"   value={stats?.total_claims ?? 0}
                   sub="Across your full claims book" pct={100} onClick={onViewAllClaims}
                   icon={<FileText size={16} strokeWidth={2} />} />
        )}
        {wrap(`${_base}&status=CONFIRMED&disputeStatus=ALL`,
          <KpiCard tone="success" label="Confirmed Rate" value={`${stats?.confirmed_rate ?? 0}%`}
                   sub={`${stats?.total_claims ?? 0} claims reviewed`} pct={stats?.confirmed_rate ?? 0} onClick={onViewConfirmed}
                   icon={<CheckCircle2 size={16} strokeWidth={2} />} />
        )}
        {wrap(`${_base}&status=ALL&disputeStatus=OPEN`,
          <KpiCard tone="warning" label="Docs Requested"  value={stats?.open_disputes ?? 0}
                   sub="Awaiting your documents" pct={stats?.total_claims ? (stats.open_disputes / stats.total_claims) * 100 : 0} onClick={onViewOpenDisputes}
                   icon={<AlertTriangle size={16} strokeWidth={2} />} />
        )}
        {wrap(`${_base}&status=ALL&disputeStatus=NON_RESPONSIVE`,
          <KpiCard tone="danger"  label="Overdue"        value={stats?.overdue_disputes ?? 0}
                   sub="Escalated to compliance" pct={stats?.total_claims ? (stats.overdue_disputes / stats.total_claims) * 100 : 0} onClick={onViewOverdue}
                   icon={<Clock size={16} strokeWidth={2} />} />
        )}
      </div>

      {/* Dispute alert banner */}
      {stats?.open_disputes > 0 && (
        <button
          onClick={onViewDisputes}
          className="w-full text-left flex items-center gap-3 px-[18px] py-3.5 rounded-2xl transition-colors hover:bg-[var(--n-50)] flex-shrink-0"
          style={{ background: '#fff', border: '1px solid var(--n-200)', borderLeft: '3px solid var(--error)' }}
        >
          <Icon name="alertTri" size={18} className="shrink-0" style={{ color: 'var(--error)' }} />
          <span className="text-[13.5px] font-semibold flex-1" style={{ color: 'var(--navy-900)' }}>
            {stats.open_disputes} claim{stats.open_disputes !== 1 ? 's' : ''} need{stats.open_disputes === 1 ? 's' : ''} your documents.
          </span>
          <span className="text-[12.5px] font-semibold whitespace-nowrap" style={{ color: 'var(--slate-blue)' }}>
            Click to view and upload →
          </span>
        </button>
      )}

      {/* Analytics — fills whatever vertical space is left below the KPI row
          and banner on a tall viewport (grows with the device) instead of
          leaving dead gray space under a fixed-height grid; both columns
          stretch to match each other via the grid's default alignment. */}
      {(() => {
        const heatmap = buildSubmissionHeatmap(claims)
        const weeklyBuckets = buildWeeklyStatusSeries(claims)
        const urgentDispute = pickUrgentDispute(disputes)
        const urgency = buildUrgencyBreakdown(disputes)

        return (
            <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-4 lg:flex-1 lg:min-h-0">
              {/* Left column — status trend + submission heatmap, 60/40 split */}
              <div className="grid grid-rows-[3fr_2fr] gap-4 min-w-0">
                <div className="mc-card p-5 flex flex-col min-h-0">
                  <div className="text-[14px] font-bold text-slate-900 mb-3">Claims by status — last 8 weeks</div>
                  <div className="flex gap-3.5 flex-wrap mb-2.5">
                    {WEEK_STATUS_SERIES.map((s) => (
                      <span key={s.key} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--n-500)' }}>
                        <span className="w-2 h-2 rounded-[2px] inline-block shrink-0" style={{ background: s.color }} />{s.label}
                      </span>
                    ))}
                  </div>
                  {claims.length === 0 ? (
                    <div className="text-[13px] text-slate-400 py-10 text-center flex-1 flex items-center justify-center">No claims yet.</div>
                  ) : (
                    <div className="flex-1" style={{ width: '100%', minHeight: 120 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyBuckets} barGap={2} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                          <XAxis dataKey="weekLabel" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={28} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                          {WEEK_STATUS_SERIES.map((s) => (
                            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={14} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="mc-card p-5 flex flex-col min-h-0">
                  <div className="text-[14px] font-bold text-slate-900 mb-3.5">Submission heatmap (day of week)</div>
                  {claims.length === 0 ? (
                    <div className="text-[13px] text-slate-400 py-10 text-center flex-1 flex items-center justify-center">No claims yet.</div>
                  ) : (
                    <div className="flex-1 flex flex-col justify-center">
                      <div className="grid grid-cols-7 gap-[4px]">
                        {heatmap.counts.map((n, i) => (
                          <div key={i} title={`${WEEKDAY_FULL[i]}: ${n} claim${n !== 1 ? 's' : ''}`}
                               className="h-[32px] rounded-md flex items-center justify-center text-[11px] font-bold"
                               style={{ background: heatmap.colors[i], color: heatmap.textColors[i] }}>
                            {n}
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between mt-1.5">
                        {WEEKDAY_LABELS.map((l, i) => (
                          <span key={i} className="text-[10px]" style={{ color: 'var(--n-400)' }}>{l}</span>
                        ))}
                      </div>
                      <div className="text-[11px] mt-2.5" style={{ color: 'var(--n-500)' }}>
                        {heatmap.peakDay ? `Most claims filed ${heatmap.peakDay}.` : 'Not enough data yet.'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right column — needs-your-response sizes to its own content
                  (row track "auto", not "1fr") so it never gets stretched
                  taller than what it actually needs; urgency breakdown takes
                  whatever's left so the column still matches its sibling's height. */}
              <div className="grid grid-rows-[auto_1fr] gap-4 min-w-0">
                {urgentDispute ? (
                  <div className="min-h-0" style={{ background: 'linear-gradient(180deg, var(--error-bg), #fff 60%)', borderRadius: 16, padding: '20px 24px' }}>
                    <p className="text-[14px] font-bold m-0" style={{ color: 'var(--error-tx)' }}>Documents needed</p>

                    <div className="font-mono font-bold text-[14px] mt-3 truncate" style={{ color: 'var(--navy-900)' }}>{urgentDispute.claim_number}</div>
                    <div className="text-[12.5px] mt-0.5 truncate" style={{ color: 'var(--error-tx)' }}>
                      {urgentDispute.claim?.service_description || '—'}
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[12px]" style={{ color: 'var(--error-tx)', opacity: .85 }}>Requested {fmtDate(urgentDispute.opened_at)}</span>
                      <span className="text-[12.5px] font-bold" style={{ color: 'var(--error-tx)' }}>
                        {urgentDispute.days_remaining != null ? `Due in ${urgentDispute.days_remaining}d` : 'Due soon'}
                      </span>
                    </div>

                    <button onClick={() => onRespondDispute(urgentDispute)} className="gbtn gbtn-primary mt-3.5">
                      Upload docs →
                    </button>
                  </div>
                ) : (
                  <div className="mc-card p-5 flex items-center gap-3 min-h-0">
                    <Icon name="check" size={18} style={{ color: 'var(--success)' }} className="shrink-0" />
                    <div>
                      <div className="text-[13px] font-semibold text-slate-700">All caught up</div>
                      <div className="text-[12px] text-slate-400">No disputes need a response right now.</div>
                    </div>
                  </div>
                )}

                <div className="mc-card p-5 flex flex-col min-h-0">
                  <div className="text-[14px] font-bold text-slate-900 mb-3.5">Claim urgency breakdown</div>
                  {urgency ? (
                    <div className="flex-1 flex items-center justify-between gap-2">
                      <UrgencyRing pct={urgency.overduePct} color="var(--error)" label="Overdue" />
                      <UrgencyRing pct={urgency.urgentPct} color="var(--warning)" label="Urgent" />
                      <UrgencyRing pct={urgency.recentPct} color="var(--slate-blue)" label="Recent" />
                    </div>
                  ) : (
                    <div className="text-[13px] text-slate-400 py-10 text-center flex-1 flex items-center justify-center">No disputes yet.</div>
                  )}
                </div>
              </div>
            </div>
        )
      })()}
    </div>
  )
}

// ─── Claims list ──────────────────────────────────────────────────────────────
// Dot colors for the status dropdown are derived from STATUS_TONE (the same
// tone map StatusBadge renders with) via TONE_DOT, rather than hardcoding new
// hex values — if a status's tone ever changes, both the badge and this dot
// pick it up automatically.
const TONE_DOT = {
  neutral: 'var(--n-400)',
  info:    'var(--info)',
  warning: 'var(--warning)',
  error:   'var(--error)',
  success: 'var(--success)',
  solid:   'var(--error)',
}
// DISPUTED and FRAUD_REPORTED both surface as the neutral "Action needed"
// status, so the filter offers a single combined option (value 'ACTION') that
// matches either — no duplicate "Action needed" entries, and still no leak of
// which flagging action it was.
const CLAIM_STATUS_OPTIONS = [
  { id: 'ALL',       label: 'All' },
  { id: 'PENDING',   label: STATUS_LABEL.PENDING,   dot: TONE_DOT[STATUS_TONE.PENDING] },
  { id: 'CONFIRMED', label: STATUS_LABEL.CONFIRMED, dot: TONE_DOT[STATUS_TONE.CONFIRMED] },
  { id: 'ACTION',    label: 'Action needed',        dot: TONE_DOT.warning },
]

// Filters by the claim's *related dispute's* status — separate from
// CLAIM_STATUS_OPTIONS above. Verdict-blind: the vendor only sees the process
// state (docs requested → under review → closed), never how the physician
// decided, so all terminal states collapse into one neutral "Closed" bucket.
const CLAIM_DISPUTE_STATUS_OPTIONS = [
  { id: 'ALL',            label: 'All' },
  { id: 'OPEN',           label: 'Docs requested', dot: 'var(--warning)' },
  { id: 'REVIEW',         label: 'Under review',   dot: 'var(--info, #35607D)' },
  { id: 'NON_RESPONSIVE', label: 'Overdue',        dot: 'var(--error)' },
  { id: 'CLOSED',         label: 'Closed',         dot: 'var(--success)' },
]
function disputeStatusBucket(status) {
  if (status === 'OPEN') return 'OPEN'
  if (status === 'NON_RESPONSIVE') return 'NON_RESPONSIVE'
  if (status === 'PENDING_PHYSICIAN_REVIEW' || status === 'PENDING_PHYSICIAN_CONFIRMATION') return 'REVIEW'
  if (['RESOLVED_BY_PHYSICIAN', 'REFERRED_TO_PAYER', 'RESPONDED_TO_MEDICARE', 'CLOSED', 'REFERRED_OIG'].includes(status)) return 'CLOSED'
  return null
}

function ClaimsScreen({ claims, disputes, statusFilter, setStatusFilter, disputeStatusFilter, setDisputeStatusFilter, claimSearch, loading, onSelectClaim }) {
  const { sortKey, sortDir, toggleSort } = useTableSort()
  const filtered = sortClaims(claims.filter((c) => {
    const matchStatus = statusFilter === 'ALL'
      || (statusFilter === 'ACTION' ? (c.status === 'DISPUTED' || c.status === 'FRAUD_REPORTED') : c.status === statusFilter)
    const relatedDispute = disputes.find((d) => d.claim_number === c.claim_number)
    // Searches what a vendor might type to find a claim — claim #, patient,
    // service description, and the dispute's resolution-status label. The
    // claim's own review status is deliberately NOT searchable: the vendor is
    // type-blind, so typing "fraud" must not reveal which claims were reported.
    const q = normalizeSearchQuery(claimSearch)
    const matchSearch = !q
      || c.claim_number?.toLowerCase().includes(q)
      || c.patient_name_partial?.toLowerCase().includes(q)
      || c.service_description?.toLowerCase().includes(q)
      || (relatedDispute && (DISPUTE_STATUS_LABEL[relatedDispute.status] || '').toLowerCase().includes(q))
    const matchDisputeStatus = disputeStatusFilter === 'ALL'
      || (relatedDispute && disputeStatusBucket(relatedDispute.status) === disputeStatusFilter)
    return matchStatus && matchSearch && matchDisputeStatus
  }), sortKey, sortDir)

  return (
    <div className="px-4 sm:px-7 py-5 h-full flex flex-col gap-4 min-h-0">
      {/* No filter bar here — status filtering lives on the table's own Status
          column header (click it to open the same dropdown), and claim search
          lives once, in the navbar up top, instead of duplicated on this page. */}

      {/* Fills whatever vertical space the viewport has left below the filter
          bar — grows on a tall screen, shrinks on a short one — and scrolls
          its own rows internally instead of stretching the page. */}
      <div className="mc-card overflow-hidden flex flex-col flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="vclaims">
              {/* Header (and its Status/Dispute filter dropdowns) always renders,
                  even with zero matching rows — otherwise a filter combination
                  with no results hides the only controls that could change it,
                  leaving no way back except reloading the page. */}
              <thead className="sticky top-0 z-10">
                <tr>
                  <SortTh label="Claim #" sortKey="claim_number" active={sortKey === 'claim_number'} dir={sortDir} onSort={toggleSort} width="1%" />
                  <SortTh label="Patient" sortKey="patient_name_partial" active={sortKey === 'patient_name_partial'} dir={sortDir} onSort={toggleSort} />
                  <SortTh label="Service" sortKey="service_description" active={sortKey === 'service_description'} dir={sortDir} onSort={toggleSort} />
                  <SortTh label="Billed" sortKey="amount_billed" active={sortKey === 'amount_billed'} dir={sortDir} onSort={toggleSort} align="right" />
                  <SortTh label="DOS" sortKey="dos_from" active={sortKey === 'dos_from'} dir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-[13px] text-slate-400">
                      No claims match these filters.
                    </td>
                  </tr>
                ) : filtered.map((c) => {
                  // Only claims with an actual dispute case go anywhere when
                  // clicked (straight to that dispute) — a Pending/Confirmed
                  // claim has no detail page to jump to, so its row stays plain.
                  const relatedDispute = disputes.find((d) => d.claim_number === c.claim_number)
                  return (
                    <tr key={c.notification_id}
                        onClick={relatedDispute ? () => onSelectClaim(c) : undefined}
                        className={relatedDispute ? 'cursor-pointer' : ''}>
                      <td className="font-mono font-normal">{c.claim_number}</td>
                      <td className="whitespace-nowrap">{c.patient_name_partial || '—'}</td>
                      <td className="max-w-[320px] truncate">{c.service_description || '—'}</td>
                      <td className="text-right font-semibold">{fmtUSD(c.amount_billed)}</td>
                      <td className="whitespace-nowrap" style={{ color: 'var(--n-500)' }}>{fmtDate(c.dos_from)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Disputes list ────────────────────────────────────────────────────────────
// Vendor-facing case status is process-only and verdict-blind: the vendor sees
// "docs requested → under review → closed", never whether the physician
// approved or declined (RESOLVED_BY_PHYSICIAN vs REFERRED_TO_PAYER both read as
// "Closed"), and never the original action type.
const DISPUTE_STATUS_TONE = {
  OPEN:                  'warning',
  NON_RESPONSIVE:        'error',
  PENDING_PHYSICIAN_REVIEW: 'info',
  PENDING_PHYSICIAN_CONFIRMATION: 'info',
  RESPONDED_TO_MEDICARE: 'success',
  RESOLVED_BY_PHYSICIAN: 'success',
  REFERRED_TO_PAYER:     'success',
}
const DISPUTE_STATUS_ICON = {
  OPEN:                  'doc',
  NON_RESPONSIVE:        'x',
  PENDING_PHYSICIAN_REVIEW: 'clock',
  PENDING_PHYSICIAN_CONFIRMATION: 'clock',
  RESPONDED_TO_MEDICARE: 'check',
  RESOLVED_BY_PHYSICIAN: 'check',
  REFERRED_TO_PAYER:     'check',
}
const DISPUTE_STATUS_LABEL = {
  OPEN:                  'Docs requested',
  NON_RESPONSIVE:        'Overdue',
  PENDING_PHYSICIAN_REVIEW: 'Under review',
  PENDING_PHYSICIAN_CONFIRMATION: 'Under review',
  RESPONDED_TO_MEDICARE: 'Closed',
  RESOLVED_BY_PHYSICIAN: 'Closed',
  REFERRED_TO_PAYER:     'Closed',
}

function DisputeStatusBadge({ status }) {
  const tone = DISPUTE_STATUS_TONE[status] || 'neutral'
  const label = DISPUTE_STATUS_LABEL[status] || status?.replace(/_/g, ' ') || '—'
  return <span className={`vbadge ${tone}`}><Icon name={DISPUTE_STATUS_ICON[status] || 'clock'} size={12} />{label}</span>
}

// Custom filter dropdown — native <select> can't be styled past its trigger
// (the options panel is OS-rendered by the browser). Ported from the
// moodboard's "magnetic hover indicator" dropdown: a soft highlight div that
// slides to whichever option the mouse is over, tracked via each option's own
// offsetTop/offsetHeight rather than a fixed row height.
// The magnetic-hover option list a table header's own filter trigger
// (FilterTh, below) opens — the interaction (and its exact CSS) only lives
// in one place even though multiple column filters can use it.
function FilterOptionsPanel({ options, value, onChange, style }) {
  const [indicator, setIndicator] = useState({ top: 0, height: 0, opacity: 0 })
  return (
    <div className="vselect-panel" style={style}>
      <div className="voptions" onMouseLeave={() => setIndicator((i) => ({ ...i, opacity: 0 }))}>
        <div className="vhover-indicator" style={{ top: indicator.top, height: indicator.height, opacity: indicator.opacity }} />
        {options.map((opt) => (
          <div
            key={opt.id}
            className={`voption ${opt.id === value ? 'selected' : ''}`}
            onMouseEnter={(e) => setIndicator({ top: e.currentTarget.offsetTop, height: e.currentTarget.offsetHeight, opacity: 1 })}
            onClick={() => onChange(opt.id)}
          >
            <span className="voption-left truncate">
              {opt.dot && <span className="vdot" style={{ background: opt.dot }} />}
              {opt.label}
            </span>
            <Icon name="check" size={15} className="vcheck" />
          </div>
        ))}
      </div>
    </div>
  )
}

// A table column header that IS the filter — clicking it opens the same
// magnetic-hover dropdown a standalone select would, right-anchored so it can't spill
// past the table's edge when the column sits at the right side. Replaces a
// separate standalone filter dropdown in the toolbar above the table.
function FilterTh({ label, options, value, onChange, align }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = value && value !== 'ALL'

  useEffect(() => {
    if (!open) return
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <th ref={ref} style={{ position: 'relative', ...(align === 'right' ? { textAlign: 'right' } : null) }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors bg-transparent border-0 p-0 m-0 cursor-pointer"
        style={{ color: open || active ? 'var(--navy-900)' : 'inherit', font: 'inherit' }}
      >
        {label}
        <Icon name="chevronDown" size={11} style={{ opacity: open || active ? 1 : 0.4, transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <FilterOptionsPanel
          options={options}
          value={value}
          onChange={(id) => { onChange(id); setOpen(false) }}
          style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, left: 'auto', zIndex: 30 }}
        />
      )}
    </th>
  )
}

const RESOLVED_STATUSES = ['RESPONDED_TO_MEDICARE', 'RESOLVED_BY_PHYSICIAN']

// ─── Dispute detail + response form ──────────────────────────────────────────
function fmtFileSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Action Required — a dedicated queue of open disputes/fraud reports still
// needing a vendor response, framed around the concrete next step (upload
// proof-of-work documents) instead of a generic "Disputes" list. Reuses the
// same selectDispute()/DisputeDetailScreen flow every other entry point uses
// (Dashboard's "Respond now", My Claims rows) — this screen just collects
// everything outstanding in one place instead of requiring the vendor to spot
// it inside the claims table.
function ActionRequiredScreen({ disputes, loading, error, onRespond }) {
  const [filter, setFilter] = useState('open')   // 'open' | 'overdue' | 'responded' — set by clicking a hero stat

  const pending = disputes
    .filter((d) => d.status === 'OPEN' && !d.deadline_passed)
    .sort((a, b) => (a.days_remaining ?? 999) - (b.days_remaining ?? 999))

  if (loading) {
    return (
      <div className="px-4 sm:px-7 py-5 space-y-3">
        {[0, 1, 2].map((i) => <div key={i} className="mc-card animate-pulse" style={{ height: 104 }} />)}
      </div>
    )
  }
  if (error) {
    return (
      <div className="px-4 sm:px-7 py-5">
        <div className="mc-card p-5" style={{ background: 'var(--error-bg)', border: '1px solid #EBD3D1' }}>
          <span className="font-semibold" style={{ color: 'var(--error-tx)' }}>Couldn't load action items:</span> {error}
        </div>
      </div>
    )
  }

  const overdueList = pending.filter((d) => (d.days_remaining ?? 99) <= 0)
  // Across ALL cases (not just the pending queue) — the ones the vendor has
  // already answered. Both a hero counter and its own filtered view below.
  const responded = disputes
    .filter((d) => d.vendor_responded_at)
    .sort((a, b) => new Date(b.vendor_responded_at) - new Date(a.vendor_responded_at))

  const visible = filter === 'overdue' ? overdueList : filter === 'responded' ? responded : pending

  const HERO_STATS = [
    { id: 'open',      value: pending.length,   label: 'Open cases' },
    { id: 'overdue',   value: overdueList.length, label: 'Overdue today', color: '#F0A199' },
    { id: 'responded', value: responded.length, label: 'Responses submitted' },
  ]

  const EMPTY_TEXT = {
    open:      'No claims are waiting on document uploads right now.',
    overdue:   'Nothing is overdue today.',
    responded: "You haven't submitted any responses yet.",
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Hero — deliberately says nothing about WHY a claim needs docs (dispute
          vs fraud report); the vendor only sees that documents are required.
          Each stat is a filter: clicking it narrows the list below to it. */}
      <div className="flex-shrink-0" style={{ background: 'var(--navy-900)', padding: '24px 28px', color: '#fff' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Action required</h1>
        <p style={{ fontSize: 12.5, color: '#B9CBE8', marginTop: 5, maxWidth: 640 }}>
          Claims that need your supporting documents uploaded.
        </p>
        <div style={{ display: 'flex', gap: 28, marginTop: 16, flexWrap: 'wrap' }}>
          {HERO_STATS.map((s) => {
            const active = filter === s.id
            return (
              <button key={s.id} onClick={() => setFilter(s.id)}
                      className="text-left cursor-pointer transition-opacity hover:opacity-100"
                      style={{ background: 'none', border: 0, padding: '0 0 4px', opacity: active ? 1 : 0.7,
                               borderBottom: `2px solid ${active ? (s.color || '#fff') : 'transparent'}` }}>
                <div style={{ fontWeight: 800, fontSize: 22, color: s.color || '#fff' }}>{s.value}</div>
                <div style={{ fontSize: 11, color: '#8FA6C9', marginTop: 2 }}>{s.label}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-7 py-5">
        {visible.length === 0 ? (
          <div className="mc-card p-8 flex flex-col items-center gap-2.5 text-center">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: 'var(--success-bg)' }}>
              <Icon name="check" size={18} style={{ color: 'var(--success)' }} />
            </div>
            <div className="font-bold text-[14px]" style={{ color: 'var(--navy-900)' }}>
              {filter === 'responded' ? 'Nothing here yet' : "You're all caught up"}
            </div>
            <p className="text-[12.5px]" style={{ color: 'var(--n-500)' }}>
              {EMPTY_TEXT[filter]}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((d) => {
              const open = d.status === 'OPEN' && !d.deadline_passed
              const overdue = open && (d.days_remaining ?? 99) <= 0
              return (
                <div key={d.case_id} role="button" tabIndex={0} onClick={() => onRespond(d)}
                     onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRespond(d) } }}
                     className="w-full text-left flex items-center gap-4 transition-shadow hover:shadow-md cursor-pointer"
                     style={{
                       background: '#fff', border: '1px solid var(--n-200)',
                       borderLeft: `4px solid ${!open ? 'var(--success)' : overdue ? 'var(--error)' : 'var(--navy-900)'}`,
                       borderRadius: 14, padding: '16px 18px',
                       boxShadow: '0 1px 2px rgba(10,31,61,.05), 0 1px 1px rgba(10,31,61,.03)',
                     }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                       style={{ background: open ? 'var(--info-bg)' : 'var(--success-bg)' }}>
                    <Icon name={open ? 'doc' : 'check'} size={18} style={{ color: open ? 'var(--navy-900)' : 'var(--success)' }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-[13.5px]" style={{ color: 'var(--navy-900)' }}>Case #{d.case_id} — Claim {d.claim_number}</span>
                    </div>
                    <div className="text-[12.5px] truncate" style={{ color: 'var(--n-600)' }}>
                      {d.claim?.service_description || 'Claim under review'}
                    </div>
                    <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--n-500)' }}>
                      Documents requested
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    {open ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold whitespace-nowrap"
                              style={{
                                background: overdue ? 'var(--error-bg)' : 'var(--n-100)',
                                color: overdue ? 'var(--error-tx)' : 'var(--n-600)',
                              }}>
                          <Icon name="clock" size={11} />
                          {overdue ? 'Overdue' : d.days_remaining != null ? `${d.days_remaining}d left` : 'Due soon'}
                        </span>
                        {/* Jumps straight into the expanded Upload Docs form —
                            unlike clicking the rest of the card, which opens
                            the detail view with the form collapsed. */}
                        <button onClick={(e) => { e.stopPropagation(); onRespond(d, { openForm: true }) }}
                                className="inline-flex items-center gap-1.5 text-[12px] font-bold px-3.5 py-2 rounded-lg whitespace-nowrap hover:brightness-110 transition-all"
                                style={{ background: 'var(--navy-900)', color: '#fff' }}>
                          Upload docs
                          <Icon name="download" size={12} style={{ color: '#fff' }} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold whitespace-nowrap"
                              style={{ background: 'var(--success-bg)', color: 'var(--success-tx)' }}>
                          <Icon name="check" size={11} />
                          Responded
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-bold px-3.5 py-2 rounded-lg whitespace-nowrap"
                              style={{ background: '#fff', color: 'var(--navy-900)', border: '1px solid var(--n-300)' }}>
                          View case →
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DisputeDetailScreen({
  dispute,
  initialShowForm = false,
  responseType,
  setResponseType,
  vendorResponseText,
  setVendorResponseText,
  docFiles,
  setDocFiles,
  submitting,
  submitResult,
  submitError,
  onSubmit,
  onViewDisputes,
}) {
  // Response form starts collapsed behind an "Upload Docs" button — unless the
  // vendor arrived via a row's "Upload docs" CTA (initialShowForm), which jumps
  // straight into the form. Re-syncs whenever the case changes.
  const [showForm, setShowForm] = useState(initialShowForm)
  useEffect(() => { setShowForm(initialShowForm) }, [dispute?.case_id, initialShowForm])

  if (!dispute) return <div className="px-7 py-8 text-slate-400">No dispute selected.</div>

  const canRespond = dispute.status === 'OPEN' && !dispute.deadline_passed

  // Confirmation banner once the vendor has uploaded docs — this session's
  // submit, or docs already on file when the case was opened. The vendor is
  // never told the physician's verdict; only that their docs are in.
  const submitted = submitResult || (dispute.vendor_responded_at && dispute.status !== 'OPEN')
  const submittedInfo = submitted
    ? { title: 'Documents submitted', sub: 'Your documents are under review. No further action is needed from you.' }
    : null

  return (
    <div className="px-4 sm:px-7 py-5 space-y-5">
      {/* Dispute info card */}
      <div className="mc-card p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Case #{dispute.case_id} — Claim {dispute.claim_number}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <DisputeStatusBadge status={dispute.status} />
            </div>
          </div>
          <DisputeCountdown dispute={dispute} />
        </div>

      </div>

      {/* Claim details — same info the vendor sees for any claim in My Claims, so
          they can actually recognize which order/patient/service this is about. */}
      {dispute.claim && (
        <div className="mc-card flex flex-col lg:max-h-[520px]" style={{ padding: '22px 24px' }}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-[18px] flex-shrink-0" style={{ color: 'var(--n-500)' }}>Claim Details</h3>
          <div className="overflow-y-auto flex-1 min-h-0">
            {(() => {
              // No physician identity here — the vendor never sees who flagged
              // the claim or why. Only the claim itself.
              const fields = [
                ['Patient',           dispute.claim.patient_name_partial || '—'],
                ['Service',           dispute.claim.service_description || '—'],
                ['HCPCS Codes',       Array.isArray(dispute.claim.hcpcs_codes) ? (dispute.claim.hcpcs_codes.join(', ') || '—') : (dispute.claim.hcpcs_codes || '—')],
                ['Date of Service',   dispute.claim.dos_from || dispute.claim.dos_to ? `${fmtDate(dispute.claim.dos_from)} — ${fmtDate(dispute.claim.dos_to)}` : '—'],
                ['Amount Billed',     fmtUSD(dispute.claim.amount_billed)],
                ['Amount Paid',       fmtUSD(dispute.claim.amount_paid)],
              ]
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2" style={{ columnGap: 24 }}>
                  {fields.map(([label, value], i) => (
                    <div key={label} className="py-3" style={{ borderBottom: i < fields.length - 2 ? '1px solid var(--n-100)' : 'none' }}>
                      <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--n-400)' }}>{label}</div>
                      <div className="text-[14px] font-semibold" style={{ color: 'var(--navy-900)' }}>{value}</div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Submitted confirmation (this session, or docs already on file) */}
      {submittedInfo && (
        <div className="mc-card p-6 flex items-center gap-4 flex-wrap" style={{ background: 'linear-gradient(180deg, var(--success-bg), #fff 65%)', border: 'none' }}>
          <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: 44, height: 44, background: 'var(--success)' }}>
            <Icon name="check" size={20} style={{ color: '#fff' }} />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-[15px]" style={{ color: 'var(--success-tx)' }}>{submittedInfo.title}</div>
            <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--success-tx)' }}>{submittedInfo.sub}</div>
          </div>
          <button onClick={onViewDisputes} className="ml-auto text-[12.5px] font-semibold whitespace-nowrap" style={{ color: 'var(--slate-blue)' }}>
            View all →
          </button>
        </div>
      )}

      {/* Upload form — collapsed behind a button until the vendor is ready */}
      {canRespond && !submitResult && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mc-card p-5 w-full flex items-center justify-between gap-3 text-left hover:border-[#3E5F94]/40 transition-colors"
        >
          <span className="text-[14px] font-bold text-slate-900">Upload Docs</span>
          <span className="gbtn gbtn-primary gbtn-sm shrink-0">Upload →</span>
        </button>
      )}

      {canRespond && !submitResult && showForm && (
        <div className="mc-card p-5 space-y-4">
          <h3 className="text-[14px] font-bold text-slate-900">Upload Docs</h3>
          <p className="text-[12px] text-slate-500 -mt-2">
            Attach the proof-of-work documents for this claim. They will be reviewed once submitted.
          </p>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Notes
            </label>
            <textarea
              value={vendorResponseText}
              onChange={(e) => setVendorResponseText(e.target.value)}
              rows={3}
              placeholder="Describe any actions taken or provide reference numbers…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-[#3E5F94]/40 focus:ring-2 focus:ring-[#3E5F94]/10 transition resize-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Supporting Documents
            </label>
            <label className="flex items-center justify-center gap-2 w-full px-3 py-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-[#3E5F94]/40 text-[12px] text-slate-500 cursor-pointer transition-colors">
              <Icon name="doc" size={14} />
              Attach PDF, JPEG, or PNG proof (max 10MB each)
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                multiple
                className="hidden"
                onChange={(e) => setDocFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
              />
            </label>
            {docFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {docFiles.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-[11px] font-medium text-slate-700">
                    {f.name} <span className="text-slate-400">({fmtFileSize(f.size)})</span>
                    <button onClick={() => setDocFiles((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-[var(--navy-900)] transition-colors" aria-label={`Remove ${f.name}`}>
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-3" style={{ background: 'var(--error-bg)', boxShadow: 'inset 0 0 0 1px #EBD3D1' }}>
              <Icon name="alertTri" size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--error-tx)' }} />
              <span className="text-[12px]" style={{ color: 'var(--error-tx)' }}>{submitError}</span>
            </div>
          )}

          <button
            onClick={onSubmit}
            disabled={submitting}
            className="gbtn gbtn-primary gbtn-lg w-full"
          >
            {submitting ? <><Spinner />Submitting…</> : 'Submit Documents'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Notification bell + dropdown panel ──────────────────────────────────────
// No category tabs and no fraud-vs-dispute icon split — the vendor is never
// told WHY a case needs docs, only that something on their cases changed.
// Icon/tone per notification kind (backend's `kind` field): docs requested =
// info blue, own submission / approved = success green, declined = warning
// amber, response window expired = error red.
const NOTIF_KIND_STYLE = {
  requested: { icon: 'doc',    bg: 'var(--info-bg)',    color: 'var(--info)' },
  responded: { icon: 'check',  bg: 'var(--success-bg)', color: 'var(--success)' },
  approved:  { icon: 'check',  bg: 'var(--success-bg)', color: 'var(--success)' },
  declined:  { icon: 'alerts', bg: 'var(--warning-bg)', color: 'var(--warning-tx)' },
  overdue:   { icon: 'clock',  bg: 'var(--error-bg)',   color: 'var(--error-tx)' },
}

function VendorNotifBell({ count, notifications, open, onToggle, onMarkRead, onSelect, marking, ringing }) {
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onToggle(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onToggle])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => onToggle(!open)} title="Notifications" className={`gicon-btn ${ringing ? 'ring' : ''}`}>
        <Icon name="alerts" size={16} />
        {count > 0 && <span className={`badge-dot ${ringing ? 'pop' : ''}`}>{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="np-panel">
          <div className="np-head">
            <div className="np-head-title"><span className="np-live-dot" />Notifications</div>
            <button onClick={onMarkRead} disabled={marking || count === 0} className="np-mark-read">Mark all read</button>
          </div>
          <div className="np-list">
            {notifications.length === 0 ? (
              <div className="np-empty">No notifications yet.</div>
            ) : notifications.map((n) => {
              const ks = NOTIF_KIND_STYLE[n.kind] || NOTIF_KIND_STYLE.requested
              return (
              <button key={n.id} onClick={() => onSelect(n)} className={`np-item ${!n.read ? 'unread' : ''} ${n._new ? 'new' : ''}`}>
                <div className="np-item-icon" style={{ background: ks.bg }}>
                  <Icon name={ks.icon} size={15} style={{ color: ks.color }} />
                </div>
                <div className="np-item-body">
                  <div className="np-item-top">
                    <span className="np-item-title">{n.title}</span>
                    <span className="np-item-time">{timeAgo(n.created_at)}</span>
                  </div>
                  <div className="np-item-desc">{n.description}</div>
                </div>
              </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main portal component ────────────────────────────────────────────────────
// ─── Vendor portal routing ───────────────────────────────────────────────────
// URL is the single source of truth for which screen shows (same pathname-parse
// approach as the payer portal). The /vendor/portal/* splat route already
// matches every sub-path, so no route wiring changes are needed.
const VENDOR_SCREEN_PATH = {
  dashboard: '/vendor/portal/dashboard',
  claims: '/vendor/portal/claims',
  actionRequired: '/vendor/portal/action-required',
}
function parseVendorRoute(location) {
  const q = new URLSearchParams(location.search)
  if (q.get('preview') === '1' && q.get('screen')) return { screen: q.get('screen'), preview: true }
  const rest = location.pathname.replace(/^\/vendor\/portal\/?/, '').replace(/\/+$/, '')
  const parts = rest.split('/')
  const seg = parts[0]
  switch (seg) {
    case '':
    case 'dashboard':       return { screen: 'dashboard' }
    case 'claims':          return { screen: 'claims' }
    case 'action-required': return { screen: 'actionRequired' }
    case 'disputes':        return parts.length > 1 ? { screen: 'disputeDetail', caseId: parts[1] } : { screen: 'dashboard' }
    default:                return { screen: 'dashboard' }
  }
}

export default function VendorPortalInner() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const route = parseVendorRoute(location)
  const screen = route.screen
  const [stats,         setStats]         = useState(null)
  const [claims,        setClaims]        = useState([])
  const [disputes,      setDisputes]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)

  // Bell badge — server-persisted (survives refresh/devices, unlike a client-only
  // counter): counts dispute-case events on this vendor's own cases, caused by
  // someone else (a physician disputing a claim, or confirming/rejecting your
  // response — never your own action), since you last clicked the bell. See
  // backend/routers/auth.py's /notifications/count for the exact query.
  const [notifCount, setNotifCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [notifOpen,     setNotifOpen]     = useState(false)
  const [notifMarking,  setNotifMarking]  = useState(false)
  const [notifRinging,  setNotifRinging]  = useState(false)

  useEffect(() => {
    getNotificationsCount().then(setNotifCount).catch(() => {})
    getVendorNotifications().then(setNotifications).catch(() => {})
  }, [])

  // Refetch the list (same /portal/notifications call) and diff against what's
  // already on screen so genuinely new arrivals get the slide-in + bell-ring —
  // not just "the count went up," but "here they are."
  function refreshNotifications() {
    getVendorNotifications().then((fresh) => {
      setNotifications((prev) => {
        const seenIds = new Set(prev.map((n) => n.id))
        const withNewFlag = fresh.map((n) => ({ ...n, _new: !seenIds.has(n.id) }))
        if (prev.length && withNewFlag.some((n) => n._new)) {
          setNotifRinging(true)
          setTimeout(() => setNotifRinging(false), 500)
          setTimeout(() => setNotifications((cur) => cur.map((n) => ({ ...n, _new: false }))), 800)
        }
        return withNewFlag
      })
    }).catch(() => {})
  }

  function markAllNotificationsRead() {
    setNotifMarking(true)
    markNotificationsSeen()
      .then(() => {
        setNotifCount(0)
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      })
      .catch(() => {})
      .finally(() => setNotifMarking(false))
  }

  // Opening the bell (not just the explicit "Mark all read" button inside it)
  // should clear the unread badge — mirrors clicking into an inbox.
  function toggleNotif(next) {
    setNotifOpen(next)
    if (next) markAllNotificationsRead()
  }

  function selectNotification(n) {
    setNotifOpen(false)
    if (!n.read) markAllNotificationsRead()
    const related = disputes.find((d) => d.case_id === n.case_id)
    if (related) selectDispute(related)
    else navTo('claims')
  }

  // URL-derived — the open case comes from /vendor/portal/disputes/:caseId, with
  // an in-session row hint in nav state so the detail paints without waiting on
  // the disputes list to (re)load.
  const selectedDispute = route.caseId
    ? (disputes.find((d) => String(d.case_id) === String(route.caseId)) || location.state?.dispute || null)
    : null
  // Whether the detail opens with the Upload Docs form expanded (row's "Upload
  // docs" button) vs collapsed (clicking the card) — carried in nav state.
  const detailOpenForm = !!location.state?.openForm

  const [statusFilter,  setStatusFilter]  = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return (p.get('preview') === '1' && p.get('status')) || 'ALL'
  })
  const [disputeStatusFilter, setDisputeStatusFilter] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return (p.get('preview') === '1' && p.get('disputeStatus')) || 'ALL'
  })
  const [claimSearch,   setClaimSearch]   = useState('')

  const [responseType,      setResponseType]      = useState(null)
  const [vendorResponseText, setVendorResponseText] = useState('')
  const [docFiles,          setDocFiles]          = useState([])
  const [submitting,        setSubmitting]        = useState(false)
  const [submitResult,      setSubmitResult]      = useState(null)
  const [submitError,       setSubmitError]       = useState(null)

  function navTo(s) {
    navigate(VENDOR_SCREEN_PATH[s] || '/vendor/portal/dashboard')
  }
  // Browser owns history now — back/forward, refresh and deep links all work
  // with no hand-rolled trail.
  function goBack() { navigate(-1) }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getVendorStats(), getVendorClaims(), getVendorDisputes()])
      .then(([s, c, d]) => {
        if (cancelled) return
        setStats(s)
        setClaims(c.claims || [])
        const fresh = d.disputes || []
        setDisputes(fresh)
        setError(null)
        // selectedDispute is URL-derived now (/vendor/portal/disputes/:caseId),
        // so a refresh restores the open case straight from the path — no
        // sessionStorage dance needed. The emailed ?case= deep link is handled
        // by the redirect effect below.
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Live push — a physician disputing a new claim, or confirming/rejecting a
  // resolution, refreshes stats/claims/disputes/bell-count immediately. No
  // client-side event filtering needed — the bell count query itself already
  // excludes the vendor's own actions (see auth.py), so refetching on every
  // event is safe even for the vendor's own just-submitted response.
  useEffect(() => {
    const es = subscribeDisputeStream('/api/v1/vendor/portal/alerts/stream', () => {
      getNotificationsCount().then(setNotifCount).catch(() => {})
      refreshNotifications()
      Promise.all([getVendorStats(), getVendorClaims(), getVendorDisputes()]).then(([s, c, d]) => {
        setStats(s)
        setClaims(c.claims || [])
        setDisputes(d.disputes || [])
        // selectedDispute re-resolves from the refreshed list automatically
        // (it's derived from the URL caseId); the stale-banner clearing on a
        // status change lives in its own effect below.
      }).catch(() => {})
    })
    return () => es.close()
  }, [])

  // Also refresh on entering the detail screen directly (e.g. a deep link) —
  // the live-push effect above only fires once mounted, so this covers the
  // gap between mount and the first SSE event. selectedDispute re-resolves from
  // the refreshed list via the URL caseId.
  useEffect(() => {
    if (screen !== 'disputeDetail') return
    let cancelled = false
    getVendorDisputes().then((d) => {
      if (!cancelled) setDisputes(d.disputes || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [screen])

  // Back-compat: an emailed notice deep-links to /vendor/portal?case=996 — send
  // it to the real case path so the URL-derived detail screen picks it up.
  useEffect(() => {
    const caseId = new URLSearchParams(location.search).get('case')
    if (caseId) navigate(`/vendor/portal/disputes/${caseId}`, { replace: true })
  }, [location.search])   // eslint-disable-line react-hooks/exhaustive-deps

  // Clear a stale "Response submitted" banner once the open case's status moves
  // on (e.g. the physician reopened it), so the response form reappears.
  const prevCaseStatusRef = useRef()
  useEffect(() => {
    const st = selectedDispute ? `${selectedDispute.case_id}:${selectedDispute.status}` : null
    if (prevCaseStatusRef.current && st && st !== prevCaseStatusRef.current) {
      setSubmitResult(null)
      setSubmitError(null)
    }
    prevCaseStatusRef.current = st
  }, [selectedDispute?.case_id, selectedDispute?.status])

  function selectDispute(d, { openForm = false } = {}) {
    // The vendor's only response is uploading docs — no response-type choice.
    // A fixed value is sent purely to satisfy the (now-ignored) API field.
    setResponseType('DOCS')
    setVendorResponseText('')
    setDocFiles([])
    setSubmitResult(null)
    setSubmitError(null)
    // openForm ("Upload docs") jumps straight into the upload form; clicking a
    // card elsewhere lands with it collapsed. `from` drives the active nav pill.
    navigate(`/vendor/portal/disputes/${d.case_id}`,
             { state: { dispute: d, openForm, from: screen === 'disputeDetail' ? 'claims' : screen } })
  }

  // Claims table rows jump straight to the dispute (no more intermediate
  // "Claim Detail" page) — only meaningful for a claim that actually has one;
  // a Pending/Confirmed claim with no dispute case has nowhere to go.
  function selectClaim(c) {
    const related = disputes.find((d) => d.claim_number === c.claim_number)
    if (related) selectDispute(related)
  }

  async function handleRespond(caseId) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await submitVendorResponse(caseId, responseType, vendorResponseText, docFiles)
      setSubmitResult(result)
      // Bump the case status in the list — selectedDispute is derived from it,
      // so the open detail reflects the new status automatically.
      setDisputes((prev) =>
        prev.map((d) => (d.case_id === caseId ? { ...d, status: result.status } : d))
      )
    } catch (err) {
      setSubmitError(err.message || 'Failed to submit response')
    } finally {
      setSubmitting(false)
    }
  }

  const supplierName = stats?.vendor_name || user?.full_name || 'Vendor Portal'

  // Readable label for the vendor's provider category.
  const VENDOR_TYPE_LABELS = {
    HOSPICE:     'Hospice Care',
    HOME_HEALTH: 'Home Health',
    DME:         'DME Vendor',
  }
  const vendorTypeLabel = stats?.vendor_type
    ? (VENDOR_TYPE_LABELS[stats.vendor_type] || stats.vendor_type)
    : null
  const vendorLocation = [stats?.vendor_city, stats?.vendor_state].filter(Boolean).join(', ')

  function downloadClaimsReport() {
    const esc = (v) => { const s = String(v ?? ''); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    // Type-blind status column: DISPUTED/FRAUD_REPORTED both export as
    // "Under review" — the vendor is never told why a claim is being reviewed.
    const csvStatus = (s) => s === 'CONFIRMED' ? 'Approved' : s === 'PENDING' ? 'Pending' : 'Under review'
    const headers = ['Claim #', 'Service', 'DOS', 'Billed', 'Status']
    const rows = claims.map((c) => [c.claim_number, c.service_description, c.dos_from, c.amount_billed, csvStatus(c.status)])
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'claims-report.csv' })
    a.click(); URL.revokeObjectURL(a.href)
  }

  // Quick-glance stats + actions for the "Provider profile panel" moodboard
  // recipe shown in the vendor's profile dropdown — real numbers already
  // fetched for the dashboard's own KPI row, just reused here.
  const profileStats = [
    { label: 'Claims / mo',   value: stats?.total_claims ?? 0 },
    { label: 'Open cases',    value: stats?.open_disputes ?? 0, tone: stats?.open_disputes ? 'warning' : undefined },
    { label: 'Overdue',       value: stats?.overdue_disputes ?? 0, tone: stats?.overdue_disputes ? 'error' : undefined },
  ]
  const profileActions = [
    { label: 'View My Claims', icon: 'doc', onClick: () => navTo('claims') },
  ]
  const profileContacts = [
    ...(stats?.contact_phone ? [{ icon: 'phone', href: `tel:${stats.contact_phone}`, title: stats.contact_phone }] : []),
    { icon: 'mail',     href: `mailto:${stats?.contact_email || user?.email}`, title: stats?.contact_email || user?.email },
    { icon: 'doc',      onClick: () => navTo('claims'),  title: 'View My Claims' },
    { icon: 'download', onClick: downloadClaimsReport,   title: 'Download Report' },
  ]
  const SCREEN_TITLES = {
    dashboard:      supplierName,
    claims:         'My Claims',
    actionRequired: 'Action Required',
    disputeDetail:  'Dispute Detail',
  }
  // The dispute-detail page is only ever reached by drilling into a case from
  // somewhere else (a claim row, the dashboard's "Respond now", or this new
  // Action Required queue) — never via its own nav destination — so the active
  // pill there should reflect wherever the vendor actually came from.
  const navActiveId = screen === 'disputeDetail' ? (location.state?.from || 'claims') : screen

  return (
    <Shell
      navItems={VENDOR_NAV}
      activeId={navActiveId}
      onNavigate={navTo}
      title={SCREEN_TITLES[screen] || 'Vendor Portal'}
      user={user}
      subtitle={vendorTypeLabel ? `${vendorTypeLabel} · ${vendorLocation || '—'}` : 'Vendor Portal'}
      profileStats={profileStats}
      profileActions={profileActions}
      profileContacts={profileContacts}
      layout="navbar"
      canGoBack={screen !== 'dashboard'}
      onBack={goBack}
      searchValue={claimSearch}
      onSearchChange={setClaimSearch}
      showNavbarSearch={screen === 'claims'}
      themeClass="vendor-theme"
      brandName={supplierName}
      bellSlot={
        <VendorNotifBell
          count={notifCount}
          notifications={notifications}
          open={notifOpen}
          onToggle={toggleNotif}
          onMarkRead={markAllNotificationsRead}
          marking={notifMarking}
          ringing={notifRinging}
          onSelect={selectNotification}
        />
      }
      onLogout={async () => { await logout(); navigate('/welcome', { replace: true }) }}
    >
      {screen === 'dashboard' && (
        <DashboardScreen
          stats={stats}
          claims={claims}
          disputes={disputes}
          loading={loading}
          error={error}
          onViewDisputes={() => navTo('claims')}
          onRespondDispute={selectDispute}
          onViewAllClaims={() => { setStatusFilter('ALL'); setDisputeStatusFilter('ALL'); navTo('claims') }}
          onViewConfirmed={() => { setStatusFilter('CONFIRMED'); setDisputeStatusFilter('ALL'); navTo('claims') }}
          onViewOpenDisputes={() => { setStatusFilter('ALL'); setDisputeStatusFilter('OPEN'); navTo('claims') }}
          onViewOverdue={() => { setStatusFilter('ALL'); setDisputeStatusFilter('NON_RESPONSIVE'); navTo('claims') }}
        />
      )}
      {screen === 'claims' && (
        <ClaimsScreen
          claims={claims}
          disputes={disputes}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          disputeStatusFilter={disputeStatusFilter}
          setDisputeStatusFilter={setDisputeStatusFilter}
          claimSearch={claimSearch}
          loading={loading}
          onSelectClaim={selectClaim}
        />
      )}
      {screen === 'actionRequired' && (
        <ActionRequiredScreen
          disputes={disputes}
          loading={loading}
          error={error}
          onRespond={selectDispute}
        />
      )}
      {screen === 'disputeDetail' && (
        <DisputeDetailScreen
          dispute={selectedDispute}
          initialShowForm={detailOpenForm}
          responseType={responseType}
          setResponseType={setResponseType}
          vendorResponseText={vendorResponseText}
          setVendorResponseText={setVendorResponseText}
          docFiles={docFiles}
          setDocFiles={setDocFiles}
          submitting={submitting}
          submitResult={submitResult}
          submitError={submitError}
          onSubmit={() => handleRespond(selectedDispute?.case_id)}
          onViewDisputes={() => navTo('claims')}
        />
      )}
    </Shell>
  )
}
