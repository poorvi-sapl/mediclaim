import { useState, useEffect, useRef } from 'react'
import { getNpiDetail, getNpiSummary, getSuppliers, API_BASE } from '../../api'
import { Icon, StatCard, fmtUSD, fmtDate, timeAgo } from '../../components/ui'
import FraudPatternPanel from '../components/FraudPatternPanel'

// Service Category tag — same light-glass pill recipe as the vendor/physician
// claims tables (.cat-tag + .cat-dme/.cat-home-health/.cat-hospital/.cat-drugs
// in index.css), one fixed color + icon per category instead of one flat chip.
const CATEGORY_TAG = {
  'DME':         { cls: 'cat-dme',         icon: 'package' },
  'Home Health': { cls: 'cat-home-health', icon: 'suppliers' },
  'Hospital':    { cls: 'cat-hospital',    icon: 'hospital' },
  'Drugs':       { cls: 'cat-drugs',       icon: 'pill' },
}
function CategoryTag({ category }) {
  const meta = CATEGORY_TAG[category] || { cls: 'cat-other', icon: 'doc' }
  return (
    <span className={`cat-tag ${meta.cls}`}>
      <Icon name={meta.icon} size={11} stroke={2.2} />
      {category}
    </span>
  )
}
const FLAG_LABELS = {
  OIG_HIT: 'OIG Hit', CROSS_NPI: 'Cross-NPI', VOLUME_SPIKE: 'Vol. Spike',
  GEO_ANOMALY: 'Geo Anomaly', NEW_SUPPLIER: 'New Vendor', DUPLICATE: 'Duplicate',
  IDENTITY_REUSE: 'Identity Reuse', HOSPICE_DURATION: 'Long Hospice',
  UPCODING: 'Upcoding', UNBUNDLING: 'Unbundling',
  DECEASED: 'Deceased', IMPOSSIBLE_DAY: 'Impossible Day', MODIFIER_ABUSE: 'Modifier Abuse',
  RAPID_CYCLING: 'Rapid Cycling', SUPPLIER_CONCENTRATION: 'Vendor Conc.',
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
  confirmed: { label: 'Confirmed', dot: '#3A7D5C' },
  disputed: { label: 'Disputed', dot: '#D1A85C' },
  flagged: { label: 'Flagged Vendor', dot: '#A6453F' },
  unknownPatient: { label: 'Unknown Patient', dot: '#C7D0DE' },
  deceasedPatient: { label: 'Deceased Patient', dot: '#7A6899' },
  deniedOrder: { label: 'Did Not Order', dot: '#A6453F' },
}


// Claims table sort (change). All columns sortable; default order = date desc.
const CLAIM_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'patient', label: 'Patient', cls: 'hidden sm:table-cell' },
  { key: 'description', label: 'Description', cls: 'hidden md:table-cell' },
  { key: 'category', label: 'Category', cls: 'hidden sm:table-cell' },
  { key: 'supplier', label: 'Vendor', cls: 'hidden lg:table-cell' },
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

// Compact 64px risk ring for the header card -- colored arc (score% of the
// circumference, 12 o'clock start, clockwise) with the number + tier label
// centered inside. Mirrors the NPI investigation mockup's risk-ring-wrap.
function scoreTier(score) {
  if (score > 80) return { color: '#A6453F', label: 'Critical' }
  if (score > 65) return { color: '#D1A85C', label: 'High' }
  if (score > 30) return { color: '#D1A85C', label: 'Medium' }
  return { color: '#3A7D5C', label: 'Low' }
}
function HeaderRiskRing({ score, size = 64, strokeWidth = 6, trackColor = '#F1F4F9', numColor }) {
  const { color, label } = scoreTier(score)
  const r = (size - strokeWidth) / 2, circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(100, Math.max(0, score)) / 100)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
                strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-extrabold leading-none" style={{ fontFamily: "'Manrope',sans-serif", fontSize: Math.round(size * 0.3), color: numColor || color }}>{score}</div>
        <div className="font-bold uppercase leading-none mt-0.5" style={{ fontSize: Math.max(7, Math.round(size * 0.125)), letterSpacing: '.03em', color: numColor || color }}>{label}</div>
      </div>
    </div>
  )
}

