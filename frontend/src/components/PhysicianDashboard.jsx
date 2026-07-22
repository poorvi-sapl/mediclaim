import { useEffect, useRef, useState } from 'react'
import { FileText, CheckCircle2, Clock, Flag, User } from 'lucide-react'
import { getClaimsPage, getNpiWatchStats, API_BASE } from '../api'
import { fmtUSD } from './ui'
import { KpiCard } from './ui/kpi-card'

/* ─── KPI Card Hover Preview (iframe thumbnail) — same recipe as the
   payer/vendor dashboards' KPI cards: hovering a card after a short delay
   shows a scaled-down live preview of where clicking it would take you. ─── */
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

const NAVY = '#0A1F3D'
const SLATE_BLUE = '#5B84C4'
const SUCCESS = '#3A7D5C'
const WARNING = '#D1A85C'
const ERROR = '#A6453F'
const WARNING_TX = '#8A6A34'
const ERROR_TX = '#8A423D'
const N_500 = '#647089'
const N_400 = '#93A0B3'
const N_100 = '#F1F4F9'

const SLATE_BLUE_LIGHT = '#AFC3E8'

// Pill tone → the existing `.pill-*` classes from index.css (shared with the
// physician claims table's risk badges), so this reuses that recipe exactly
// rather than defining a parallel one.
const PILL_CLASS = { success: 'pill-low', warning: 'pill-medium', error: 'pill-critical', neutral: 'pill-medium' }

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// "Higher is better" tone (dispute resolution rate, confirmation rate) vs
// "lower is better" tone (unknown-patient rate) — same 3-tier language,
// opposite direction.
function toneForRate(val) {
  if (val == null) return { tag: 'No disputes yet', tone: 'neutral' }
  if (val >= 70) return { tag: 'Strong', tone: 'success' }
  if (val >= 40) return { tag: 'Fair', tone: 'warning' }
  return { tag: 'Needs focus', tone: 'error' }
}
function toneForRisk(val) {
  if (val == null) return { tag: 'No claims yet', tone: 'neutral' }
  if (val <= 5) return { tag: 'Low', tone: 'success' }
  if (val <= 15) return { tag: 'Watch', tone: 'warning' }
  return { tag: 'High', tone: 'error' }
}

// Bar color for the Review Velocity chart — same slate-blue/navy family as
// the KPI icons and welcome banner, so the chart reads as part of one theme.
function velocityBarColor(count, max, isPeak) {
  if (count === 0) return N_100
  if (isPeak) return NAVY
  return count / max < 0.4 ? SLATE_BLUE_LIGHT : SLATE_BLUE
}

// Top-row KPI cards use the shared `KpiCard` (./ui/kpi-card) — the same
// component the vendor and Vendor Watchlist dashboards render, so all three
// portals' KPI cards are pixel-identical rather than three near-duplicates.
const KPI_TONE_MAP = { info: 'primary', error: 'danger', neutral: 'default', success: 'success', warning: 'warning' }

// A single stat block in the "Review Spectrum" grid — big number, label, and
// a tone-colored pill underneath, four across with dividers between them.
function SpectrumStat({ value, label, tag, tone, isLast }) {
  return (
    <div className="flex-1 text-center min-w-0" style={{ padding: '0 16px', borderRight: isLast ? 'none' : `1px solid ${N_100}` }}>
      <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 30, color: NAVY }}>{value}</div>
      <div style={{ fontSize: 12.5, color: N_500, marginTop: 6 }}>{label}</div>
      <span className={`pill ${PILL_CLASS[tone] || 'pill-medium'} mt-2.5`}>{tag}</span>
    </div>
  )
}

