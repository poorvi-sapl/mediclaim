import { useState, useEffect, useRef } from 'react'
import { getNpiDetail, getNpiSummary, getSuppliers } from '../../api'
import { Icon, StatCard, fmtUSD, fmtDate, timeAgo } from '../../components/ui'
import FraudPatternPanel from '../components/FraudPatternPanel'

// Single muted-blue category chip everywhere (no per-category colors).
const CATEGORY_CHIP = 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap'
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
  { key: 'patient', label: 'Patient', cls: 'hidden sm:table-cell' },
  { key: 'description', label: 'Description', cls: 'hidden md:table-cell' },
  { key: 'category', label: 'Category', cls: 'hidden sm:table-cell' },
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
  const label = score > 80 ? 'Critical' : score > 60 ? 'High' : score > 30 ? 'Medium' : 'Low'
  const r = 30, circ = 2 * Math.PI * r, dash = (score / 100) * circ
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#f1f5f9" strokeWidth="5" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="5"
                strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                transform="rotate(-90 40 40)" opacity="0.6" />
        <text x="40" y="44" textAnchor="middle" dominantBaseline="middle"
              fill="#0f172a" fontSize="20" fontWeight="700">{score}</text>
      </svg>
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  )
}

function getSeverity(points) {
  if (points >= 35) return { label: 'CRITICAL', dot: '#fca5a5', bg: '#f8fafc', text: '#64748b', ring: '#e2e8f0' }
  if (points >= 25) return { label: 'HIGH',     dot: '#fdba74', bg: '#f8fafc', text: '#64748b', ring: '#e2e8f0' }
  if (points >= 15) return { label: 'MEDIUM',   dot: '#fcd34d', bg: '#f8fafc', text: '#64748b', ring: '#e2e8f0' }
  return               { label: 'LOW',      dot: '#6ee7b7', bg: '#f8fafc', text: '#94a3b8', ring: '#e2e8f0' }
}

function fmtDueMonth(due) {
  if (!due) return null
  const s = String(due).trim()
  if (!s || s.toUpperCase() === 'TBD') return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function VRow({ label, tone, text }) {
  const s = {
    ok:    { bg: 'bg-emerald-50', txt: 'text-emerald-700', border: 'border-emerald-200/80', dot: 'bg-emerald-400' },
    warn:  { bg: 'bg-amber-50',   txt: 'text-amber-700',   border: 'border-amber-200/80',   dot: 'bg-amber-400'  },
    bad:   { bg: 'bg-rose-50',    txt: 'text-rose-700',    border: 'border-rose-200/80',     dot: 'bg-rose-500'   },
    muted: { bg: 'bg-slate-50',   txt: 'text-slate-400',   border: 'border-slate-200/80',    dot: 'bg-slate-300'  },
  }[tone] || { bg: 'bg-slate-50', txt: 'text-slate-400', border: 'border-slate-200/80', dot: 'bg-slate-300' }
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
      <span className="text-[12px] sm:text-[13px] text-slate-600">{label}</span>
      <span className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-semibold border shrink-0 max-w-[180px] sm:max-w-none ${s.bg} ${s.txt} ${s.border}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
        <span className="truncate">{text}</span>
      </span>
    </div>
  )
}