// Icon per fraud-pattern rule for the grid cards below — falls back to a
// generic alert triangle for anything not explicitly mapped.
const RULE_ICON = {
  volume_spike: 'bolt',
  cross_npi_supplier: 'suppliers',
  geographic_anomaly: 'search',
  oig_leie_hit: 'shieldAlert',
  new_high_value_supplier: 'suppliers',
  identity_reuse: 'userx',
  abnormal_hospice_duration: 'clock',
  unbundling: 'doc',
  rapid_cycling: 'refresh',
  supplier_concentration: 'suppliers',
  duplicate_billing: 'doc',
  impossible_day: 'clock',
}

// Rule-row severity badge -- exact tone recipe from the NPI investigation
// mockup's .sev-medium/.sev-high/.sev-critical (a LOW tier is added since the
// app's real severity scale has one, the mockup's worked example just didn't).
function getSeverity(points) {
  if (points >= 35) return { label: 'CRITICAL', dot: '#A6453F', badgeBg: '#A6453F', badgeTx: '#fff' }
  if (points >= 25) return { label: 'HIGH',     dot: '#A6453F', badgeBg: '#FCE4E1', badgeTx: '#8A423D' }
  if (points >= 15) return { label: 'MEDIUM',   dot: '#D1A85C', badgeBg: '#FBF3E4', badgeTx: '#8A6A34' }
  return               { label: 'LOW',      dot: '#3A7D5C', badgeBg: '#E9F3ED', badgeTx: '#2E6B4F' }
}

// Claim-row flag chip — colored by the same severity tier as its parent rule
// in the Fraud Patterns panel above (looked up by real points, not guessed),
// instead of every flag type sharing one flat rose chip.
function FlagChip({ code, rulesFired, onClick }) {
  const rule = rulesFired?.find((r) => r.rule === FLAG_TO_RULE[code])
  const sev = rule ? getSeverity(rule.points) : { badgeBg: '#F1F4F9', badgeTx: '#647089' }
  return (
    <button onClick={onClick} title="Investigate this flag"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap transition-opacity hover:opacity-80"
            style={{ background: sev.badgeBg, color: sev.badgeTx }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sev.badgeTx }} />
      {FLAG_LABELS[code] ?? code}
    </button>
  )
}

