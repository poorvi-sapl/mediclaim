import { useState, useEffect, useRef } from 'react'
import { getNpiRiskList, getPlanDisputes, API_BASE } from '../../api'
import { RISK_FILTER_OPTIONS, bandByName, riskBand } from '../../lib/risk'
import TableSkeleton from '../../components/TableSkeleton'
import { fmtUSD, Icon } from '../../components/ui'
import { KpiCard } from '../../components/ui/kpi-card'

// ─── Greeting overview (one-page) ────────────────────────────────────────────
// Verbatim port of dashboard-ref4-greeting-overview.html onto the NPI
// Leaderboard slot: greeting row, hero + network stats, charts row, the
// physician activity table (rows click through to NPI detail, same as the old
// leaderboard), and the bottom Upcoming / Recent flags / Top rule triggers
// strip. Everything except "Upcoming" is backed by real queries — risk list,
// dispute cases, and the claims-trend analytics endpoint.

const NAVY = 'var(--color-primary)'
const SLATE_BLUE = 'var(--color-primary-tint)'
const CHART_BLUE = '#8FADD9'  // lighter blue for the ring gauges + "Flagged" bars, easier on the eye than SLATE_BLUE at this size
const N_600 = '#46586F'
const N_500 = 'var(--color-text-body)'
const N_400 = 'var(--color-text-muted)'
const N_300 = 'var(--color-border-strong)'
const N_100 = 'var(--color-bg-soft)'
const MONO = "'JetBrains Mono',monospace"
const DISPLAY = "'Manrope',sans-serif"                 // big numbers + greeting (matches Physician dashboard)
const HEADING = "'Inter Tight','Inter',sans-serif"     // card/section titles (matches Physician dashboard)

const RESOLVED_STATUSES = ['RESPONDED_TO_MEDICARE', 'RESOLVED_BY_PHYSICIAN', 'CLOSED', 'REFERRED_OIG']

function fmtShortUSD(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return fmtUSD(v)
}

// Was its own 3-tier scheme (Critical >80, High >65, everything else "Clean").
// Now the product's four bands, so a 55-score physician reads Medium here and
// Medium everywhere else instead of "Clean" here and "Medium" on their detail page.
function statusOf(score) {
  const b = riskBand(score)
  return { label: b.label, bg: b.soft, tx: b.text }
}

