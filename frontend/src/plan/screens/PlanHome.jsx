import { useState, useEffect } from 'react'
import {
  getPlanSummary, getSuppliers, getPlanDisputes, getPlanNotifications,
  getNotificationsCount, subscribeDisputeStream, API_BASE,
} from '../../api'
import { Icon, fmtUSD } from '../../components/ui'

// ─── Command-deck dashboard ──────────────────────────────────────────────────
// Navy hero band with today's three priorities (overdue disputes / highest-risk
// NPI / repeat-offender supplier), then a 3-column deck: notifications + risk
// rings | dispute & activity feed + claims trend | top flagged suppliers.
// Every element is real data and clickable — no decorative telemetry.

function fmtShortUSD(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return fmtUSD(v)
}

// Server timestamps are naive UTC — pin them to UTC before rendering local time.
function feedTime(iso) {
  if (!iso) return ''
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)
  const d = new Date(hasTz ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const FEED_RAIL = { fraud: '#A6453F', dispute: '#5A9BC9', flag: '#D1A85C' }

// Small progress ring for the risk-band breakdown (pathLength=100 → dasharray
// is simply "pct 100").
function Ring({ pct, color }) {
  return (
    <svg viewBox="0 0 40 40" className="w-[34px] h-[34px] shrink-0">
      <circle cx="20" cy="20" r="16" fill="none" stroke="#F1F4F9" strokeWidth="5" />
      <circle cx="20" cy="20" r="16" fill="none" stroke={color} strokeWidth="5" pathLength="100"
              strokeDasharray={`${Math.max(0, Math.min(100, pct))} 100`} strokeLinecap="round"
              transform="rotate(-90 20 20)" />
    </svg>
  )
}

function HeroCard({ icon, iconTint, tag, tagTint, title, desc, go, onClick, loading }) {
  if (loading) return <div className="rounded-[14px] h-[150px] animate-pulse" style={{ background: 'rgba(255,255,255,.06)' }} />
  return (
    <button onClick={onClick}
            className="text-left rounded-[14px] px-[18px] py-4 cursor-pointer transition-colors border"
            style={{ background: 'rgba(255,255,255,.06)', borderColor: 'rgba(255,255,255,.1)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.06)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0" style={{ background: `${iconTint}40` }}>
          <Icon name={icon} size={16} style={{ color: iconTint }} />
        </div>
        <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-full whitespace-nowrap" style={{ background: `${tagTint}40`, color: tagTint }}>{tag}</span>
      </div>
      <div className="text-white font-bold text-[14px] mt-3 leading-snug">{title}</div>
      <div className="text-[11.5px] mt-1.5 leading-relaxed" style={{ color: '#A9BEDB' }}>{desc}</div>
      <div className="flex items-center gap-1 text-[11px] font-bold mt-3" style={{ color: '#9ED0EE' }}>
        {go}
        <Icon name="chevronRight" size={12} />
      </div>
    </button>
  )
}

export default function PlanHome({ setActiveScreen, onOpenNpi, onOpenSupplier, onOpenActivityFeed }) {
  const [summary, setSummary] = useState(null)   // { summary, npis }
  const [suppliers, setSuppliers] = useState([])
  const [disputes, setDisputes] = useState([])
  const [feed, setFeed] = useState([])
  const [unread, setUnread] = useState(0)
  const [riskDist, setRiskDist] = useState(null) // { high, mid, low }
  const [trend, setTrend] = useState(null)       // { months, total, flagged }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [hoverTrend, setHoverTrend] = useState(null)   // Claims trend bar hover — index of the hovered month
  const [hoverRing, setHoverRing] = useState(null)     // Risk-ring hover — band id ('high'|'medium'|'low') of the hovered ring

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      getPlanSummary(),
      getSuppliers(),
      getPlanDisputes('all'),
      getPlanNotifications(),
      getNotificationsCount(),
      fetch(`${API_BASE}/analytics/overview/risk-distribution`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`${API_BASE}/analytics/overview/claims-trend`, { credentials: 'include' }).then((r) => r.json()),
    ]).then(([sum, sup, dis, notif, count, risk, tr]) => {
      if (cancelled) return
      if (sum.status === 'fulfilled') setSummary(sum.value)
      else setError(sum.reason?.message || 'Failed to load dashboard')
      if (sup.status === 'fulfilled') setSuppliers(sup.value)
      if (dis.status === 'fulfilled') setDisputes(dis.value?.disputes || [])
      if (notif.status === 'fulfilled') setFeed(notif.value)
      if (count.status === 'fulfilled') setUnread(count.value)
      if (risk.status === 'fulfilled') setRiskDist(risk.value)
      if (tr.status === 'fulfilled') setTrend(tr.value)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // Live push — any dispute-case change refreshes the pieces that show it
  // (priority strip count, feed, unread badge).
  useEffect(() => {
    const es = subscribeDisputeStream('/plan/alerts/stream', (evt) => {
      if (evt.type === 'dispute_updated') {
        getPlanDisputes('all').then((d) => setDisputes(d?.disputes || [])).catch(() => {})
        getPlanNotifications().then(setFeed).catch(() => {})
        getNotificationsCount().then(setUnread).catch(() => {})
      }
    })
    return () => es.close()
  }, [])

  const s = summary?.summary || { totalNPIs: 0, totalClaims: 0 }
  const npis = summary?.npis || []

  // ── Priority strip derivations (all real) ──
  const overdue = disputes.filter((d) => d.status === 'NON_RESPONSIVE' || d.deadline_passed)
  const topNpi = npis.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0]
  const offender = suppliers.slice().sort((a, b) =>
    (b.distinctNPIs || 0) - (a.distinctNPIs || 0) || (b.physicianFlags || 0) - (a.physicianFlags || 0))[0]

  const topSuppliers = suppliers.slice().sort((a, b) => (b.physicianFlags || 0) - (a.physicianFlags || 0)).slice(0, 4)
  const TILE_GRADIENTS = [
    'linear-gradient(135deg,#B95951,#8A423D)',
    'linear-gradient(135deg,#D1A85C,#8A6A34)',
    'linear-gradient(135deg,#5B84C4,#0A1F3D)',
    'linear-gradient(135deg,#4E93B8,#2E6B8F)',
  ]

  const totalNpis = riskDist ? (riskDist.high || 0) + (riskDist.mid || 0) + (riskDist.low || 0) : 0
  // Same score thresholds as the backend's /analytics/overview/risk-distribution
  // bucketing, so the example names shown on hover match the ring's own count.
  const BAND_MATCH = {
    high:   (n) => (n.score || 0) > 70,
    medium: (n) => (n.score || 0) > 30 && (n.score || 0) <= 70,
    low:    (n) => (n.score || 0) <= 30,
  }
  const ringRows = [
    { name: 'High risk', color: '#A6453F', count: riskDist?.high || 0, band: 'high' },
    { name: 'Mid risk',  color: '#D1A85C', count: riskDist?.mid || 0,  band: 'medium' },
    { name: 'Low risk',  color: '#3A7D5C', count: riskDist?.low || 0,  band: 'low' },
  ].map((r) => ({
    ...r,
    examples: npis.filter(BAND_MATCH[r.band]).sort((a, b) => (b.score || 0) - (a.score || 0)),
  }))

  const trendData = (trend?.months || []).map((m, i) => ({
    month: m, total: trend.total?.[i] || 0, flagged: trend.flagged?.[i] || 0,
  }))
  const trendMax = Math.max(1, ...trendData.map((t) => t.total))
  const peakIdx = trendData.reduce((best, t, i) => (t.total > (trendData[best]?.total || 0) ? i : best), 0)

  return (
    <div className="w-full">

      {/* ── Hero: today's priorities ── */}
      <div className="relative overflow-hidden px-4 sm:px-7 pt-6 pb-14" style={{ background: '#0A1F3D' }}>
        {/* Soft blurred glow blobs behind the hero content */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="absolute rounded-full" style={{ width: 520, height: 520, top: -260, left: '-6%',  background: 'radial-gradient(circle, rgba(91,132,196,.45), transparent 65%)', filter: 'blur(70px)' }} />
          <div className="absolute rounded-full" style={{ width: 560, height: 560, top: -200, left: '38%',  background: 'radial-gradient(circle, rgba(120,170,230,.35), transparent 65%)', filter: 'blur(80px)' }} />
          <div className="absolute rounded-full" style={{ width: 480, height: 480, top: -180, right: '-8%', background: 'radial-gradient(circle, rgba(158,208,238,.30), transparent 65%)', filter: 'blur(75px)' }} />
        </div>
        <div className="relative">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-white text-[20px] font-bold" style={{ color: '#fff' }}>Fraud command center</h1>
            <p className="text-[12.5px] mt-1" style={{ color: '#8FA6C9' }}>What actually needs your attention right now</p>
          </div>
          <span className="text-[12px]" style={{ color: '#8FA6C9' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          <HeroCard loading={loading}
            icon="alertTri" iconTint={overdue.length ? '#F0A199' : '#8FD3AE'}
            tag={overdue.length ? 'Escalated to compliance' : 'All clear'} tagTint={overdue.length ? '#F0A199' : '#8FD3AE'}
            title={overdue.length
              ? `${overdue.length} overdue dispute${overdue.length !== 1 ? 's' : ''} — vendor non-responsive`
              : 'No overdue disputes'}
            desc={overdue.length
              ? `Past SLA with no vendor response. Includes ${overdue[0]?.vendor_name || '—'}${overdue.length > 1 ? `, ${overdue.length - 1} other${overdue.length > 2 ? 's' : ''}` : ''}.`
              : 'Every open dispute is still inside its vendor response window.'}
            go="View in NPI Disputes"
            onClick={() => setActiveScreen('disputes')} />
          <HeroCard loading={loading}
            icon="bolt" iconTint="#F0D19A"
            tag="Highest risk score" tagTint="#F0D19A"
            title={topNpi ? `${topNpi.name} — risk score ${topNpi.score}` : 'No NPIs monitored yet'}
            desc={topNpi
              ? `${topNpi.specialty || '—'}, ${topNpi.city || '—'} — ${topNpi.rulesFiredCount} fraud rules fired across ${(topNpi.totalClaims || 0).toLocaleString()} claims, ${fmtUSD(topNpi.totalAmount)} billed.`
              : 'Risk scores appear here once claims are ingested.'}
            go="Open NPI detail"
            onClick={() => topNpi && onOpenNpi?.(topNpi)} />
          <HeroCard loading={loading}
            icon="suppliers" iconTint="#9ED0EE"
            tag="Repeat offender" tagTint="#9ED0EE"
            title={offender ? offender.name : 'No vendors tracked yet'}
            desc={offender
              ? `Top vendor across ${offender.distinctNPIs} separately flagged NPIs — ${fmtShortUSD(offender.totalAmount)} combined billed.`
              : 'Vendors appear here once claims are ingested.'}
            go="Open vendor case"
            onClick={() => offender && onOpenSupplier?.(offender)} />
        </div>
        </div>
      </div>

      {/* ── Deck: overlaps the hero band ── */}
      <div className="px-4 sm:px-7 pb-8 -mt-10 relative">
        {error && (
          <div className="mc-card border-[#EBD3D1] bg-[#F7EBEA]/50 px-6 py-4 mb-4 text-sm">
            <span className="font-semibold text-[#A6453F]">Couldn't load dashboard:</span> <span className="text-slate-500">{error}</span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_300px] gap-4 items-start">

          {/* Left — notifications + risk rings */}
          <div className="bg-white border border-[#E1E6EE] rounded-2xl px-4 py-5 text-center"
               style={{ boxShadow: '0 1px 2px rgba(10,31,61,.05)' }}>
            <button onClick={() => onOpenActivityFeed?.()} className="w-full cursor-pointer group">
              <div className="w-10 h-10 rounded-full mx-auto mb-2.5 flex items-center justify-center bg-[#E9F0F6] group-hover:bg-[#DCE6F7] transition-colors">
                <Icon name="alerts" size={19} className="text-[#35607D]" />
              </div>
              {loading
                ? <div className="h-9 w-14 mx-auto rounded-lg bg-slate-100 animate-pulse" />
                : <div className="text-display font-extrabold text-[36px] leading-none text-[#0A1F3D]">{unread}</div>}
              <div className="text-[12px] text-[#647089] mt-1.5">Unread notification{unread !== 1 ? 's' : ''}</div>
            </button>
            <div className="flex flex-col gap-3.5 mt-4 text-left">
              {ringRows.map((r) => (
                <div key={r.name} className="relative"
                     onMouseEnter={() => setHoverRing(r.band)} onMouseLeave={() => setHoverRing((h) => (h === r.band ? null : h))}>
                  {hoverRing === r.band && r.count > 0 && (
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-10 pointer-events-none whitespace-nowrap rounded-lg px-2.5 py-2 text-white"
                         style={{ background: '#0A1F3D', boxShadow: '0 4px 12px rgba(10,31,61,.25)' }}>
                      <div className="text-[10.5px] font-bold mb-1">{r.name} — {r.count} NPI{r.count !== 1 ? 's' : ''}</div>
                      {r.examples.slice(0, 4).map((n) => (
                        <div key={n.npi} className="text-[10.5px] flex items-center justify-between gap-3">
                          <span className="truncate max-w-[150px]">{n.name}</span>
                          <span className="tabular-nums" style={{ color: '#8FA6C9' }}>{n.score}</span>
                        </div>
                      ))}
                      {r.count > 4 && <div className="text-[10px] mt-0.5" style={{ color: '#8FA6C9' }}>+{r.count - 4} more</div>}
                    </div>
                  )}
                  <button onClick={() => setActiveScreen('leaderboard', r.band)}
                          className="w-full flex items-center gap-3 cursor-pointer rounded-lg -mx-1 px-1 py-0.5 hover:bg-[#F7F9FC] transition-colors">
                    <Ring pct={totalNpis ? (r.count / totalNpis) * 100 : 0} color={r.color} />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-[#0A1F3D]">{r.name}</div>
                      <div className="text-[11px] text-[#647089]">{r.count} of {totalNpis}</div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Center — dispute & activity feed + claims trend */}
          <div className="bg-white border border-[#E1E6EE] rounded-2xl px-5 py-[18px]"
               style={{ boxShadow: '0 1px 2px rgba(10,31,61,.05)' }}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-bold text-slate-900">Dispute &amp; activity feed</h3>
              <button onClick={() => onOpenActivityFeed?.()} className="text-[11.5px] font-semibold text-[#0A1F3D] hover:underline cursor-pointer">
                View all
              </button>
            </div>
            {loading ? (
              <div className="space-y-3 mt-3">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-slate-50 animate-pulse" />)}
              </div>
            ) : feed.length === 0 ? (
              <p className="text-[12.5px] text-slate-400 py-6 text-center">No activity yet — physician actions and vendor responses land here.</p>
            ) : (
              <div>
                {feed.slice(0, 5).map((n) => (
                  <div key={n.id} className="flex gap-3 py-2.5 items-start">
                    <div className="w-[52px] text-[11px] text-[#93A0B3] shrink-0 pt-0.5 tabular-nums">{feedTime(n.created_at)}</div>
                    <div className="w-[2px] self-stretch rounded-full shrink-0" style={{ background: FEED_RAIL[n.category] || '#E1E6EE' }} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[#0A1F3D] leading-snug">{n.title}</div>
                      <div className="text-[11.5px] text-[#647089] mt-0.5 truncate">{n.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Claims trend & fraud rules hit — paired monthly bars */}
            <h3 className="text-[14px] font-bold text-slate-900 mt-4 mb-1.5">Claims trend &amp; fraud rules hit</h3>
            {loading || trendData.length === 0 ? (
              <div className="h-[150px] rounded-xl bg-slate-50 animate-pulse" />
            ) : (
              <>
                <div className="flex items-end gap-3.5 h-[150px] mt-1">
                  {trendData.map((t, i) => (
                    <div key={t.month} className="relative flex flex-col items-center gap-1.5 flex-1 min-w-0"
                         onMouseEnter={() => setHoverTrend(i)} onMouseLeave={() => setHoverTrend((h) => (h === i ? null : h))}>
                      {hoverTrend === i && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 pointer-events-none whitespace-nowrap rounded-lg px-2.5 py-1.5 text-white"
                             style={{ background: '#0A1F3D', boxShadow: '0 4px 12px rgba(10,31,61,.25)' }}>
                          <div className="text-[10.5px] font-bold">{t.month}</div>
                          <div className="text-[10px] flex items-center gap-1.5 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#0A1F3D', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.5)' }} />
                            {t.total.toLocaleString()} total claims
                          </div>
                          <div className="text-[10px] flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#A6453F' }} />
                            {t.flagged.toLocaleString()} fraud rules hit
                          </div>
                          {t.total > 0 && (
                            <div className="text-[10px] text-[#8FA6C9] mt-0.5">{Math.round((t.flagged / t.total) * 100)}% flag rate</div>
                          )}
                        </div>
                      )}
                      <div className="flex items-end gap-[3px] h-[120px] cursor-default">
                        <div className="w-[9px] rounded-t-[4px] transition-opacity" style={{ height: Math.max(3, Math.round((t.total / trendMax) * 120)), background: i === peakIdx ? '#0A1F3D' : '#E1E6EE', opacity: hoverTrend === null || hoverTrend === i ? 1 : 0.45 }} />
                        <div className="w-[9px] rounded-t-[4px] transition-opacity" style={{ height: Math.max(2, Math.round((t.flagged / trendMax) * 120)), background: '#A6453F', opacity: hoverTrend === null || hoverTrend === i ? 1 : 0.45 }} />
                      </div>
                      <span className="text-[10.5px]" style={{ color: hoverTrend === i ? '#0A1F3D' : '#647089', fontWeight: hoverTrend === i ? 700 : 400 }}>{t.month}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 mt-2 text-[11px] text-[#647089]">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] inline-block" style={{ background: '#0A1F3D' }} />Total claims</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] inline-block" style={{ background: '#A6453F' }} />Fraud rules hit</span>
                </div>
              </>
            )}
          </div>

          {/* Right — top flagged vendors + monitored count */}
          <div className="bg-white border border-[#E1E6EE] rounded-2xl px-5 py-[18px]"
               style={{ boxShadow: '0 1px 2px rgba(10,31,61,.05)' }}>
            <h3 className="text-[15px] font-bold text-slate-900">Top flagged vendors</h3>
            <div className="grid grid-cols-2 gap-2.5 mt-3.5">
              {(loading ? Array.from({ length: 4 }, (_, i) => null) : topSuppliers).map((sup, i) => sup === null ? (
                <div key={i} className="rounded-xl h-[88px] bg-slate-100 animate-pulse" />
              ) : (
                <button key={sup.id} onClick={() => onOpenSupplier?.(sup)}
                        className="rounded-xl p-3.5 h-[88px] flex flex-col justify-between text-left cursor-pointer transition-transform hover:-translate-y-0.5"
                        style={{ background: TILE_GRADIENTS[i % TILE_GRADIENTS.length] }}>
                  <div className="w-[26px] h-[26px] rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,.3)' }}>
                    <Icon name="suppliers" size={14} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold text-white leading-tight truncate">{sup.name}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,.8)' }}>
                      {sup.physicianFlags > 0 ? `${sup.physicianFlags} flag${sup.physicianFlags !== 1 ? 's' : ''}` : `${sup.distinctNPIs} NPI links`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <h3 className="text-[15px] font-bold text-slate-900 mt-5">Total NPIs monitored</h3>
            <div className="flex items-baseline gap-2.5 mt-2">
              {loading
                ? <div className="h-7 w-16 rounded-lg bg-slate-100 animate-pulse" />
                : <span className="text-display font-extrabold text-[26px] text-[#0A1F3D]">{s.totalNPIs}</span>}
            </div>
            <div className="text-[11.5px] text-[#647089] mt-1">{(s.totalClaims || 0).toLocaleString()} claims across the network</div>
            <button onClick={() => setActiveScreen('leaderboard')}
                    className="mt-3 text-[11.5px] font-semibold text-[#0A1F3D] hover:underline cursor-pointer">
              Open Physician Leaderboard →
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