function QueueItem({ claim, urgent, onReview }) {
  return (
    <div className="flex items-start gap-2 sm:gap-3" style={{ padding: '11px 0', borderBottom: `1px solid ${N_100}` }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: urgent ? ERROR : WARNING, flexShrink: 0, marginTop: 5 }} />
      <span className="hidden sm:inline-block" style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 12.5, width: 96, flexShrink: 0, lineHeight: '18px' }}>{claim.ccn}</span>
      <span className="min-w-0" style={{ flex: 1, fontSize: 12.5, lineHeight: '18px', color: N_500, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>
        <span className="sm:hidden font-mono font-semibold" style={{ color: NAVY, fontSize: 12.5 }}>{claim.ccn} · </span>
        {claim.description || '—'}
      </span>
      <span style={{ fontWeight: 700, fontSize: 13, lineHeight: '18px', width: 64, textAlign: 'right', flexShrink: 0 }}>{fmtUSD(claim.amount, 0)}</span>
      <button onClick={(e) => { e.stopPropagation(); onReview(claim) }}
              className="hover:brightness-95 active:scale-[0.97] transition-all"
              style={{ fontSize: 11.5, fontWeight: 700, color: SLATE_BLUE, whiteSpace: 'nowrap', background: 'rgba(91,132,196,0.12)', border: 'none', borderRadius: 7, padding: '5px 11px', cursor: 'pointer', flexShrink: 0 }}>
        Review →
      </button>
    </div>
  )
}