// Status/Specialty column headers — click opens a dropdown to filter the
// physician activity table, same interaction as the Risk/OIG column headers
// on Vendor Watchlist (FilterTh). Generic so both columns share it.
const STATUS_FILTER_OPTIONS = RISK_FILTER_OPTIONS
// Glass-gradient badge recipe — same tokens as the NPI Disputes table's
// Type/Status badges (solid/warning/success), applied to the risk-tier pill.
const statusBadgeStyle = (label) => bandByName(label).badge
function DropdownFilterTh({ label, options, value, onChange, hide }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = !!value

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <th ref={ref} className={`text-left py-2 px-2.5 text-[10px] font-bold uppercase tracking-[0.04em] whitespace-nowrap relative ${hide ? `hidden ${hide}:table-cell` : ''}`}
        style={{ color: active || open ? NAVY : N_500, background: 'var(--color-bg-soft)', borderBottom: `1px solid ${N_100}` }}>
      <button onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 cursor-pointer" style={{ color: 'inherit', font: 'inherit' }}>
        {label}
        <Icon name="chevronDown" size={10} style={{ color: active || open ? NAVY : N_300, transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl border border-slate-200 z-40 min-w-[160px] max-h-[260px] overflow-y-auto normal-case"
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>
          <div className="py-1">
            {options.map((opt) => (
              <button key={opt.id} onMouseDown={() => { onChange(opt.id); setOpen(false) }}
                      className="w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 hover:bg-slate-50">
                <span className="truncate" style={{ color: value === opt.id ? NAVY : '#475569', fontWeight: value === opt.id ? 600 : 500 }}>{opt.label}</span>
                {value === opt.id && <Icon name="check" size={12} style={{ color: NAVY }} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </th>
  )
}

function Card({ children, className = '', style }) {
  return (
    <div className={`bg-white border border-[var(--color-border)] rounded-2xl px-[18px] py-4 ${className}`}
         style={{ boxShadow: '0 1px 2px rgba(10,31,61,.05), 0 1px 1px rgba(10,31,61,.03)', ...style }}>
      {children}
    </div>
  )
}

function CardHead({ title, sub, right }) {
  return (
    <div className="flex items-baseline justify-between mb-3 gap-3">
      <div>
        <h3 className="text-[15px] font-bold" style={{ fontFamily: HEADING, color: NAVY }}>{title}</h3>
        {sub && <span className="text-[11.5px]" style={{ color: N_500 }}>{sub}</span>}
      </div>
      {right}
    </div>
  )
}

// Shared full-circle ring gauge — same recipe for Recovery rate and Case
// review so both cards render identically, matching the reference (which uses
// one ring style for both instead of Case review's old semi-donut).
function RingChart({ pct, size = 96, stroke = 14, track = '#DCE6F7', arc = CHART_BLUE, textColor = NAVY }) {
  const r = 50 - stroke / 2
  return (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size, flexShrink: 0 }}>
      <circle cx="50" cy="50" r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle cx="50" cy="50" r={r} fill="none" stroke={arc} strokeWidth={stroke} pathLength="100"
              strokeDasharray={`${pct} 100`} strokeLinecap="round" transform="rotate(-90 50 50)" />
      <text x="50" y="57" textAnchor="middle" fontFamily="Manrope" fontWeight="800" fontSize="20" fill={textColor}>{pct}%</text>
    </svg>
  )
}

export default function NPILeaderboard({ setSelectedNPI, setActiveScreen, initialBand = 'all', search = '' }) {
  const [rows, setRows] = useState([])
  const [disputes, setDisputes] = useState([])
  const [trend, setTrend] = useState(null)      // { months, total, flagged }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')   // '' | Critical | High | Clean — Status column-header dropdown
  const [specialtyFilter, setSpecialtyFilter] = useState('')   // '' | <specialty> — Specialty column-header dropdown
  const [hoverMonth, setHoverMonth] = useState(null)   // Claims report bar hover — index of the hovered month

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      getNpiRiskList({}),
      getPlanDisputes('all'),
      fetch(`${API_BASE}/analytics/overview/claims-trend`, { credentials: 'include' }).then((r) => r.json()),
    ]).then(([r, d, t]) => {
      if (cancelled) return
      if (r.status === 'fulfilled') setRows(r.value)
      else setError(r.reason?.message || 'Failed to load physicians')
      if (d.status === 'fulfilled') setDisputes(d.value?.disputes || [])
      if (t.status === 'fulfilled') setTrend(t.value)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (error) return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-6">
      <div className="mc-card border-[#EBD3D1] bg-[#F7EBEA]/50 px-6 py-5 text-sm">
        <span className="font-semibold text-[#A6453F]">Couldn't load the dashboard:</span>{' '}
        <span className="text-slate-500">{error}</span>
      </div>
    </div>
  )

  // ── Derivations (all from real data) ──
  const sorted = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0))
  const specialtyOptions = [{ id: '', label: 'All' }, ...[...new Set(rows.map((r) => r.specialty).filter(Boolean))].sort().map((s) => ({ id: s, label: s }))]
  const q = search.trim().toLowerCase()
  const tableRows = sorted
    .filter((r) => !q || r.name?.toLowerCase().includes(q) || r.npi?.includes(q) || r.specialty?.toLowerCase().includes(q))
    .filter((r) => !statusFilter || statusOf(r.score || 0).label === statusFilter)
    .filter((r) => !specialtyFilter || r.specialty === specialtyFilter)
  const highRisk = rows.filter((r) => riskBand(r.score).id === 'critical').length
  const totalClaims = rows.reduce((s, r) => s + (r.totalClaims || 0), 0)
  const totalBilled = rows.reduce((s, r) => s + (r.totalAmount || 0), 0)
  const openDisputes = disputes.filter((d) => ['OPEN', 'NON_RESPONSIVE', 'REFERRED_TO_PAYER'].includes(d.status))
  const resolvedDisputes = disputes.filter((d) => RESOLVED_STATUSES.includes(d.status))

  // Hero: billing disputed/reported across every case the payer has opened.
  const disputedBilled = disputes.reduce((s, d) => s + (d.claim?.amount_billed || 0), 0)

  // Recovery = resolved cases; "recovered" $ = billed on those resolved cases.
  const recoveryRate = disputes.length ? Math.round((resolvedDisputes.length / disputes.length) * 100) : 0
  const recoveredAmt = resolvedDisputes.reduce((s, d) => s + (d.claim?.amount_billed || 0), 0)

  // Claims report bars (reviewed vs flagged per month).
  const trendData = (trend?.months || []).map((m, i) => ({
    month: m, total: trend.total?.[i] || 0, flagged: trend.flagged?.[i] || 0,
  }))
  // Stacked bar scale, rounded up to a clean 5K step so the axis labels read
  // like a real chart (0/5K/10K/...) instead of an arbitrary max.
  const stackMax = Math.max(1, ...trendData.map((t) => t.total + t.flagged))
  const trendMax = Math.max(5000, Math.ceil(stackMax / 5000) * 5000)
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(trendMax * f))

  if (loading) return <div className="w-full px-4 sm:px-7 py-5 sm:py-6"><TableSkeleton rows={10} /></div>

  return (
    // Greeting moved to the top header ("Hey {name}") — the reclaimed vertical
    // space flows to the flex-1 physician table below, so more rows are visible
    // without scrolling.
    // pt-2, not pt-5: the breadcrumb header above already adds its own py-4, so a
    // 20px top pad here left ~36px of dead space before "Network statistics".
    <div className="w-full h-full flex flex-col min-h-0 px-4 sm:px-7 pt-2 pb-5 gap-3.5">

      {/* ── Row: hero + network statistics ──
          Heading sits above the whole row so the hero card and the KpiCards
          share one grid row — tops and bottoms align. */}
      <div className="flex-shrink-0">
        <div className="flex items-baseline justify-between mb-2 gap-3">
          <h3 className="text-[15px] font-bold" style={{ fontFamily: HEADING, color: NAVY }}>Network statistics</h3>
          <span className="flex items-center gap-1.5 text-[11px] shrink-0" style={{ color: N_500 }}>
            Live from claims data
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#3A9D6E' }} />
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-3.5">
        <div className="relative overflow-hidden rounded-[16px] px-[18px] py-4 flex flex-col"
             style={{ background: 'linear-gradient(135deg,#D8E4F3 0%,#E9F0F8 55%,#F3F7FB 100%)', border: '1px solid #DCE5F0' }}>
          {/* Decorative soft wave shapes */}
          <div className="absolute rounded-full" style={{ top: -60, right: -70, width: 190, height: 190, background: 'rgba(255,255,255,.55)' }} />
          <div className="absolute rounded-full" style={{ bottom: -80, right: -30, width: 170, height: 170, background: 'rgba(91,132,196,.10)' }} />
          <div className="relative z-[1] w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: '#C9DAF0' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
              <circle cx="12" cy="11" r="1" /><path d="M12 12v3" />
            </svg>
          </div>
          <div className="relative z-[1] font-extrabold text-[32px] mt-2.5 leading-none" style={{ fontFamily: DISPLAY, color: '#12233D', letterSpacing: '-0.02em' }}>
            {fmtShortUSD(disputedBilled)}
          </div>
          <p className="relative z-[1] text-[11.5px] mt-2 leading-snug" style={{ color: '#3D4C63' }}>
            Fraudulent billing challenged across your network to date.
          </p>
          <button onClick={() => setActiveScreen('disputes')}
                  className="relative z-[1] self-start mt-3 rounded-[9px] px-3.5 py-2 font-bold text-[11.5px] text-white cursor-pointer border-0 flex items-center gap-1.5"
                  style={{ background: '#13294B' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
            View fraud report
          </button>
        </div>

        {/* Network statistics — five KpiCards instead of the old divided strip, so
            these read the same as the vendor watchlist's and supplier detail's. */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
            <KpiCard size="sm" tone="default" label="Physicians" value={loading ? '…' : rows.length.toLocaleString()}
                     icon={<Icon name="users" size={15} />}
                     onClick={() => setStatusFilter('')} />
            <KpiCard size="sm" tone="danger" label="High-risk NPIs" value={loading ? '…' : highRisk}
                     sub={rows.length ? `${Math.round((highRisk / rows.length) * 100)}% of network` : undefined}
                     pct={rows.length ? (highRisk / rows.length) * 100 : 0}
                     icon={<Icon name="alertTri" size={15} />}
                     onClick={() => setStatusFilter('Critical')} />
            <KpiCard size="sm" tone="warning" label="Open disputes" value={loading ? '…' : openDisputes.length}
                     icon={<Icon name="message" size={15} />}
                     onClick={() => setActiveScreen('disputes')} />
            <KpiCard size="sm" tone="default" label="Total claims" value={loading ? '…' : totalClaims.toLocaleString()}
                     icon={<Icon name="claims" size={15} />} />
            <KpiCard size="sm" tone="success" label="Total billed" value={loading ? '…' : fmtShortUSD(totalBilled)}
                     sub={fmtUSD(totalBilled)}
                     icon={
                       <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                         <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                       </svg>
                     } />
          </div>
        </div>
      </div>

      {/* ── Row: claims report + recovery rate + case review ── */}
      <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] gap-3.5">
        <Card>
          <CardHead title="Claims report" sub={`Reviewed vs flagged, last ${trendData.length || 0} months`}
            right={
              <div className="flex items-center gap-3 shrink-0">
                <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: N_500 }}>
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#3A7D5C' }} />Reviewed
                </span>
                <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: N_500 }}>
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: CHART_BLUE }} />Flagged
                </span>
              </div>
            } />
          {trendData.length === 0 ? (
            <div className="h-[132px] flex items-center justify-center text-[12px]" style={{ color: N_400 }}>No trend data</div>
          ) : (
            <>
              <div className="flex mt-1" style={{ height: 132 }}>
                <div className="flex flex-col justify-between text-right pr-2 shrink-0" style={{ width: 32 }}>
                  {yTicks.map((v) => (
                    <span key={v} className="text-[10px] leading-none" style={{ color: N_400 }}>{v === 0 ? '0' : fmtShortUSD(v).replace('$', '')}</span>
                  ))}
                </div>
                <div className="relative flex-1 flex items-end gap-3">
                  {yTicks.map((v) => (
                    <div key={v} className="absolute left-0 right-0 border-t" style={{ bottom: `${(v / trendMax) * 100}%`, borderColor: N_100 }} />
                  ))}
                  {trendData.map((t, i) => (
                    <div key={t.month} className="relative flex-1 flex flex-col items-center min-w-0 h-full justify-end"
                         onMouseEnter={() => setHoverMonth(i)} onMouseLeave={() => setHoverMonth((h) => (h === i ? null : h))}>
                      {hoverMonth === i && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 pointer-events-none whitespace-nowrap rounded-lg px-2.5 py-1.5 text-white"
                             style={{ background: NAVY, boxShadow: '0 4px 12px rgba(10,31,61,.25)' }}>
                          <div className="text-[10.5px] font-bold">{t.month}</div>
                          <div className="text-[10px] flex items-center gap-1.5 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#3A7D5C' }} />
                            {t.total.toLocaleString()} reviewed
                          </div>
                          <div className="text-[10px] flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: CHART_BLUE }} />
                            {t.flagged.toLocaleString()} flagged
                          </div>
                        </div>
                      )}
                      <div className="flex flex-col items-center justify-end cursor-default" style={{ width: 28, height: '100%' }}>
                        <div className="w-full rounded-t-[3px] transition-opacity" style={{ height: `${Math.max(t.flagged ? 3 : 0, (t.flagged / trendMax) * 100)}%`, background: CHART_BLUE, opacity: hoverMonth === null || hoverMonth === i ? 1 : 0.45 }} />
                        <div className="w-full transition-opacity" style={{ height: `${Math.max(t.total ? 3 : 0, (t.total / trendMax) * 100)}%`, background: '#3A7D5C', opacity: hoverMonth === null || hoverMonth === i ? 1 : 0.45 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex mt-2">
                <div style={{ width: 32 }} className="shrink-0" />
                <div className="flex-1 flex gap-3">
                  {trendData.map((t, i) => (
                    <span key={t.month} className="flex-1 text-center text-[10.5px] whitespace-nowrap"
                          style={{ color: hoverMonth === i ? NAVY : N_500, fontWeight: hoverMonth === i ? 700 : 400 }}>
                      {String(t.month).split(' ')[0]}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Recovery rate" sub="Disputes resolved to date" />
          <div className="flex-1 flex items-center gap-5">
            <RingChart pct={recoveryRate} size={124} stroke={16} arc="#3A7D5C" track="#E9F3ED" />
            <div>
              <div className="font-extrabold text-[26px] leading-none" style={{ fontFamily: DISPLAY, color: NAVY }}>{fmtShortUSD(recoveredAmt)}</div>
              <div className="text-[12.5px] mt-2 leading-snug" style={{ color: N_500 }}>Resolved without escalation across {resolvedDisputes.length} case{resolvedDisputes.length !== 1 ? 's' : ''}.</div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Case review" sub="Open vs closed cases" />
          <div className="flex-1 flex items-center gap-5">
            <RingChart pct={recoveryRate} size={124} stroke={16} />
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-[26px] font-extrabold leading-none" style={{ fontFamily: DISPLAY, color: NAVY }}>{resolvedDisputes.length}</span>
                <span className="text-[12.5px]" style={{ color: N_500 }}>closed</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-[26px] font-extrabold leading-none" style={{ fontFamily: DISPLAY, color: NAVY }}>{openDisputes.length}</span>
                <span className="text-[12.5px]" style={{ color: N_500 }}>in progress</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Physician activity table (the leaderboard itself) — titled head
           row like the Vendor Watchlist's Vendors table ── */}
      <Card className="flex-1 min-h-0 flex flex-col !py-4">
        <div className="flex-shrink-0 flex items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="text-[15px] font-bold" style={{ fontFamily: HEADING, color: NAVY }}>Physicians</h3>
          </div>
          <button onClick={() => setActiveScreen('physicians')}
                  className="text-[11.5px] font-semibold hover:underline pt-0.5" style={{ color: SLATE_BLUE }}>
            View all →
          </button>
        </div>
        <PhysicianTable
          rows={tableRows}
          specialtyOptions={specialtyOptions}
          specialtyFilter={specialtyFilter} setSpecialtyFilter={setSpecialtyFilter}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          onOpen={(r) => { setSelectedNPI(r); setActiveScreen('detail') }}
        />
      </Card>

    </div>
  )
}

// The physician table itself — shared between the dashboard card above and the
// full-screen "All Physicians" view (AllPhysicians below), so columns/filters/
// badges never drift apart between the two.
function PhysicianTable({ rows, specialtyOptions, specialtyFilter, setSpecialtyFilter, statusFilter, setStatusFilter, onOpen }) {
  return (
    <div className="flex-1 min-h-0 overflow-auto -mx-[18px] px-[18px]">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="text-left py-2 px-2.5 text-[10px] font-bold uppercase tracking-[0.04em] whitespace-nowrap"
                style={{ color: N_500, background: 'var(--color-bg-soft)', borderBottom: `1px solid ${N_100}` }}>
              Physician
            </th>
            <DropdownFilterTh label="Specialty" options={specialtyOptions} value={specialtyFilter} onChange={setSpecialtyFilter} hide="md" />
            {['Claims', 'Billed'].map((h) => (
              <th key={h} className="text-left py-2 px-2.5 text-[10px] font-bold uppercase tracking-[0.04em] whitespace-nowrap text-right"
                  style={{ color: N_500, background: 'var(--color-bg-soft)', borderBottom: `1px solid ${N_100}` }}>
                {h}
              </th>
            ))}
            <th className="text-left py-2 px-2.5 text-[10px] font-bold uppercase tracking-[0.04em] whitespace-nowrap"
                style={{ color: N_500, background: 'var(--color-bg-soft)', borderBottom: `1px solid ${N_100}` }}>
              Flags
            </th>
            <DropdownFilterTh label="Status" options={STATUS_FILTER_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = statusOf(r.score || 0)
            return (
              <tr key={r.id} onClick={() => onOpen(r)}
                  className="cursor-pointer transition-colors hover:bg-[var(--color-bg-soft)]">
                <td className="py-2 px-2.5" style={{ borderBottom: `1px solid ${N_100}` }}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: NAVY }}>{r.name}</span>
                    {r.needsManualReview && (
                      <span title="Flagged for manual enrollment review" style={{ color: '#D1A85C' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-2.5 hidden md:table-cell" style={{ color: N_600, borderBottom: `1px solid ${N_100}` }}>{r.specialty || '—'}</td>
                <td className="py-2 px-2.5 text-right font-semibold tabular-nums" style={{ fontFamily: MONO, borderBottom: `1px solid ${N_100}` }}>{(r.totalClaims || 0).toLocaleString()}</td>
                <td className="py-2 px-2.5 text-right font-semibold tabular-nums" style={{ fontFamily: MONO, borderBottom: `1px solid ${N_100}` }}>{fmtUSD(r.totalAmount)}</td>
                <td className="py-2 px-2.5" style={{ borderBottom: `1px solid ${N_100}` }}>
                  {r.physicianFlags > 0
                    ? <span className="font-bold text-[11.5px]" style={{ color: '#8A423D' }}>↑ {r.physicianFlags}</span>
                    : <span style={{ color: N_300 }}>—</span>}
                </td>
                <td className="py-2 px-2.5" style={{ borderBottom: `1px solid ${N_100}` }}>
                  <span className="text-[10.5px] font-semibold px-2.5 py-[3px] rounded-full whitespace-nowrap" style={statusBadgeStyle(st.label)}>{st.label}</span>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="py-10 text-center text-[12.5px]" style={{ color: N_400 }}>No physicians match this search.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Full-screen "All Physicians" table — opened by the dashboard table's
// "View all →" link. Same columns/filters as the dashboard card, but the
// table is the whole screen. ───────────────────────────────────────────────
export function AllPhysicians({ setSelectedNPI, setActiveScreen, search = '' }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [specialtyFilter, setSpecialtyFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    getNpiRiskList({})
      .then((r) => { if (!cancelled) { setRows(r); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e?.message || 'Failed to load physicians'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  if (error) return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-6">
      <div className="mc-card border-[#EBD3D1] bg-[#F7EBEA]/50 px-6 py-5 text-sm">
        <span className="font-semibold text-[#A6453F]">Couldn't load physicians:</span>{' '}
        <span className="text-slate-500">{error}</span>
      </div>
    </div>
  )
  if (loading) return <div className="w-full px-4 sm:px-7 py-5 sm:py-6"><TableSkeleton rows={12} /></div>

  const sorted = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0))
  const specialtyOptions = [{ id: '', label: 'All' }, ...[...new Set(rows.map((r) => r.specialty).filter(Boolean))].sort().map((s) => ({ id: s, label: s }))]
  const q = search.trim().toLowerCase()
  const tableRows = sorted
    .filter((r) => !q || r.name?.toLowerCase().includes(q) || r.npi?.includes(q) || r.specialty?.toLowerCase().includes(q))
    .filter((r) => !statusFilter || statusOf(r.score || 0).label === statusFilter)
    .filter((r) => !specialtyFilter || r.specialty === specialtyFilter)

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-4 sm:px-7 pt-4 pb-5">
      <Card className="flex-1 min-h-0 flex flex-col !py-4">
        <div className="flex-shrink-0 flex items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="text-[15px] font-bold" style={{ fontFamily: HEADING, color: NAVY }}>All physicians</h3>
            <span className="text-[10.5px]" style={{ color: N_500 }}>
              {tableRows.length.toLocaleString()} of {rows.length.toLocaleString()} physicians, sorted by risk
            </span>
          </div>
          <button type="button" onClick={() => setActiveScreen('leaderboard')} title="Back to leaderboard"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#0A1F3D] transition-colors">
            <Icon name="x" size={13} stroke={2.5} /> Close
          </button>
        </div>
        <PhysicianTable
          rows={tableRows}
          specialtyOptions={specialtyOptions}
          specialtyFilter={specialtyFilter} setSpecialtyFilter={setSpecialtyFilter}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          onOpen={(r) => { setSelectedNPI(r); setActiveScreen('detail') }}
        />
      </Card>
    </div>
  )
}
