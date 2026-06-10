import { useState, useEffect, useRef } from 'react'
import { getNpiDetail, getNpiSummary, getSuppliers } from '../../api'
import { Icon, fmtUSD, fmtDate, timeAgo } from '../../components/ui'
import FraudPatternPanel from '../components/FraudPatternPanel'

// Single muted-blue category chip everywhere (no per-category colors).
const CATEGORY_CHIP = 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium'
const CATEGORY_CHIP_STYLE = { backgroundColor: '#EFF6FF', color: '#1E3A5F' }
const FLAG_LABELS = {
  OIG_HIT: 'OIG Hit', CROSS_NPI: 'Cross-NPI', VOLUME_SPIKE: 'Vol. Spike',
  GEO_ANOMALY: 'Geo Anomaly', NEW_SUPPLIER: 'New Supplier', DUPLICATE: 'Duplicate',
  IDENTITY_REUSE: 'Identity Reuse', HOSPICE_DURATION: 'Long Hospice',
  UPCODING: 'Upcoding', UNBUNDLING: 'Unbundling',
  DECEASED: 'Deceased', IMPOSSIBLE_DAY: 'Impossible Day', MODIFIER_ABUSE: 'Modifier Abuse',
  RAPID_CYCLING: 'Rapid Cycling', SUPPLIER_CONCENTRATION: 'Supplier Conc.',
}
// claim-row flag chip code → backend rule name (for the evidence modal)
const FLAG_TO_RULE = {
  OIG_HIT: 'oig_leie_hit', CROSS_NPI: 'cross_npi_supplier', VOLUME_SPIKE: 'volume_spike',
  GEO_ANOMALY: 'geographic_anomaly', NEW_SUPPLIER: 'new_high_value_supplier', DUPLICATE: 'duplicate_billing',
  IDENTITY_REUSE: 'identity_reuse', HOSPICE_DURATION: 'abnormal_hospice_duration',
  UPCODING: 'upcoding', UNBUNDLING: 'unbundling',
  DECEASED: 'deceased_patient', IMPOSSIBLE_DAY: 'impossible_day', MODIFIER_ABUSE: 'modifier_abuse',
  RAPID_CYCLING: 'rapid_cycling', SUPPLIER_CONCENTRATION: 'supplier_concentration',
}
// Patterns hidden from the NPI-detail UI only (scores are NOT recalculated — these
// rules still contributed their points). new_high_value_supplier is intentionally NOT here.
const HIDDEN_PATTERNS = ['upcoding', 'deceased_patient', 'modifier_abuse']
const HIDDEN_FLAGS = ['UPCODING', 'DECEASED', 'MODIFIER_ABUSE']
// Muted timeline dots; all action labels share one gray-700 tone (color cue is the dot only).
const ACTION_META = {
  confirmed: { label: 'Confirmed', dot: '#86EFAC' },
  disputed: { label: 'Disputed', dot: '#FCD34D' },
  flagged: { label: 'Flagged Supplier', dot: '#FCA5A5' },
  unknownPatient: { label: 'Unknown Patient', dot: '#D1D5DB' },
  deniedOrder: { label: 'Did Not Order', dot: '#FCA5A5' },
}

// Claims table sort (change). All columns sortable; default order = date desc.
const CLAIM_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'patient', label: 'Patient' },
  { key: 'description', label: 'Description', cls: 'hidden md:table-cell' },
  { key: 'category', label: 'Category' },
  { key: 'supplier', label: 'Supplier', cls: 'hidden lg:table-cell' },
  { key: 'amount', label: 'Amount', right: true },
  { key: 'flags', label: 'Flags' },
]
const claimMs = (d) => { const t = Date.parse(d); return Number.isNaN(t) ? 0 : t }
const CLAIM_COMPARATORS = {
  date: (a, b) => claimMs(a.date) - claimMs(b.date),
  patient: (a, b) => (a.patient || '').localeCompare(b.patient || ''),
  description: (a, b) => (a.description || '').localeCompare(b.description || ''),
  category: (a, b) => (a.category || '').localeCompare(b.category || ''),
  supplier: (a, b) => (a.supplier || '').localeCompare(b.supplier || ''),
  amount: (a, b) => (a.amount || 0) - (b.amount || 0),
  flags: (a, b) => (a.flags?.length || 0) - (b.flags?.length || 0),   // by flag-chip count per row
}