export default function PhysicianDashboard({ physician, summary, pendingCount, npi, onSelectClaim, setActiveScreen }) {
  // Same sessionStorage-intent handoff ClaimsTable already reads on mount
  // (physician_claims_intent) — lets a focus card land on My Claims pre-filtered.
  function goClaims(intent) {
    try { sessionStorage.setItem('physician_claims_intent', JSON.stringify(intent)) } catch { /* ignore */ }
    setActiveScreen?.('claims')
  }
  const [aggregate, setAggregate] = useState(null)       // NPI-wide confirmed/disputed/flagged/total counts
  const [oldestUnreviewed, setOldestUnreviewed] = useState([])
  const [queueCardPopped, setQueueCardPopped] = useState(false) // whole Oldest-Unreviewed card "popped" open
  const queueCardRef = useRef(null)
  const [disputeStats, setDisputeStats] = useState(null) // total/disputed/fraud_reported/open/resolved/needs_confirmation
  const [reviewsTrend, setReviewsTrend] = useState(null) // { weeks, week_start, counts } — real Action.created_at counts
  const [velocityHoverIdx, setVelocityHoverIdx] = useState(null) // Review velocity bar being hovered, for the floating tooltip

  useEffect(() => {
    let cancelled = false
    getClaimsPage(npi, { reviewed: 'all', pageSize: 1 }).then((res) => {
      if (!cancelled) setAggregate(res)
    }).catch(() => {})
    getClaimsPage(npi, { reviewed: 'unreviewed', pageSize: 50 }).then((res) => {
      if (cancelled) return
      // Belt-and-suspenders on top of the backend reviewed=false filter, mirroring
      // My Claims (ClaimsTable.jsx): a claim can carry a decided latest_action
      // (folded in from a ClaimNotification) while Claim.reviewed is still false —
      // an already-decided claim must not resurface in the "oldest unreviewed" queue.
      const items = res.items.filter((c) => !c.latestAction)
      const oldest = [...items].sort((a, b) => new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date))
      setOldestUnreviewed(oldest.slice(0, 15))
    }).catch(() => {})
    fetch(`${API_BASE}/analytics/physician/reviews-trend?npi=${npi}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setReviewsTrend(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [npi])

  useEffect(() => {
    let cancelled = false
    getNpiWatchStats().then((s) => { if (!cancelled) setDisputeStats(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Clicking anywhere outside the popped-open queue card settles it back down.
  useEffect(() => {
    if (!queueCardPopped) return
    function onDocMouseDown(e) {
      if (queueCardRef.current && !queueCardRef.current.contains(e.target)) setQueueCardPopped(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [queueCardPopped])

  const confirmationRate = aggregate && aggregate.totalCount > 0
    ? Math.round((aggregate.confirmedCount / aggregate.totalCount) * 100)
    : null

  const flaggedSuppliers = summary?.unknownSuppliers ?? 0

  // Real signals behind the Review Spectrum row — everything below is backed
  // by an actual query (physician/npi-watch/stats + the claims aggregate),
  // not fabricated to look computed.
  const disputeResolutionRate = disputeStats?.total > 0
    ? Math.round((disputeStats.resolved / disputeStats.total) * 100) : null
  const unknownPatientRate = aggregate?.totalCount > 0
    ? Math.round((aggregate.unknownCount / aggregate.totalCount) * 100) : null
  const fraudReported = disputeStats?.fraud_reported ?? 0
  const needsConfirmation = disputeStats?.needs_confirmation ?? 0

  const disputeResolutionTone = toneForRate(disputeResolutionRate)
  const unknownPatientTone = toneForRisk(unknownPatientRate)
  const fraudTone = fraudReported > 0 ? { tag: 'Reported', tone: 'warning' } : { tag: 'None filed', tone: 'success' }
  const confirmationTone = needsConfirmation > 0 ? { tag: 'Action needed', tone: 'warning' } : { tag: 'All clear', tone: 'success' }

  const velocityCounts = reviewsTrend?.counts ?? []
  const velocityMax = Math.max(1, ...velocityCounts)
  const velocityPeakIdx = velocityCounts.reduce((best, c, i) => (c > (velocityCounts[best] ?? -1) ? i : best), 0)
  function velocityWeekRange(startIso) {
    const start = new Date(`${startIso}T00:00:00`)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${fmt(start)} – ${fmt(end)}`
  }

  // The clickable top-row cards land on the claims screen (each with its own
  // filter intent, applied via sessionStorage rather than the URL) — one
  // shared preview URL is enough for the hover thumbnail.
  const _base = `${window.location.origin}/physician/claims?preview=1`
  const wrap = (tile) => IS_PREVIEW ? tile : <HoverPreview url={_base}>{tile}</HoverPreview>

  return (
    <div className="w-full h-full flex flex-col px-4 sm:px-8 py-3 gap-3 min-h-0 overflow-y-auto">

      {/* Welcome banner — deep navy settling into a richer slate-blue toward
          the right, a clear but controlled dark→light sweep that keeps enough
          depth for white text to stay legible, with a soft radial highlight
          layered behind the right edge for extra dimension. */}
      <div className="flex-shrink-0 relative overflow-hidden flex items-center justify-between gap-4"
           style={{ background: `linear-gradient(105deg, ${NAVY} 0%, #1E3A63 42%, #34568C 78%, #4A6EA5 100%)`, borderRadius: 20, padding: '22px 28px', minHeight: 115, color: '#fff' }}>
        <div className="absolute rounded-full" style={{ bottom: -70, right: -20, width: 220, height: 220, background: 'radial-gradient(circle, rgba(175,195,232,.22), transparent 70%)' }} />
        <div className="relative min-w-0">
          <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 22 }}>
            {greeting()}, {physician?.name || 'Doctor'}
          </div>
          <div style={{ fontSize: 13.5, color: '#C9D6EA', marginTop: 6, lineHeight: 1.5 }}>
            {pendingCount} claim{pendingCount === 1 ? '' : 's'} {pendingCount === 1 ? 'is' : 'are'} waiting on your review
            {flaggedSuppliers > 0 && (
              <> — {flaggedSuppliers} supplier{flaggedSuppliers === 1 ? '' : 's'} on your account {flaggedSuppliers === 1 ? 'has' : 'have'} been flagged for unusual billing.</>
            )}
            {flaggedSuppliers === 0 && '.'}
          </div>
        </div>
        <div className="relative flex-shrink-0 rounded-full flex items-center justify-center"
             style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.14)' }}>
          <User size={24} strokeWidth={2} color="rgba(255,255,255,0.85)" />
        </div>
      </div>

      {/* KPI row — uniform label+icon+value+progress-bar cards */}
      <div className="flex-shrink-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {wrap(
          <KpiCard icon={<Clock size={16} strokeWidth={2} />} label="Pending Review"
                   value={pendingCount}
                   sub="Claims awaiting your decision"
                   pct={aggregate?.totalCount ? (pendingCount / aggregate.totalCount) * 100 : 100}
                   tone={KPI_TONE_MAP.warning}
                   onClick={() => goClaims({ reviewed: 'unreviewed' })} />
        )}
        {wrap(
          <KpiCard icon={<FileText size={16} strokeWidth={2} />} label="Submitted This Month"
                   value={summary?.totalClaimsMonth ?? 0}
                   sub="New claims under your NPI"
                   pct={Math.min(100, (summary?.totalClaimsMonth ?? 0) * 10)}
                   tone={KPI_TONE_MAP.info}
                   onClick={() => goClaims({ reviewed: 'all' })} />
        )}
        {wrap(
          <KpiCard icon={<Flag size={16} strokeWidth={2} />} label="Flagged Suppliers"
                   value={flaggedSuppliers}
                   sub="Suppliers you've flagged"
                   pct={Math.min(100, flaggedSuppliers * 25)}
                   tone={KPI_TONE_MAP.error}
                   onClick={() => goClaims({ unknownOnly: true })} />
        )}
        {wrap(
          <KpiCard icon={<CheckCircle2 size={16} strokeWidth={2} />} label="Confirmation Rate"
                   value={confirmationRate != null ? `${confirmationRate}%` : '—'}
                   sub={`${aggregate?.totalCount ?? 0} claims reviewed`}
                   pct={confirmationRate ?? 0}
                   tone={KPI_TONE_MAP.success}
                   onClick={() => goClaims({ reviewed: 'all' })} />
        )}
      </div>

      {/* Left: Review Spectrum. Right: Oldest Unreviewed Claims. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
        <div className="mc-card flex flex-col min-h-0" style={{ padding: '18px 22px 20px', borderRadius: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Review Spectrum</div>
          <div style={{ fontSize: 12, color: N_500, margin: '2px 0 18px' }}>Your dispute effectiveness and claim risk signals, NPI-wide</div>
          <div className="flex flex-1 items-center">
            <SpectrumStat value={disputeResolutionRate != null ? `${disputeResolutionRate}%` : '—'}
                          label="Dispute Resolution Rate" tag={disputeResolutionTone.tag} tone={disputeResolutionTone.tone} />
            <SpectrumStat value={fraudReported} label="Fraud Reports Filed" tag={fraudTone.tag} tone={fraudTone.tone} />
            <SpectrumStat value={needsConfirmation} label="Needs Your Confirmation" tag={confirmationTone.tag} tone={confirmationTone.tone} />
            <SpectrumStat value={unknownPatientRate != null ? `${unknownPatientRate}%` : '—'}
                          label="Unknown Patient Rate" tag={unknownPatientTone.tag} tone={unknownPatientTone.tone} isLast />
          </div>
        </div>

        {/* Resting size is untouched — a single click pops this whole card
            into a centered overlay sized to comfortably fit 5-7 rows without
            internal scrolling; clicking the dimmed backdrop (or anywhere
            else on the page — see the outside-click effect above) settles
            it back to its resting size and position. */}
        {queueCardPopped && (
          <div className="fixed inset-0" style={{ background: 'rgba(10,31,61,0.35)', zIndex: 999 }} />
        )}
        <div ref={queueCardRef} onClick={() => { if (!queueCardPopped) setQueueCardPopped(true) }}
             className="mc-card flex flex-col min-h-0 overflow-hidden cursor-pointer"
             style={queueCardPopped ? {
               padding: '18px 26px 16px', borderRadius: 18,
               position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
               width: 'min(620px, 92vw)', height: 'min(540px, 85vh)',
               zIndex: 1000, boxShadow: '0 28px 72px rgba(10,31,61,.38)',
             } : {
               padding: '14px 22px 12px', borderRadius: 18,
             }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Oldest Unreviewed Claims</div>
          <div style={{ fontSize: 12, color: N_500, margin: '2px 0 6px' }}>Work through these first — sorted by how long they've been waiting</div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {oldestUnreviewed.length === 0 ? (
              <div style={{ fontSize: 12.5, color: N_400, padding: '8px 0' }}>Nothing waiting — you're all caught up.</div>
            ) : oldestUnreviewed.map((claim) => {
              const ageDays = claim.createdAt ? Math.floor((Date.now() - new Date(claim.createdAt).getTime()) / 86400000) : 0
              return <QueueItem key={claim.id} claim={claim} urgent={ageDays > 14} onReview={onSelectClaim} />
            })}
          </div>
        </div>
      </div>

      {/* Review Velocity (left, wider) + Review Outcomes (right) — two cards
          sharing the row that Review Velocity used to fill on its own. */}
      <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
      <div className="mc-card" style={{ padding: '16px 22px 18px', borderRadius: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Review Velocity</div>
        <div style={{ fontSize: 12, color: N_500, margin: '2px 0 12px' }}>Claims reviewed per week</div>
        <div style={{ height: 200, display: 'flex', alignItems: 'flex-end', gap: 14 }}>
          {!reviewsTrend ? (
            <div style={{ flex: 1, textAlign: 'center', fontSize: 12.5, color: N_400 }}>Loading…</div>
          ) : velocityCounts.map((count, i) => (
            <div key={i} style={{ flex: 1, position: 'relative', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}
                 onMouseEnter={() => setVelocityHoverIdx(i)}
                 onMouseLeave={() => setVelocityHoverIdx((cur) => (cur === i ? null : cur))}>
              {velocityHoverIdx === i && (
                <div style={{
                  position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8,
                  background: NAVY, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600,
                  whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10, boxShadow: '0 6px 16px rgba(10,31,61,.25)',
                }}>
                  {velocityWeekRange(reviewsTrend.week_start[i])}: {count} claim{count === 1 ? '' : 's'} reviewed
                  <div style={{
                    position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                    width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `5px solid ${NAVY}`,
                  }} />
                </div>
              )}
              <div style={{
                width: '42%', borderRadius: '6px 6px 0 0', cursor: 'default', transition: 'filter .1s ease',
                height: `${Math.max(4, (count / velocityMax) * 100)}%`,
                background: velocityBarColor(count, velocityMax, i === velocityPeakIdx),
                filter: velocityHoverIdx === i ? 'brightness(1.12)' : 'none',
              }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
          {(reviewsTrend?.weeks ?? Array(8).fill('')).map((label, i) => (
            <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: N_400 }}>{label}</span>
          ))}
        </div>
      </div>

      {/* Review Outcomes — how the physician's reviewed claims were decided,
          NPI-wide. Donut of the decision mix, real counts from the claims
          aggregate (+ fraud reports from the NPI-watch stats). Softer, cohesive
          palette (teal → coral) so it sits well next to the velocity chart. */}
      {(() => {
        const segments = [
          { label: 'Confirmed',       count: aggregate?.confirmedCount ?? 0, color: '#3E8E82' },
          { label: 'Disputed',        count: aggregate?.disputedCount ?? 0,  color: '#E1B866' },
          { label: 'Fraud reported',  count: fraudReported,                  color: '#C56B60' },
          { label: 'Flagged vendor',  count: aggregate?.flaggedCount ?? 0,   color: '#6E8FC7' },
          { label: 'Unknown patient', count: aggregate?.unknownCount ?? 0,   color: '#AEB8C7' },
        ]
        const decided = segments.reduce((s, x) => s + x.count, 0)
        // Donut arcs — circumference normalised to 100 so each dash = its %.
        let acc = 0
        const arcs = segments.filter((s) => s.count > 0).map((s) => {
          const pct = (s.count / decided) * 100
          const arc = { ...s, pct, offset: 25 - acc }
          acc += pct
          return arc
        })
        return (
          <div className="mc-card flex flex-col" style={{ padding: '16px 22px 18px', borderRadius: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Review Outcomes</div>
            <div style={{ fontSize: 12, color: N_500, margin: '2px 0 14px' }}>How you've decided reviewed claims</div>

            {!aggregate ? (
              <div style={{ fontSize: 12.5, color: N_400 }}>Loading…</div>
            ) : decided === 0 ? (
              <div style={{ fontSize: 12.5, color: N_400 }}>No decisions recorded yet — review a claim to get started.</div>
            ) : (
              <div className="flex-1 flex items-center gap-5">
                {/* Donut */}
                <div style={{ position: 'relative', flexShrink: 0, width: 132, height: 132 }}>
                  <svg viewBox="0 0 42 42" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                    <circle cx="21" cy="21" r="15.915" fill="none" stroke={N_100} strokeWidth="2.5" />
                    {arcs.map((a) => (
                      <circle key={a.label} cx="21" cy="21" r="15.915" fill="none"
                              stroke={a.color} strokeWidth="2.5"
                              strokeDasharray={`${a.pct} ${100 - a.pct}`} strokeDashoffset={a.offset} />
                    ))}
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 22, color: NAVY, lineHeight: 1 }}>{decided}</div>
                    <div style={{ fontSize: 10.5, color: N_500, marginTop: 2 }}>reviewed</div>
                  </div>
                </div>
                {/* Legend */}
                <div className="flex-1 min-w-0 flex flex-col justify-center" style={{ gap: 9 }}>
                  {segments.map((s) => (
                    <div key={s.label} className="flex items-center gap-2.5">
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                      <span className="flex-1 min-w-0 truncate" style={{ fontSize: 12.5, color: N_500 }}>{s.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{s.count}</span>
                      <span style={{ fontSize: 11, color: N_400, width: 34, textAlign: 'right' }}>{decided ? Math.round((s.count / decided) * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}
      </div>
    </div>
  )
}