function VerificationStatus({ verification }) {
  // Pre-feature accounts (registered before CMS verification existed) have no record.
  if (!verification || Object.keys(verification).length === 0) {
    return (
      <div className="mc-card overflow-hidden mt-4 sm:mt-6">
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100 flex items-center gap-2.5 sm:gap-3">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center shrink-0 ring-1 ring-slate-200">
            <Icon name="shield" size={14} stroke={2} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Verification Status</h2>
            <p className="text-[11px] text-slate-400 hidden sm:block">CMS &amp; registry checks run at registration</p>
          </div>
        </div>
        <p className="px-4 sm:px-5 py-4 text-sm text-slate-400">Verification not run — pre-dates this feature.</p>
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

  const rows = [
    { label: 'NPPES',             tone: 'ok',                     text: 'Verified'                              },
    { label: 'OIG Exclusions',    tone: 'ok',                     text: 'Clear'                                 },
    { label: 'Order & Referring', tone: orManual ? 'warn' : 'ok', text: orManual ? 'Manual Review' : 'Eligible' },
    { label: 'Revalidation',      tone: rvRow.tone,               text: rvRow.text                              },
    { label: 'DEA License',       tone: dea.tone,                 text: dea.text                                },
    { label: 'State License',     tone: lic.tone,                 text: lic.text                                },
    { label: 'PTAN',              tone: ptanRow.tone,             text: ptanRow.text                            },
  ]
  const issues = rows.filter((r) => r.tone === 'bad' || r.tone === 'warn').length

  return (
    <div className="mc-card overflow-hidden mt-4 sm:mt-6">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center shrink-0 ring-1 ring-slate-200">
            <Icon name="shield" size={14} stroke={2} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Verification Status</h2>
            <p className="text-[11px] text-slate-400 hidden sm:block">CMS &amp; registry checks run at registration</p>
          </div>
        </div>
        {issues > 0 ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            {issues} issue{issues !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            All Clear
          </span>
        )}
      </div>
      <div>
        {rows.map((r) => <VRow key={r.label} label={r.label} tone={r.tone} text={r.text} />)}
      </div>
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

export default function NPIDetail({ npi: row, onBack, backLabel, onOpenSupplier, initialPattern = null }) {
  const [data, setData] = useState(null)
  const [summary, setSummary] = useState(null)
  const [sumSource, setSumSource] = useState(null)
  const [sumLoading, setSumLoading] = useState(false)
  const timelineRef = useRef(null)
  const scrollToTimeline = () => timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const scrollToClaims = () => claimsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const [pattern, setPattern] = useState(initialPattern)  // open fraud-pattern modal { rule, label, claim? } | null
  const prevNpiRef = useRef(undefined)                    // last NPI shown; clears the modal only on a real NPI change
  const [activeNpi, setActiveNpi] = useState(null)  // physician opened from the Cross-NPI modal (in-place nav)
  const [timelineOpen, setTimelineOpen] = useState(true)
  const [claimSort, setClaimSort] = useState({ key: null, dir: null })   // null = default (date desc)
  const [claimFilter, setClaimFilter] = useState(null)   // UI flag code → claims table filter (e.g. OIG_HIT)
  const [claimWindow, setClaimWindow] = useState(null)   // { from, to, label } date-window filter (volume spike)
  const [claimSupplier, setClaimSupplier] = useState(null)   // supplier-name filter (new-supplier modal)
  const [highlightId, setHighlightId] = useState(null)   // claim row to scroll to / flash
  const [claimsVisible, setClaimsVisible] = useState(15)
  const claimsRef = useRef(null)

  // App navigated to a different NPI → drop any in-place override.
  useEffect(() => { setActiveNpi(null) }, [row])

  useEffect(() => {
    const target = activeNpi || row
    let cancelled = false
    setSummary(null); setSumSource(null); setClaimSort({ key: null, dir: null }); setClaimFilter(null); setClaimWindow(null); setClaimSupplier(null); setHighlightId(null); setData(null); setClaimsVisible(15)
    // keep the restored modal open on mount / back-navigation; clear it only when the NPI
    // actually changes. Ref-based check is StrictMode-safe (the double-invoked effect sees
    // the same NPI on its second run and skips, so it won't wipe the restored modal).
    const npiKey = target?.npi
    if (prevNpiRef.current !== undefined && prevNpiRef.current !== npiKey) setPattern(null)
    prevNpiRef.current = npiKey
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
    const fromPattern = pattern   // remember the open modal so backing out of the Supplier Case reopens it
    try {
      const list = await getSuppliers()
      const sup = list.find((s) => s.name === name) || list.find((s) => (s.name || '').toLowerCase() === (name || '').toLowerCase())
      onOpenSupplier?.(sup || { name }, fromPattern)
    } catch { onOpenSupplier?.({ name }, fromPattern) }
  }
  // Modal "View all/spike claims" → close modal, filter the claims table (by flag or
  // by date window), scroll to it.
  function viewClaims({ flag, from, to, supplier, label } = {}) {
    setPattern(null)
    setHighlightId(null)
    setClaimFilter(flag || null)
    setClaimWindow(from ? { from, to, label } : null)
    setClaimSupplier(supplier || null)
    setClaimsVisible(15)
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

  if (!row) return <div className="w-full px-4 sm:px-7 py-5 sm:py-7 text-slate-500">No NPI selected.</div>
  const baseRow = activeNpi || row
  const npi = data || { ...baseRow, claims: [], actions: [], rulesFired: baseRow.rulesFired || [] }

  function renderPatterns() {
    const patterns = npi.rulesFired.filter((r) => !String(r.label).startsWith('Physician') && !HIDDEN_PATTERNS.includes(r.rule))
    if (patterns.length === 0) return <p className="text-xs text-slate-400">No fraud patterns detected — billing looks consistent.</p>
    return { count: patterns.length, nodes: patterns.map((r, i) => {
      const selected = pattern?.rule === r.rule
      const sev = getSeverity(r.points)
      return (
        <button key={i} onClick={() => onPatternClick(r)} disabled={!r.rule}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 disabled:cursor-default group ${selected ? 'bg-[#F0F4FF] ring-1 ring-[#1E3A5F]/20 shadow-sm' : 'hover:bg-slate-50 hover:shadow-sm'}`}>
          {/* severity dot */}
          <div className="flex-shrink-0 w-2 h-2 rounded-full mt-px" style={{ backgroundColor: sev.dot }} />
          {/* label */}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 truncate leading-snug">{r.label}</div>
          </div>
          {/* severity badge + points + chevron */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wide border border-slate-200 bg-slate-50"
                  style={{ color: sev.text }}>{sev.label}</span>
            <span className="text-[11px] font-semibold tabular-nums w-7 text-right text-slate-400">+{r.points}</span>
            {r.rule && <Icon name="chevronRight" size={12} className="text-slate-300 group-hover:text-slate-500 transition-colors" />}
          </div>
        </button>
      )
    })}
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
    <div className="w-full px-4 sm:px-7 py-4 sm:py-7">
      {/* Top row: NPI header + AI Risk Summary side by side */}
      <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 mb-4 sm:mb-6">
        {/* NPI header card */}
        <div className="mc-card flex-1 min-w-0 overflow-hidden flex items-stretch">
          {/* Main info */}
          <div className="flex-1 min-w-0 px-4 sm:px-6 py-4 sm:py-5 flex items-center gap-3 sm:gap-4">
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl bg-[#EEF2FF] text-[#1B3A5C] flex items-center justify-center shrink-0">
              <Icon name="users" size={18} stroke={1.9} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">NPI Investigation</p>
              <h1 className="text-[15px] sm:text-[20px] font-bold text-slate-900 tracking-tight leading-tight truncate max-w-[200px] sm:max-w-none">{npi.name}</h1>
              <div className="flex items-center gap-1.5 sm:gap-2 mt-1 sm:mt-1.5 flex-wrap">
                <span className="text-[10px] sm:text-[11px] font-semibold bg-[#EEF2FF] text-[#1B3A5C] px-2 sm:px-2.5 py-0.5 rounded-full">{npi.specialty}</span>
                <span className="text-slate-300 text-xs select-none hidden sm:inline">·</span>
                <span className="text-[11px] sm:text-[12px] text-slate-500 hidden sm:inline">NPI <span className="font-mono">{npi.npi}</span></span>
                <span className="text-slate-300 text-xs select-none hidden sm:inline">·</span>
                <span className="text-[11px] sm:text-[12px] text-slate-500">{npi.city}, {npi.state}</span>
              </div>
              {/* NPI shown on its own line on mobile only */}
              <div className="sm:hidden text-[10px] text-slate-400 mt-0.5 font-mono">{npi.npi}</div>
            </div>
          </div>
          {/* Score ring panel */}
          <div className="w-20 sm:w-28 shrink-0 flex flex-col items-center justify-center bg-slate-50 border-l border-slate-100">
            <ScoreRing score={npi.score} />
          </div>
        </div>

        {/* AI risk summary card */}
        <div className="mc-card p-4 sm:p-5 w-full lg:w-[340px] lg:shrink-0 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#1B3A5C]/[0.08] text-[#1B3A5C] flex items-center justify-center shrink-0 ring-1 ring-[#1B3A5C]/10">
                <Icon name="bolt" size={15} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">AI Risk Summary</h2>
                <p className="text-[11px] text-slate-400 hidden sm:block">Plain-English explanation of this provider's risk</p>
              </div>
            </div>
          </div>
          {!summary && (
            <button onClick={() => genSummary(npi.npi)} disabled={sumLoading} className="mt-3 btn-navy w-full justify-center disabled:opacity-60 text-[13px]">
              {sumLoading ? 'Generating…' : 'Generate AI Summary'}
            </button>
          )}
          {summary && !sumLoading && (
            <button onClick={() => genSummary(npi.npi)} className="mt-3 w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors">Regenerate</button>
          )}
        </div>
      </div>

      {/* AI summary expanded content (outside the card row, shown when summary exists) */}
      {(sumLoading || summary) && (
        <div className="mc-card p-4 sm:p-5 mb-4 sm:mb-6 -mt-1 sm:-mt-2">
          {sumLoading && <div className="h-12 rounded-lg bg-slate-100 animate-pulse" />}
          {summary && !sumLoading && (
            <>
              <p className="text-sm text-slate-700 leading-relaxed">{summary}</p>
              <div className="mt-2 text-[11px] text-slate-400">
                {sumSource === 'llm' ? '✦ Generated by AI'
                  : sumSource === 'error' ? 'Summary unavailable'
                  : 'Rule-based summary (LLM unavailable)'}
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4 mb-4 sm:mb-6">
        {[
          { icon: 'claims', label: 'Total Claims',    value: (npi.totalClaims || 0).toLocaleString(), iconBg: 'bg-slate-100', iconText: 'text-slate-500', hoverIcon: 'group-hover:bg-slate-200 group-hover:text-slate-700', chevCls: 'text-slate-400', onClick: scrollToClaims   },
          { icon: 'doc',    label: 'Total Billed',    value: fmtUSD(npi.totalAmount),                  iconBg: 'bg-slate-100', iconText: 'text-slate-500', hoverIcon: 'group-hover:bg-slate-200 group-hover:text-slate-700', chevCls: 'text-slate-400', onClick: scrollToClaims   },
          { icon: 'flag',   label: 'Physician Flags', value: npi.physicianFlags,                       iconBg: 'bg-slate-100', iconText: 'text-slate-500', hoverIcon: 'group-hover:bg-slate-200 group-hover:text-slate-700', chevCls: 'text-slate-400', onClick: scrollToTimeline },
        ].map(({ icon, label, value, iconBg, iconText, hoverIcon, chevCls, onClick }) => (
          <button key={label} onClick={onClick}
                  className="group mc-card px-3 sm:px-6 py-3 sm:py-6 text-left flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-5 hover:-translate-y-1 hover:shadow-[0_12px_28px_-6px_rgba(15,23,42,0.14)] hover:border-slate-300/80 transition-all duration-200 cursor-pointer w-full overflow-hidden">
            <div className={`w-8 h-8 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 ring-1 ring-inset ring-black/[0.04] ${iconBg} ${iconText} ${hoverIcon}`}>
              <Icon name={icon} size={15} />
            </div>
            <div className="flex-1 min-w-0 w-full">
              <p className="text-[8px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1 sm:mb-2">{label}</p>
              <p className="text-[16px] sm:text-[26px] font-bold text-slate-900 tabular-nums leading-none tracking-tight truncate">{value}</p>
            </div>
            <div className={`hidden sm:flex w-7 h-7 rounded-full items-center justify-center shrink-0 bg-slate-100 transition-all duration-200 group-hover:bg-[#1B3A5C] group-hover:text-white ${chevCls}`}>
              <Icon name="chevronRight" size={12} stroke={2.5} />
            </div>
          </button>
        ))}
      </div>

      {/* Fraud Patterns + Timeline side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6 items-start">

        {/* Fraud Patterns */}
        {(() => {
          const result = renderPatterns()
          const isEmpty = !result || !result.nodes
          return (
            <div className="mc-card overflow-hidden flex flex-col max-h-[340px] sm:max-h-[360px]">
              <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 sm:gap-2.5">
                  <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0 ring-1 ring-rose-100">
                    <Icon name="alertTri" size={14} />
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Fraud Patterns Detected</h2>
                    <p className="text-[11px] text-slate-400 hidden sm:block">Rules that fired on this provider's claims</p>
                  </div>
                </div>
                {!isEmpty && (
                  <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums shrink-0">
                    {result.count}
                  </span>
                )}
              </div>
              <div className="p-3 sm:p-4 space-y-0.5 overflow-y-auto flex-1">{isEmpty ? <div className="px-1 py-2 text-xs text-slate-400">{result}</div> : result.nodes}</div>
            </div>
          )
        })()}

        {/* Physician Feedback Timeline */}
        <div ref={timelineRef} className="mc-card overflow-hidden flex flex-col max-h-[340px] sm:max-h-[360px]">
          <button type="button" onClick={() => setTimelineOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 hover:bg-slate-50 transition-colors border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <Icon name="flag" size={14} />
              </span>
              <div className="text-left">
                <h2 className="text-sm font-bold text-slate-900">Physician Feedback Timeline</h2>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  {npi.actions.length > 0 ? `${npi.actions.length} action${npi.actions.length !== 1 ? 's' : ''} recorded` : 'No actions yet'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {npi.actions.length > 0 && (
                <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
                  {npi.actions.length}
                </span>
              )}
              <Icon name="chevronRight" size={14}
                    className={`text-slate-400 transition-transform duration-200 ${timelineOpen ? 'rotate-90' : ''}`} />
            </div>
          </button>
          {timelineOpen && (
            <div className="px-4 sm:px-5 pb-3 sm:pb-4 overflow-y-auto flex-1 min-h-0">
              {npi.actions.length === 0 ? (
                <p className="text-xs text-slate-400 pt-4">No physician actions recorded.</p>
              ) : (
                <div className="divide-y divide-slate-50 mt-1">
                  {npi.actions.map((a) => {
                    const meta = ACTION_META[a.action] ?? ACTION_META.confirmed
                    return (
                      <div key={a.id} className="flex items-start gap-2.5 sm:gap-3 py-2.5 sm:py-3">
                        <div className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.dot }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1 flex-wrap min-w-0">
                              <span className="text-xs font-bold text-slate-800">{meta.label}</span>
                              {a.supplier && (
                                <span className="text-xs text-slate-500">·{' '}
                                  <button type="button" onClick={() => openSupplier(a.supplier)}
                                          className="font-bold text-[#1E3A5F] rounded px-0.5 transition-colors hover:bg-[#1E3A5F]/[0.08] hover:underline cursor-pointer max-w-[130px] sm:max-w-none truncate inline-block align-bottom">
                                    {a.supplier}
                                  </button>
                                </span>
                              )}
                              {a.patient && <span className="text-xs text-slate-500 truncate max-w-[100px] sm:max-w-none">· {a.patient}</span>}
                            </div>
                            <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap shrink-0">{timeAgo(a.ts)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      <div ref={claimsRef} className="mc-card overflow-hidden scroll-mt-20">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">Claims ({(claimFilter || claimWindow || claimSupplier) ? `${sortedClaims.length} of ${npi.claims.length}` : npi.claims.length})</h2>
          {(claimFilter || claimWindow || claimSupplier) && (
            <button onClick={() => { setClaimFilter(null); setClaimWindow(null); setClaimSupplier(null) }} className="text-[11px] font-semibold text-[#1E3A5F] hover:underline whitespace-nowrap">
              Clear ✕
            </button>
          )}
        </div>

        {/* Mobile card view (< sm) */}
        <div className="sm:hidden divide-y divide-slate-100">
          {sortedClaims.slice(0, claimsVisible).map((c) => {
            const shown = (c.flags || []).filter((f) => !HIDDEN_FLAGS.includes(f))
            return (
              <div key={c.id} id={`claimrow-${c.id}`}
                   className={`px-4 py-3 transition-colors ${c.id === highlightId ? 'bg-[#EFF6FF]' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800 truncate">{c.patient}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{fmtDate(c.date)}</div>
                  </div>
                  <div className="text-[13px] font-bold text-slate-800 tabular-nums whitespace-nowrap shrink-0">{fmtUSD(c.amount, 2)}</div>
                </div>
                {c.description && (
                  <div className="text-[11px] text-slate-500 mb-1.5 line-clamp-2 leading-snug">{c.description}</div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={CATEGORY_CHIP} style={CATEGORY_CHIP_STYLE}>{c.category}</span>
                  {c.supplier && <span className="text-[11px] text-slate-400 truncate max-w-[160px]">{c.supplier}</span>}
                  {shown.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {shown.map((f) => (
                        <button key={f} onClick={() => onFlagClick(c, f)}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-200 font-semibold hover:bg-rose-100 transition-colors whitespace-nowrap">
                          {FLAG_LABELS[f] ?? f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {sortedClaims.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-slate-400">No claims match this filter.</div>
          )}
        </div>

        {/* Desktop table (sm+) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-[#F0F4F8]">
                {CLAIM_COLUMNS.map((c) => {
                  const active = claimSort.key === c.key
                  return (
                    <th key={c.key} onClick={() => onClaimSort(c.key)}
                        className={`th cursor-pointer select-none group ${c.right ? 'text-right' : ''} ${c.cls || ''}`}>
                      <span className="inline-flex items-center gap-1 group-hover:text-[#1E3A5F] transition-colors">
                        {c.label}
                        {active
                          ? <span className="text-[#1E3A5F]">{claimSort.dir === 'asc' ? '↑' : '↓'}</span>
                          : <span className="text-slate-300 group-hover:text-slate-500 transition-colors">↕</span>}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedClaims.slice(0, claimsVisible).map((c) => (
                <tr key={c.id} id={`claimrow-${c.id}`}
                    className={`transition-colors ${c.id === highlightId ? 'bg-[#EFF6FF] ring-1 ring-inset ring-[#BFDBFE]' : 'hover:bg-slate-50'}`}>
                  <td className="td text-xs tabular-nums whitespace-nowrap">{fmtDate(c.date)}</td>
                  <td className="td hidden sm:table-cell text-sm font-medium text-slate-700">{c.patient}</td>
                  <td className="td hidden md:table-cell text-xs">{c.description}</td>
                  <td className="td hidden sm:table-cell"><span className={CATEGORY_CHIP} style={CATEGORY_CHIP_STYLE}>{c.category}</span></td>
                  <td className="td hidden lg:table-cell text-xs text-slate-500">{c.supplier}</td>
                  <td className="td text-right font-bold text-slate-800 tabular-nums">{fmtUSD(c.amount, 2)}</td>
                  <td className="td">
                    <div className="flex items-center gap-1 flex-wrap">
                      {(() => {
                        const shown = (c.flags || []).filter((f) => !HIDDEN_FLAGS.includes(f))
                        return shown.length === 0 ? <span className="text-slate-300">—</span>
                        : shown.map((f) => (
                          <button key={f} onClick={() => onFlagClick(c, f)} title="Investigate this flag"
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-200 font-semibold hover:bg-rose-100 transition-colors whitespace-nowrap">
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

        {/* Pagination — shared */}
        {sortedClaims.length > claimsVisible && (
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex items-center justify-between gap-4 bg-white">
            <span className="text-[12px] text-slate-400">
              Showing <span className="font-semibold text-slate-600">{claimsVisible}</span> of <span className="font-semibold text-slate-600">{sortedClaims.length}</span>
            </span>
            <button onClick={() => setClaimsVisible((v) => Math.min(v + 15, sortedClaims.length))}
                    className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-[12px] sm:text-[13px] font-semibold text-[#0d1f35] bg-[#EEF2F7] hover:bg-[#dde6f0] border border-[#1B3A5C]/10 transition-colors">
              Show next {Math.min(15, sortedClaims.length - claimsVisible)}
              <Icon name="chevronRight" size={13} className="rotate-90" stroke={2.2} />
            </button>
          </div>
        )}
        {sortedClaims.length > 0 && claimsVisible >= sortedClaims.length && sortedClaims.length > 15 && (
          <div className="px-4 sm:px-6 py-3.5 border-t border-slate-100 flex items-center justify-between bg-white">
            <span className="text-[12px] text-slate-400">All <span className="font-semibold text-slate-600">{sortedClaims.length}</span> claims shown</span>
            <button onClick={() => setClaimsVisible(15)} className="text-[12px] font-medium text-slate-400 hover:text-slate-600 transition-colors">
              Collapse ↑
            </button>
          </div>
        )}
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