// Category / Flags column header — the header itself is the filter: click
// opens a dropdown of that column's values. `multi` (Flags) toggles values
// in/out of an array and keeps the panel open; single-select (Category)
// picks one and closes. "All" clears either way.
function ClaimFilterTh({ label, options, value, onChange, multi = false, cls = '', alignRight = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = multi ? value.length > 0 : !!value

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function pick(id) {
    if (!multi) { onChange(id); setOpen(false); return }
    if (id === '') { onChange([]); return }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }
  const allSelected = multi ? value.length === 0 : !value

  return (
    <th ref={ref} className={`th select-none relative ${cls}`}>
      <button onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 cursor-pointer uppercase"
              style={{ color: open || active ? '#0A1F3D' : 'inherit', font: 'inherit' }}>
        {label}{multi && active ? ` (${value.length})` : ''}
        <Icon name="chevronDown" size={10} className={open || active ? 'text-[#0A1F3D]' : 'text-slate-300'}
              style={{ transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className={`absolute top-full ${alignRight ? 'right-0' : 'left-0'} mt-1.5 bg-white rounded-xl border border-slate-200 z-40 min-w-[170px] max-h-[260px] overflow-y-auto normal-case`}
             style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)' }}>
          <div className="py-1">
            <button onMouseDown={(e) => { e.preventDefault(); pick('') }}
                    className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 ${allSelected ? 'bg-slate-50 text-[#0A1F3D] font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}>
              <span className="truncate">All</span>
              {allSelected && <Icon name="check" size={12} />}
            </button>
            {options.map((opt) => {
              const sel = multi ? value.includes(opt.id) : value === opt.id
              return (
                <button key={opt.id} onMouseDown={(e) => { e.preventDefault(); pick(opt.id) }}
                        className={`w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between gap-3 ${sel ? 'bg-slate-50 text-[#0A1F3D] font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}>
                  <span className="truncate">{opt.label}</span>
                  {sel && <Icon name="check" size={12} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </th>
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

function VRow({ label, tone, text }) {
  const s = {
    ok:    { bg: 'bg-[#E9F3ED]', txt: 'text-[#2E6B4F]', border: 'border-[#D5E9DD]', iconBg: 'bg-[#E9F3ED]', iconTx: 'text-[#3A7D5C]', icon: 'check'    },
    warn:  { bg: 'bg-[#FBF3E4]', txt: 'text-[#8A6A34]', border: 'border-[#F0E0BE]', iconBg: 'bg-[#FBF3E4]', iconTx: 'text-[#D1A85C]', icon: 'clock'    },
    bad:   { bg: 'bg-[#F7EBEA]', txt: 'text-[#8A423D]', border: 'border-[#EBD3D1]', iconBg: 'bg-[#F7EBEA]', iconTx: 'text-[#A6453F]', icon: 'alertTri' },
    muted: { bg: 'bg-slate-50',  txt: 'text-slate-400',  border: 'border-slate-200/80', iconBg: 'bg-slate-100', iconTx: 'text-slate-300', icon: 'x' },
  }[tone] || { bg: 'bg-slate-50', txt: 'text-slate-400', border: 'border-slate-200/80', iconBg: 'bg-slate-100', iconTx: 'text-slate-300', icon: 'x' }
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${s.iconBg} ${s.iconTx}`}>
          <Icon name={s.icon} size={11} stroke={2.4} />
        </span>
        <span className="text-[12px] sm:text-[13px] text-slate-600 truncate">{label}</span>
      </div>
      <span className={`inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-semibold border shrink-0 max-w-[180px] sm:max-w-none ${s.bg} ${s.txt} ${s.border}`}>
        <span className="truncate">{text}</span>
      </span>
    </div>
  )
}

// Row list shared by the Verification Status card and the header KPI —
// returns null for pre-feature accounts with no verification record.
function buildVerificationRows(verification) {
  if (!verification || Object.keys(verification).length === 0) return null

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

  return [
    { label: 'NPPES',             tone: 'ok',                     text: 'Verified'                              },
    { label: 'OIG Exclusions',    tone: 'ok',                     text: 'Clear'                                 },
    { label: 'Order & Referring', tone: orManual ? 'warn' : 'ok', text: orManual ? 'Manual Review' : 'Eligible' },
    { label: 'Revalidation',      tone: rvRow.tone,               text: rvRow.text                              },
    { label: 'DEA License',       tone: dea.tone,                 text: dea.text                                },
    { label: 'State License',     tone: lic.tone,                 text: lic.text                                },
    { label: 'PTAN',              tone: ptanRow.tone,             text: ptanRow.text                            },
  ]
}

// Verification banner — replaces the old buried KPI card with a prominent,
// color-coded strip (warning tone when not run / issues found, success tone
// when clear). Clicking expands the same check list inline instead of a
// popover, since a full-width banner reads better as an accordion.
function VerificationBanner({ verification }) {
  const [open, setOpen] = useState(false)
  const rows = buildVerificationRows(verification)
  // Pre-feature accounts (registered before CMS verification existed) have no
  // record at all — nothing useful to show, so skip the banner entirely
  // instead of a permanent "not run" strip.
  if (rows == null) return null
  const issues = rows.filter((r) => r.tone === 'bad' || r.tone === 'warn').length
  const bad = issues > 0
  const palette = bad
    ? { bg: '#FBF3E4', border: '#F0E0BE', iconBg: '#D1A85C', text: '#8A6A34' }
    : { bg: '#E9F3ED', border: '#D5E9DD', iconBg: '#3A7D5C', text: '#2E6B4F' }

  return (
    <div className="rounded-2xl mb-4 overflow-hidden lg:shrink-0" style={{ backgroundColor: palette.bg, border: `1px solid ${palette.border}` }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
              className="w-full flex items-center gap-3.5 px-4 sm:px-5 py-3.5 text-left cursor-pointer flex-wrap">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: palette.iconBg }}>
          <Icon name="shield" size={16} style={{ color: '#fff' }} />
        </div>
        <div className="flex-1 min-w-[220px] text-[13px]">
          <b style={{ color: palette.text }}>
            {bad ? `Verification — ${issues} issue${issues !== 1 ? 's' : ''}` : 'Verification — all clear'}
          </b>
          {' — '}
          <span className="text-slate-600">
            {bad ? 'review the flagged checks below.' : 'CMS & registry checks passed at registration.'}
          </span>
        </div>
        <Icon name="chevronDown" size={14} stroke={2.5} className="text-slate-400 transition-transform duration-150 shrink-0"
              style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="bg-white" style={{ borderTop: `1px solid ${palette.border}` }}>
          {rows.map((r) => <VRow key={r.label} label={r.label} tone={r.tone} text={r.text} />)}
        </div>
      )}
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
  const [fraudCheckLoading, setFraudCheckLoading] = useState(false)
  const [fraudCheckResult, setFraudCheckResult] = useState(null)
  const timelineRef = useRef(null)
  const scrollToTimeline = () => timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const scrollToClaims = () => claimsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const [pattern, setPattern] = useState(initialPattern)  // open fraud-pattern modal { rule, label, claim? } | null
  const prevNpiRef = useRef(undefined)                    // last NPI shown; clears the modal only on a real NPI change
  const [activeNpi, setActiveNpi] = useState(null)  // physician opened from the Cross-NPI modal (in-place nav)
  const [timelineOpen, setTimelineOpen] = useState(true)
  const [patternsOpen, setPatternsOpen] = useState(false)   // Fraud-patterns card — collapsed by default, expands on the dropdown toggle
  const [claimSort, setClaimSort] = useState({ key: null, dir: null })   // null = default (date desc)
  const [claimFilter, setClaimFilter] = useState(null)   // UI flag code → claims table filter (e.g. OIG_HIT)
  const [claimWindow, setClaimWindow] = useState(null)   // { from, to, label } date-window filter (volume spike)
  const [claimSupplier, setClaimSupplier] = useState(null)   // supplier-name filter (new-supplier modal)
  const [categoryFilter, setCategoryFilter] = useState('')   // Category column-header dropdown (single)
  const [flagsFilter, setFlagsFilter] = useState([])         // Flags column-header dropdown (multi — row matches ANY selected flag)
  const [highlightId, setHighlightId] = useState(null)   // claim row to scroll to / flash
  const claimsRef = useRef(null)
  // Claims card "pop": an explicit expand button lifts the whole claims card
  // into a centered overlay (dimmed backdrop) so more rows are visible at once;
  // clicking the backdrop, the minimize button, or Escape settles it back.
  // Mirrors the physician dashboard's Oldest-Unreviewed queue card.
  const [claimsPopped, setClaimsPopped] = useState(false)

  // App navigated to a different NPI → drop any in-place override.
  useEffect(() => { setActiveNpi(null) }, [row])

  // Escape closes the popped-open claims overlay.
  useEffect(() => {
    if (!claimsPopped) return
    function onKey(e) { if (e.key === 'Escape') setClaimsPopped(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [claimsPopped])

  useEffect(() => {
    const target = activeNpi || row
    let cancelled = false
    setSummary(null); setSumSource(null); setClaimSort({ key: null, dir: null }); setClaimFilter(null); setClaimWindow(null); setClaimSupplier(null); setCategoryFilter(''); setFlagsFilter([]); setHighlightId(null); setData(null); setFraudCheckResult(null); setClaimsPopped(false)
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
    setClaimsPopped(false)
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

  async function runFraudCheck(npiId) {
    setFraudCheckLoading(true)
    setFraudCheckResult(null)
    try {
      const res = await fetch(`${API_BASE}/plan/npi/${npiId}/run-fraud-check`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      setFraudCheckResult(data)
    } catch (e) {
      setFraudCheckResult({ error: e.message })
    } finally {
      setFraudCheckLoading(false)
    }
  }

  if (!row) return <div className="w-full px-4 sm:px-7 py-5 sm:py-7 text-slate-500">No NPI selected.</div>
  const baseRow = activeNpi || row
  const npi = data || { ...baseRow, claims: [], actions: [], rulesFired: baseRow.rulesFired || [] }

  function renderPatterns() {
    const patterns = npi.rulesFired.filter((r) => !String(r.label).startsWith('Physician') && !HIDDEN_PATTERNS.includes(r.rule))
    if (patterns.length === 0) return <p className="text-xs text-slate-400">No fraud patterns detected — billing looks consistent.</p>
    return { count: patterns.length, nodes: (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {patterns.map((r, i) => {
          const selected = pattern?.rule === r.rule
          const sev = getSeverity(r.points)
          return (
            <button key={i} onClick={() => onPatternClick(r)} disabled={!r.rule}
                    className={`text-left rounded-xl border p-3.5 flex items-start gap-3 transition-colors duration-150 disabled:cursor-default ${selected ? 'border-[#0A1F3D]/25 bg-[#E9F0F6]/60' : 'border-slate-200 hover:bg-slate-50'}`}>
              <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: sev.badgeBg, color: sev.badgeTx }}>
                <Icon name={RULE_ICON[r.rule] || 'alertTri'} size={15} />
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-slate-900 leading-snug">{r.label}</div>
                <span className="inline-block mt-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide" style={{ background: sev.badgeBg, color: sev.badgeTx }}>{sev.label}</span>
                <div className="text-[12.5px] text-slate-600 mt-1.5">+{r.points} risk points</div>
              </div>
            </button>
          )
        })}
      </div>
    ) }
  }

  // Column-header dropdown options — distinct values actually present in this
  // NPI's claims (Flags excludes the UI-hidden pattern codes).
  const categoryOptions = [...new Set((npi.claims || []).map((c) => c.category).filter(Boolean))]
    .sort().map((c) => ({ id: c, label: c }))
  const flagOptions = [...new Set((npi.claims || []).flatMap((c) => c.flags || []))]
    .filter((f) => !HIDDEN_FLAGS.includes(f)).sort()
    .map((f) => ({ id: f, label: FLAG_LABELS[f] || f }))

  const sortedClaims = (() => {
    let arr = [...(npi.claims || [])]
    if (claimFilter) arr = arr.filter((c) => (c.flags || []).includes(claimFilter))
    else if (claimWindow) arr = arr.filter((c) => c.date >= claimWindow.from && c.date <= claimWindow.to)
    else if (claimSupplier) arr = arr.filter((c) => c.supplier === claimSupplier)
    if (categoryFilter) arr = arr.filter((c) => c.category === categoryFilter)
    if (flagsFilter.length) arr = arr.filter((c) => (c.flags || []).some((f) => flagsFilter.includes(f)))
    if (claimSort.key && CLAIM_COMPARATORS[claimSort.key]) {
      arr.sort(CLAIM_COMPARATORS[claimSort.key])
      if (claimSort.dir === 'desc') arr.reverse()
    } else {
      arr.sort((a, b) => claimMs(b.date) - claimMs(a.date))   // default: most recent first
    }
    return arr
  })()

  // Fraud-patterns grid — computed once here so both the AI-strip toggle button
  // (count badge) and the panel below can share it.
  const patternsResult = renderPatterns()
  const patternsEmpty = !patternsResult || !patternsResult.nodes
  const patternsCount = patternsEmpty ? 0 : patternsResult.count

  return (
    <div className="w-full px-4 sm:px-7 py-4 sm:py-7 lg:h-full lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden">
      {/* Hero -- navy risk-first identity card: gauge + identity + claims/billed
          stats in one band, replacing the old row of 5 separate white cards. */}
      <div className="relative overflow-hidden rounded-2xl px-5 sm:px-7 py-5 sm:py-6 mb-4 flex items-center gap-5 sm:gap-8 flex-wrap lg:shrink-0"
           style={{ background: 'linear-gradient(135deg, #0A1F3D, #12335E)' }}>
        <div className="absolute -bottom-16 -right-10 w-44 h-44 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,.06)' }} />

        <HeaderRiskRing score={npi.score} size={88} strokeWidth={8} trackColor="rgba(255,255,255,.15)" numColor="#fff" />

        <div className="flex-1 min-w-[220px] relative">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#8FA6C9' }}>NPI Investigation</p>
          <h1 className="font-extrabold text-white text-lg sm:text-xl leading-tight mt-0.5" style={{ fontFamily: "'Manrope',sans-serif" }}>{npi.name}</h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#B9CBE8' }}>NPI <span className="font-mono">{npi.npi}</span> · {npi.city}, {npi.state}</p>
          <span className="inline-block mt-1.5 text-[12px] font-semibold px-3 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>{npi.specialty}</span>
        </div>

        <div className="flex gap-6 sm:gap-8 relative">
          <button onClick={scrollToClaims} className="text-left cursor-pointer">
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#8FA6C9' }}>Claims</div>
            <div className="font-extrabold text-white text-xl mt-1" style={{ fontFamily: "'Manrope',sans-serif" }}>{(npi.totalClaims || 0).toLocaleString()}</div>
          </button>
          <button onClick={scrollToClaims} className="text-left cursor-pointer">
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#8FA6C9' }}>Billed</div>
            <div className="font-extrabold text-white text-xl mt-1" style={{ fontFamily: "'Manrope',sans-serif" }}>{fmtUSD(npi.totalAmount)}</div>
          </button>
        </div>
      </div>

      <VerificationBanner verification={npi.verification} />

      {/* AI strip */}
      <div className="rounded-2xl px-4 sm:px-5 py-3.5 mb-4 flex items-center gap-3.5 flex-wrap lg:shrink-0"
           style={{ background: 'linear-gradient(180deg, #EAF1F5, #fff 65%)' }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(180deg, #3E7FA6, #2E6B8F)' }}>
          <Icon name="sparkle" size={15} style={{ color: '#fff' }} />
        </div>
        <div className="flex-1 min-w-[220px] text-[13px]">
          {sumLoading ? (
            <span className="text-slate-400">Generating summary…</span>
          ) : summary ? (
            <>
              <span className="text-slate-700 leading-relaxed">{summary}</span>{' '}
              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                {sumSource === 'llm' ? '✦ Generated by AI' : sumSource === 'error' ? 'Summary unavailable' : 'Rule-based summary'}
              </span>
            </>
          ) : (
            <><b style={{ color: '#2E6B8F' }}>AI Risk Summary</b> — Plain-English explanation of this provider's risk hasn't been generated yet.</>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setPatternsOpen((o) => !o)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-[12.5px] font-bold transition-colors whitespace-nowrap ${
                    patternsOpen ? 'bg-[#0A1F3D] text-white border-[#0A1F3D]' : 'bg-white text-[#0A1F3D] border-slate-200 hover:bg-slate-50'
                  }`}>
            <Icon name="alertTri" size={14} />
            Fraud patterns
            {!patternsEmpty && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${patternsOpen ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {patternsCount}
              </span>
            )}
            <Icon name="chevronDown" size={13} stroke={2.5} className={`transition-transform duration-200 ${patternsOpen ? 'rotate-180' : ''}`} />
          </button>
          {!summary ? (
            <button onClick={() => genSummary(npi.npi)} disabled={sumLoading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-[12.5px] text-white disabled:opacity-60 transition-shadow whitespace-nowrap"
                    style={{ background: 'linear-gradient(180deg, #3E7FA6, #2E6B8F)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25), 0 6px 14px rgba(46,107,143,.25)' }}>
              {sumLoading ? 'Generating…' : 'Generate AI Summary →'}
            </button>
          ) : (
            <button onClick={() => genSummary(npi.npi)} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors whitespace-nowrap">
              Regenerate
            </button>
          )}
          <button onClick={() => runFraudCheck(npi.npi)} disabled={fraudCheckLoading}
                  className="px-3.5 py-2 rounded-lg bg-[#A6453F] hover:bg-[#8A423D] disabled:opacity-60 text-white text-[12.5px] font-bold transition-colors whitespace-nowrap">
            {fraudCheckLoading ? 'Checking…' : 'Run Fraud Check'}
          </button>
        </div>
      </div>

      {fraudCheckResult && (
        <div className="mb-4 -mt-1 px-4 py-2.5 rounded-lg bg-[#F7EBEA] border border-[#EBD3D1] text-[12px] text-[#8A423D] lg:shrink-0">
          {fraudCheckResult.error ? `Check failed: ${fraudCheckResult.error}` :
            fraudCheckResult.ghost_count > 0
              ? `${fraudCheckResult.ghost_count} ghost billing claim${fraudCheckResult.ghost_count !== 1 ? 's' : ''} detected out of ${fraudCheckResult.checked_claims} checked`
              : `No ghost billing detected across ${fraudCheckResult.checked_claims} claims`}
        </div>
      )}

      {/* Main column (fraud patterns + claims) + sidebar (timeline) — fills
          whatever's left of the fixed-height screen; only the claims table and
          timeline scroll internally, the page itself never scrolls (lg+). */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 lg:flex-1 lg:min-h-0">
        <div className="min-w-0 lg:h-full lg:min-h-0 lg:flex lg:flex-col">
          {/* Fraud Patterns — toggled by the "Fraud patterns" button in the AI strip
              above; the panel renders here (above the claims table) only when open. */}
          {patternsOpen && (
            <div className="shrink-0 mb-4">
              <div className="mc-card overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-100">
                  <h2 className="text-sm font-bold text-slate-900">Fraud patterns detected</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    {!patternsEmpty && (
                      <span className="text-[12px] font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full tabular-nums">
                        {patternsCount} rule{patternsCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    <button type="button" onClick={() => setPatternsOpen(false)} title="Close"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-[#0A1F3D] hover:bg-slate-100 transition-colors">
                      <Icon name="x" size={15} stroke={2} />
                    </button>
                  </div>
                </div>
                <div className="px-4 sm:px-5 py-3.5 max-h-[340px] overflow-y-auto">
                  {patternsEmpty ? <div className="text-xs text-slate-400">{patternsResult}</div> : patternsResult.nodes}
                </div>
              </div>
            </div>
          )}

          {/* Dimmed backdrop behind the popped-open claims card — click to settle back */}
          {claimsPopped && (
            <div className="fixed inset-0" style={{ background: 'rgba(10,31,61,0.35)', zIndex: 999 }}
                 onClick={() => setClaimsPopped(false)} />
          )}
          <div ref={claimsRef}
               className={`mc-card overflow-hidden scroll-mt-20 ${claimsPopped ? 'flex flex-col' : 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'}`}
               style={claimsPopped ? {
                 position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                 width: 'min(1100px, 94vw)', height: 'min(760px, 88vh)',
                 zIndex: 1000, boxShadow: '0 28px 72px rgba(10,31,61,.38)',
               } : undefined}>
        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-sm font-bold text-slate-900">Claims ({(claimFilter || claimWindow || claimSupplier || categoryFilter || flagsFilter.length) ? `${sortedClaims.length} of ${npi.claims.length}` : npi.claims.length})</h2>
          <div className="flex items-center gap-3 shrink-0">
            {(claimFilter || claimWindow || claimSupplier || categoryFilter || flagsFilter.length > 0) && (
              <button onClick={() => { setClaimFilter(null); setClaimWindow(null); setClaimSupplier(null); setCategoryFilter(''); setFlagsFilter([]) }} className="text-[11px] font-semibold text-[#0A1F3D] hover:underline whitespace-nowrap">
                Clear ✕
              </button>
            )}
            <button onClick={() => setClaimsPopped((v) => !v)}
                    title={claimsPopped ? 'Collapse' : 'Expand'}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-[#0A1F3D] hover:bg-slate-100 transition-colors">
              <Icon name={claimsPopped ? 'minimize' : 'maximize'} size={15} stroke={2} />
            </button>
          </div>
        </div>

        {/* Scroll body — scrolls internally on lg+, or whenever the card is
            popped into the centered overlay */}
        <div className={claimsPopped ? 'flex-1 min-h-0 overflow-y-auto' : 'lg:flex-1 lg:min-h-0 lg:overflow-y-auto'}>

        {/* Mobile card view (< sm) */}
        <div className="sm:hidden divide-y divide-slate-100">
          {sortedClaims.map((c) => {
            const shown = (c.flags || []).filter((f) => !HIDDEN_FLAGS.includes(f))
            return (
              <div key={c.id} id={`claimrow-${c.id}`}
                   className={`px-4 py-3 transition-colors ${c.id === highlightId ? 'bg-[#E9F0F6]' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800 truncate">{c.patient}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{fmtDate(c.date)}</div>
                  </div>
                  <div className="text-[13px] font-bold text-slate-800 tabular-nums whitespace-nowrap shrink-0">{fmtUSD(c.amount, 2)}</div>
                </div>
                {c.description && (
                  <div className="text-[11px] text-slate-600 mb-1.5 line-clamp-2 leading-snug">{c.description}</div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <CategoryTag category={c.category} />
                  {c.supplier && <span className="text-[11px] text-slate-500 truncate max-w-[160px]">{c.supplier}</span>}
                  {shown.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {shown.map((f) => (
                        <FlagChip key={f} code={f} rulesFired={npi.rulesFired} onClick={() => onFlagClick(c, f)} />
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

        {/* Desktop table (sm+). overflow-x only below lg — an overflow-x-auto
            wrapper would break the thead's sticky positioning against the lg
            internal scroll container. */}
        <div className="hidden sm:block overflow-x-auto lg:overflow-x-visible">
          <table className="w-full">
            <thead className="lg:sticky lg:top-0 lg:z-10">
              <tr className="border-b-2 border-slate-200 bg-[#F1F4F9]">
                {CLAIM_COLUMNS.map((c) => {
                  // Category/Flags headers ARE their column's filter (dropdown);
                  // the rest keep the plain sort toggle.
                  if (c.key === 'category') return (
                    <ClaimFilterTh key={c.key} label={c.label} options={categoryOptions}
                                   value={categoryFilter} onChange={setCategoryFilter} cls={c.cls || ''} />
                  )
                  if (c.key === 'flags') return (
                    <ClaimFilterTh key={c.key} label={c.label} options={flagOptions}
                                   value={flagsFilter} onChange={setFlagsFilter} multi alignRight cls={c.cls || ''} />
                  )
                  const active = claimSort.key === c.key
                  return (
                    <th key={c.key} onClick={() => onClaimSort(c.key)}
                        className={`th cursor-pointer select-none group ${c.right ? 'text-right' : ''} ${c.cls || ''}`}>
                      <span className="inline-flex items-center gap-1 group-hover:text-[#0A1F3D] transition-colors">
                        {c.label}
                        {active
                          ? <span className="text-[#0A1F3D]">{claimSort.dir === 'asc' ? '↑' : '↓'}</span>
                          : <span className="text-slate-300 group-hover:text-slate-500 transition-colors">↕</span>}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedClaims.map((c) => (
                <tr key={c.id} id={`claimrow-${c.id}`}
                    className={`transition-colors ${c.id === highlightId ? 'bg-[#E9F0F6] ring-1 ring-inset ring-[#D2E1EB]' : 'hover:bg-slate-50'}`}>
                  <td className="td text-xs tabular-nums whitespace-nowrap">{fmtDate(c.date)}</td>
                  <td className="td hidden sm:table-cell text-sm font-medium text-slate-700">{c.patient}</td>
                  <td className="td hidden md:table-cell text-xs">{c.description}</td>
                  <td className="td hidden sm:table-cell"><CategoryTag category={c.category} /></td>
                  <td className="td hidden lg:table-cell text-xs text-slate-600">{c.supplier}</td>
                  <td className="td text-right font-bold text-slate-800 tabular-nums">{fmtUSD(c.amount, 2)}</td>
                  <td className="td">
                    <div className="flex items-center gap-1 flex-wrap">
                      {(() => {
                        const shown = (c.flags || []).filter((f) => !HIDDEN_FLAGS.includes(f))
                        return shown.length === 0 ? <span className="text-slate-300">—</span>
                        : shown.map((f) => (
                          <FlagChip key={f} code={f} rulesFired={npi.rulesFired} onClick={() => onFlagClick(c, f)} />
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
          </div>
        </div>

        <div className="min-w-0 lg:h-full lg:min-h-0 lg:flex lg:flex-col">
          {/* Physician Feedback Timeline */}
          <div ref={timelineRef} className="mc-card overflow-hidden flex flex-col max-h-[460px] lg:max-h-none lg:flex-1 lg:min-h-0">
            <button type="button" onClick={() => setTimelineOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-4 sm:px-5 py-3.5 hover:bg-slate-50 transition-colors border-b border-slate-100 shrink-0">
              <h2 className="text-sm font-bold text-slate-900">Physician feedback timeline</h2>
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
              <div className="px-4 sm:px-5 pb-3.5 overflow-y-auto flex-1 min-h-0">
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
                                  <span className="text-xs text-slate-600">·{' '}
                                    <button type="button" onClick={() => openSupplier(a.supplier)}
                                            className="font-bold text-[#0A1F3D] rounded px-0.5 transition-colors hover:bg-[#0A1F3D]/[0.08] hover:underline cursor-pointer max-w-[130px] sm:max-w-none truncate inline-block align-bottom">
                                      {a.supplier}
                                    </button>
                                  </span>
                                )}
                                {a.patient && <span className="text-xs text-slate-600 truncate max-w-[100px] sm:max-w-none">· {a.patient}</span>}
                              </div>
                              <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap shrink-0">{timeAgo(a.ts)}</span>
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
      </div>

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