function ScoreRing({ score }) {
  const color = score > 80 ? '#e11d48' : score > 60 ? '#ea580c' : score > 30 ? '#d97706' : '#059669'
  const label = score > 80 ? 'CRITICAL' : score > 60 ? 'HIGH' : score > 30 ? 'MEDIUM' : 'LOW'
  const r = 36, circ = 2 * Math.PI * r, dash = (score / 100) * circ
  return (
    <svg width="100" height="100" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
      <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
              strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 48 48)" />
      <text x="48" y="45" textAnchor="middle" dominantBaseline="middle" fill="#0f172a" fontSize="20" fontWeight="700">{score}</text>
      <text x="48" y="62" textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="8" fontWeight="700" letterSpacing="0.08em">{label}</text>
    </svg>
  )
}

function fmtDueMonth(due) {
  if (!due) return null
  const s = String(due).trim()
  if (!s || s.toUpperCase() === 'TBD') return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function VRow({ label, tone, mark, text }) {
  const toneColor = { ok: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-rose-600', muted: 'text-slate-400' }[tone]
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm font-semibold flex items-center gap-1.5 ${toneColor}`}>
        <span className="tabular-nums">{mark}</span> {text}
      </span>
    </div>
  )
}

function VerificationStatus({ verification }) {
  // Pre-feature accounts (registered before CMS verification existed) have no record.
  if (!verification || Object.keys(verification).length === 0) {
    return (
      <div className="mc-card p-5 mt-6">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Verification Status</h2>
        <p className="text-sm text-slate-400 mt-2">Verification not run — pre-dates this feature.</p>
      </div>
    )
  }

  // Handle both key schemas: newer physician register uses cms_* keys; the original
  // CMS-verification register used order_referring / revalidation.
  const or = verification.cms_order_referring || verification.order_referring || {}
  const rv = verification.cms_revalidation || verification.revalidation || {}
  const orManual = or.manual_review === true || !!or.warning

  const due = fmtDueMonth(rv.due_date)
  const rvMap = {
    current:      { tone: 'ok',    mark: '✓', text: `Current${due ? ` (due: ${due})` : ''}` },
    due_soon:     { tone: 'warn',  mark: '⚠', text: `Due soon${due ? ` (due: ${due})` : ''}` },
    lapsed:       { tone: 'bad',   mark: '✗', text: `Lapsed${due ? ` (due: ${due})` : ''}` },
    tbd:          { tone: 'muted', mark: '—', text: 'TBD' },
    not_found:    { tone: 'muted', mark: '—', text: 'Not found' },
    check_failed: { tone: 'warn',  mark: '⚠', text: 'Check unavailable' },
  }
  const rvRow = rvMap[rv.status] || { tone: 'muted', mark: '—', text: 'Not found' }

  // Advisory license rows (DEA / State license): verified / pending review / not provided.
  function licenseRow(r) {
    if (!r || r.status === 'not_provided') return { tone: 'muted', mark: '—', text: 'Not provided' }
    if (r.valid === true && !r.manual_review) return { tone: 'ok', mark: '✓', text: 'Verified' }
    if (r.valid === false) return { tone: 'warn', mark: '⚠', text: 'Pending Review' }
    return { tone: 'warn', mark: '⚠', text: 'Pending Review' }
  }
  const dea = licenseRow(verification.dea)
  const lic = licenseRow(verification.state_license)
  const ptanV = verification.ptan || {}
  const ptanRow = ptanV.status === 'not_provided' || !ptanV.status
    ? { tone: 'muted', mark: '—', text: 'Not provided' }
    : { tone: 'warn', mark: '⚠', text: 'Self-reported, MAC verification pending' }

  return (
    <div className="mc-card p-5 mt-6">
      <h2 className="text-sm font-bold text-slate-900 mb-1">Verification Status</h2>
      <p className="text-[11px] text-slate-400 mb-3">CMS &amp; registry checks run at registration</p>
      <VRow label="NPPES" tone="ok" mark="✓" text="Verified" />
      <VRow label="OIG Exclusions" tone="ok" mark="✓" text="Clear" />
      <VRow label="Order &amp; Referring"
            tone={orManual ? 'warn' : 'ok'} mark={orManual ? '⚠' : '✓'}
            text={orManual ? 'Manual Review' : 'Eligible'} />
      <VRow label="Revalidation" tone={rvRow.tone} mark={rvRow.mark} text={rvRow.text} />
      <VRow label="DEA License" tone={dea.tone} mark={dea.mark} text={dea.text} />
      <VRow label="State License" tone={lic.tone} mark={lic.mark} text={lic.text} />
      <VRow label="PTAN" tone={ptanRow.tone} mark={ptanRow.mark} text={ptanRow.text} />
    </div>
  )
}

// Safety net: constrain the AI risk summary to at most two sentences. Title/abbrev
// periods (Dr., Inc., LLC…) are protected so they don't count as sentence breaks.
const twoSentences = (text) => {
  if (!text) return text
  const SENT = String.fromCharCode(1)   // sentinel that won't appear in real text
  const protectedText = text.replace(/(Dr|Mr|Mrs|Ms|Inc|LLC|Corp|Co|St|vs)\./g, '$1' + SENT)
  const sentences = protectedText.match(/[^.!?]+[.!?]+/g) || [protectedText]
  return sentences.slice(0, 2).join(' ').split(SENT).join('.').trim()
}

export default function NPIDetail({ npi: row, onBack, backLabel, onOpenSupplier }) {
  const [data, setData] = useState(null)
  const [summary, setSummary] = useState(null)
  const [sumSource, setSumSource] = useState(null)
  const [sumLoading, setSumLoading] = useState(false)
  const timelineRef = useRef(null)
  const scrollToTimeline = () => timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const [pattern, setPattern] = useState(null)      // open fraud-pattern modal { rule, label, claim? } | null
  const [activeNpi, setActiveNpi] = useState(null)  // physician opened from the Cross-NPI modal (in-place nav)
  const [claimSort, setClaimSort] = useState({ key: null, dir: null })   // null = default (date desc)
  const [claimFilter, setClaimFilter] = useState(null)   // UI flag code → claims table filter (e.g. OIG_HIT)
  const [claimWindow, setClaimWindow] = useState(null)   // { from, to, label } date-window filter (volume spike)
  const [claimSupplier, setClaimSupplier] = useState(null)   // supplier-name filter (new-supplier modal)
  const [highlightId, setHighlightId] = useState(null)   // claim row to scroll to / flash
  const claimsRef = useRef(null)

  // App navigated to a different NPI → drop any in-place override.
  useEffect(() => { setActiveNpi(null) }, [row])

  useEffect(() => {
    const target = activeNpi || row
    let cancelled = false
    setSummary(null); setSumSource(null); setClaimSort({ key: null, dir: null }); setClaimFilter(null); setClaimWindow(null); setClaimSupplier(null); setHighlightId(null); setPattern(null); setData(null)
    if (target?.npi) getNpiDetail(target.npi).then((d) => { if (!cancelled) setData(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [row, activeNpi])

  function onClaimSort(key) {
    setClaimSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }
  // Cross-NPI modal → open that physician's NPI detail (close modal, swap in place).
  function openNpi(p) {
    setPattern(null)
    setActiveNpi({ npi: p.npi, name: p.name })
    try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* ignore */ }
  }
  // Timeline supplier name → open that supplier's detail page (the action record has
  // only the name, so resolve it to the supplier row by name).
  async function openSupplier(name) {
    try {
      const list = await getSuppliers()
      const sup = list.find((s) => s.name === name) || list.find((s) => (s.name || '').toLowerCase() === (name || '').toLowerCase())
      onOpenSupplier?.(sup || { name })
    } catch { onOpenSupplier?.({ name }) }
  }
  // Modal "View all/spike claims" → close modal, filter the claims table (by flag or
  // by date window), scroll to it.
  function viewClaims({ flag, from, to, supplier, label } = {}) {
    setPattern(null)
    setHighlightId(null)
    setClaimFilter(flag || null)
    setClaimWindow(from ? { from, to, label } : null)
    setClaimSupplier(supplier || null)
    setTimeout(() => claimsRef.current?.scrollIntoView({ behavior: 'smooth' }), 60)
  }
  // Modal claim-description click → close modal, scroll to + flash that claim row.
  function highlightClaim(id) {
    setPattern(null)
    setClaimFilter(null); setClaimWindow(null)
    setHighlightId(id)
    setTimeout(() => {
      const el = document.getElementById(`claimrow-${id}`)
      ;(el || claimsRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    setTimeout(() => setHighlightId(null), 3200)
  }
  // Open the evidence modal for a pattern row (toggle if it's already open).
  function onPatternClick(r) {
    if (!r.rule) return
    setPattern((p) => (p?.rule === r.rule && !p.claim ? null : { rule: r.rule, label: r.label }))
  }
  // Open the evidence modal from a flag chip on a claim row, with that claim highlighted.
  function onFlagClick(claim, code) {
    const rule = FLAG_TO_RULE[code] || code
    setPattern({ rule, label: FLAG_LABELS[code] || code, claim })
  }

  async function genSummary(npiId) {
    setSumLoading(true)
    try {
      const r = await getNpiSummary(npiId)
      setSummary(twoSentences(r.summary)); setSumSource(r.source)
    } catch (e) {
      setSummary(`Couldn't generate a summary: ${e.message}`); setSumSource('error')
    } finally { setSumLoading(false) }
  }

  if (!row) return <div className="max-w-screen-xl mx-auto px-7 py-7 text-slate-500">No NPI selected.</div>
  const baseRow = activeNpi || row
  const npi = data || { ...baseRow, claims: [], actions: [], rulesFired: baseRow.rulesFired || [] }

  function renderPatterns() {
    const patterns = npi.rulesFired.filter((r) => !String(r.label).startsWith('Physician') && !HIDDEN_PATTERNS.includes(r.rule))
    if (patterns.length === 0) return <p className="text-xs text-slate-400">No fraud patterns detected — billing looks consistent.</p>
    return patterns.map((r, i) => {
      const selected = pattern?.rule === r.rule
      return (
        <button key={i} onClick={() => onPatternClick(r)} disabled={!r.rule}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors disabled:cursor-default border-l-[3px] ${selected ? 'bg-[#F0F4FF] border-[#1E3A5F]' : 'border-transparent hover:bg-slate-50'}`}>
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-rose-50 text-rose-500 ring-1 ring-inset ring-rose-100 flex items-center justify-center"><Icon name="alertTri" size={13} /></span>
          <div className="flex-1 text-sm font-semibold text-slate-700">{r.label}</div>
          <span className="text-[10px] font-bold text-rose-600 tabular-nums">+{r.points}</span>
          {r.rule && <span className="text-slate-300"><Icon name="leaderboard" size={13} /></span>}
        </button>
      )
    })
  }

  const sortedClaims = (() => {
    let arr = [...(npi.claims || [])]
    if (claimFilter) arr = arr.filter((c) => (c.flags || []).includes(claimFilter))
    else if (claimWindow) arr = arr.filter((c) => c.date >= claimWindow.from && c.date <= claimWindow.to)
    else if (claimSupplier) arr = arr.filter((c) => c.supplier === claimSupplier)
    if (claimSort.key && CLAIM_COMPARATORS[claimSort.key]) {
      arr.sort(CLAIM_COMPARATORS[claimSort.key])
      if (claimSort.dir === 'desc') arr.reverse()
    } else {
      arr.sort((a, b) => claimMs(b.date) - claimMs(a.date))   // default: most recent first
    }
    return arr
  })()

  return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-ink transition-colors mb-5">
        <span aria-hidden>←</span> {backLabel || 'Back to leaderboard'}
      </button>

      <div className="mc-card p-6 mb-6 flex flex-wrap gap-6 items-center">
        <div className="flex-1 min-w-0">
          <span className="label-eyebrow">NPI Investigation</span>
          <h1 className="text-display text-2xl font-bold text-slate-900 mt-1">{npi.name}</h1>
          <p className="text-sm text-slate-500 mt-1">{npi.specialty} · NPI {npi.npi} · {npi.city}, {npi.state}</p>
        </div>
        <ScoreRing score={npi.score} />
      </div>

      {/* AI risk summary */}
      <div className="mc-card p-5 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-ink/10 text-ink flex items-center justify-center"><Icon name="bolt" size={17} /></div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">AI Risk Summary</h2>
              <p className="text-[11px] text-slate-400">Plain-English explanation of this provider's risk</p>
            </div>
          </div>
          {!summary && (
            <button onClick={() => genSummary(npi.npi)} disabled={sumLoading} className="btn-navy disabled:opacity-60">
              {sumLoading ? 'Generating…' : 'Generate AI Summary'}
            </button>
          )}
          {summary && !sumLoading && (
            <button onClick={() => genSummary(npi.npi)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-50">Regenerate</button>
          )}
        </div>
        {sumLoading && <div className="mt-4 h-12 rounded-lg bg-slate-100 animate-pulse" />}
        {summary && !sumLoading && (
          <div className="mt-4">
            <p className="text-sm text-slate-700 leading-relaxed">{summary}</p>
            <div className="mt-2 text-[11px] text-slate-400">
              {sumSource === 'llm' ? '✦ Generated by GPT-4o, grounded in the rules that fired'
                : sumSource === 'error' ? 'Summary unavailable'
                : 'Rule-based summary (LLM unavailable)'}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Claims', value: (npi.totalClaims || 0).toLocaleString() },
          { label: 'Total Billed', value: fmtUSD(npi.totalAmount) },
        ].map((s) => (
          <div key={s.label} className="mc-card px-5 py-4">
            <div className="text-display text-2xl font-bold text-slate-900 tabular-nums">{s.value}</div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-1">{s.label}</div>
          </div>
        ))}
        {/* Physician Flags → jumps to the feedback timeline below */}
        <button onClick={scrollToTimeline}
                className="mc-card px-5 py-4 text-left w-full cursor-pointer transition hover:border-ink/30 hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="text-display text-2xl font-bold text-slate-900 tabular-nums">{npi.physicianFlags}</div>
            <span className="text-slate-300"><Icon name="leaderboard" size={14} /></span>
          </div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-1">Physician Flags</div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="mc-card p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-1">Fraud Patterns Detected</h2>
          <p className="text-[11px] text-slate-400 mb-4">Rules that fired on this provider's claims</p>
          <div className="space-y-2.5">{renderPatterns()}</div>
        </div>

        <div ref={timelineRef} className="lg:col-span-2 mc-card p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Physician Feedback Timeline</h2>
          {npi.actions.length === 0 ? (
            <p className="text-xs text-slate-400">No physician actions recorded.</p>
          ) : (
            <div className="space-y-3">
              {npi.actions.map((a) => {
                const meta = ACTION_META[a.action] ?? ACTION_META.confirmed
                return (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: meta.dot }} />
                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-[#374151]">{meta.label}</span>
                      {a.supplier && (
                        <span className="text-xs text-slate-500">· <button type="button" onClick={() => openSupplier(a.supplier)}
                              className="font-medium text-[#1E3A5F] hover:underline cursor-pointer">{a.supplier}</button></span>
                      )}
                      {a.patient && <span className="text-xs text-slate-500">· {a.patient}</span>}
                      <span className="text-[11px] text-slate-400 ml-auto">{timeAgo(a.ts)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div ref={claimsRef} className="mc-card overflow-hidden scroll-mt-20">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">Claims ({(claimFilter || claimWindow || claimSupplier) ? `${sortedClaims.length} of ${npi.claims.length}` : npi.claims.length})</h2>
          {(claimFilter || claimWindow || claimSupplier) && (
            <button onClick={() => { setClaimFilter(null); setClaimWindow(null); setClaimSupplier(null) }} className="text-[11px] font-semibold text-[#1E3A5F] hover:underline whitespace-nowrap">
              {claimSupplier || (claimWindow ? claimWindow.label : `${FLAG_LABELS[claimFilter] || claimFilter} flags`)} · Clear ✕
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                {CLAIM_COLUMNS.map((c) => {
                  const active = claimSort.key === c.key
                  return (
                    <th key={c.key} onClick={() => onClaimSort(c.key)}
                        className={`th cursor-pointer select-none group ${c.right ? 'text-right' : ''} ${c.cls || ''}`}>
                      <span className="inline-flex items-center gap-1 group-hover:text-[#1E3A5F] transition-colors">
                        {c.label}
                        {active
                          ? <span className="text-[#1E3A5F]">{claimSort.dir === 'asc' ? '↑' : '↓'}</span>
                          : <span className="text-[#D1D5DB] opacity-0 group-hover:opacity-100 transition-opacity">↕</span>}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedClaims.map((c) => (
                <tr key={c.id} id={`claimrow-${c.id}`}
                    className={`transition-colors ${c.id === highlightId ? 'bg-[#EFF6FF] ring-1 ring-inset ring-[#BFDBFE]' : 'hover:bg-slate-50'}`}>
                  <td className="td text-xs tabular-nums whitespace-nowrap">{fmtDate(c.date)}</td>
                  <td className="td text-sm font-medium text-slate-700">{c.patient}</td>
                  <td className="td hidden md:table-cell text-xs">{c.description}</td>
                  <td className="td"><span className={CATEGORY_CHIP} style={CATEGORY_CHIP_STYLE}>{c.category}</span></td>
                  <td className="td hidden lg:table-cell text-xs text-slate-500">{c.supplier}</td>
                  <td className="td text-right font-bold text-slate-800 tabular-nums">{fmtUSD(c.amount, 2)}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {(() => {
                        const shown = (c.flags || []).filter((f) => !HIDDEN_FLAGS.includes(f))
                        return shown.length === 0 ? <span className="text-slate-300">—</span>
                        : shown.map((f) => (
                          <button key={f} onClick={() => onFlagClick(c, f)} title="Investigate this flag"
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-200 font-semibold hover:bg-rose-100 transition-colors">
                            {FLAG_LABELS[f] ?? f}
                          </button>
                        ))
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && <VerificationStatus verification={npi.verification} />}

      {pattern && (
        <FraudPatternPanel
          npi={npi.npi}
          rule={pattern.rule}
          label={pattern.label}
          focusClaim={pattern.claim}
          practice={{ city: npi.city, state: npi.state }}
          onClose={() => setPattern(null)}
          onOpenNpi={openNpi}
          onOpenSupplier={openSupplier}
          onViewClaims={viewClaims}
          onHighlightClaim={highlightClaim}
        />
      )}
    </div>
  )
}
