// Shared UI primitives for the MedClaim Analytics light theme.
import { useState, useEffect, useRef } from 'react'
import { bandByName, riskBand } from '../lib/risk'

const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  leaderboard: <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
  suppliers: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  alerts: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
  claims: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></>,
  search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
  alertTri: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  check: <polyline points="20 6 9 17 4 12"/>,
  x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  userx: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></>,
  ban: <><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></>,
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>,
  chevronRight: <polyline points="9 18 15 12 9 6"/>,
  chevronDown:  <polyline points="6 9 12 15 18 9"/>,
  refresh: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
  quote: <><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></>,
  message: <path d="M21 11.5a8.38 8.38 0 0 1-4.9 7.6 8.38 8.38 0 0 1-3.8.9 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8-8.5h.5a8.48 8.48 0 0 1 8 8v.5z"/>,
  sparkle: <><path d="M12 3l1.6 4.6L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.4L12 3z"/><path d="M19 3v3"/><path d="M20.5 4.5h-3"/></>,
  shieldAlert: <><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>,
  mail: <><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
  edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
  chevronUp: <polyline points="18 15 12 9 6 15"/>,
  sort: <><polyline points="7 8 12 3 17 8"/><polyline points="7 16 12 21 17 16"/></>,
  package: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
  pill: <><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></>,
  heartOff: <><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/><line x1="4" y1="4" x2="20" y2="20"/></>,
  hospital: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8"/><path d="M8 12h8"/></>,
  maximize: <><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/></>,
  minimize: <><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></>,
  bot: <><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
  arrowUpRight: <><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></>,
  arrowDownLeft: <><line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/></>,
}

export function Icon({ name, size = 18, stroke = 1.9, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      {ICONS[name] || null}
    </svg>
  )
}

export const fmtUSD = (n, dp = 0) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: dp }).format(n || 0)

// Strips "claim"/"#" noise so typing the on-screen label verbatim (e.g. "Claim
// 26161007820", as shown next to every claim number in the UI) still matches
// the bare claim_number field it's compared against, instead of silently
// finding nothing because the word "claim" isn't part of the stored value.
export const normalizeSearchQuery = (s) =>
  (s || '').toLowerCase().replace(/\bclaim\b/g, '').replace(/#/g, '').replace(/\s+/g, ' ').trim()

// Mirrors backend/routers/dashboard.py's COMPLIANCE_ACTION_LABEL exactly — the
// four decisions compliance can log on an escalated case (payer portal's
// Dispute Detail "Compliance action" panel), keyed by the action code stored
// in the COMPLIANCE_ACTION event's response_type.
export const COMPLIANCE_ACTION_LABEL = {
  REFER_TO_MEDICARE:   'Referred to Medicare',
  SUSPEND_SUPPLIER:    'Vendor enrollment suspended',
  REQUEST_DOCS:        'Requested more documentation',
  CLOSE_INVESTIGATION: 'Investigation closed',
}

// Turns a dispute case's event log (backend/models.py DisputeCaseEvent, one row
// per state transition — opened, each vendor response, each physician confirm/
// reject, each auto-escalation) into timeline entries worded for whichever
// portal is looking at it. `who` is 'physician' | 'vendor' | null (payer/
// compliance gets neutral third-person wording). Shared across all three
// portals' timelines so the wording rules — e.g. only the physician and payer
// see the vendor's "resolved with physician" note/docs, never the "responded
// to Medicare" ones, since that submission is between the vendor and Medicare —
// can't drift out of sync between the three implementations.
// `type` on each entry is a portal-agnostic tag for step icon/color (see
// PCTL_STEP_STYLE in App.jsx's physician timeline) — vendor/payer renderers
// can ignore it, but adding it here once keeps all three consistent instead
// of re-deriving it from label text per-portal.
export function buildDisputeTimeline(d, who) {
  const events = d.events || []
  return events.map((e) => {
    const at = e.created_at
    switch (e.event_type) {
      case 'DISPUTE_OPENED': {
        // Vendor never sees this entry's real flavor or note — their portal is
        // type-blind (dispute_type/notes arrive nulled from the backend), so
        // for them this reads as a neutral documents-required kickoff.
        if (who === 'vendor') {
          return { at, label: 'Supporting documents requested for this claim', type: 'dispute' }
        }
        const kind = d.dispute_type === 'FRAUD_REPORT' ? 'fraud'
          : d.dispute_type === 'DECEASED_PATIENT' ? 'deceased'
          : 'dispute'
        const verb = kind === 'fraud' ? 'reported this as fraud'
          : kind === 'deceased' ? 'reported the patient as deceased'
          : 'disputed this claim'
        const label = who === 'physician' ? `You ${verb}` : `Physician ${verb}`
        return { at, label, note: e.note, type: kind }
      }
      case 'VENDOR_RESPONDED': {
        // The vendor's only response is uploading proof-of-work documents.
        const label =
          who === 'vendor' ? 'You uploaded proof-of-work documents'
          : who === 'physician' ? 'Vendor uploaded proof-of-work documents'
          : 'Vendor uploaded proof-of-work documents'
        return { at, label, detail: e.note, docs: e.docs, type: 'vendorResponse' }
      }
      case 'PHYSICIAN_CONFIRMED':
        return { at, label: who === 'physician' ? 'You approved the documents — case resolved' : 'Physician approved the documents — case resolved', type: 'confirmed' }
      case 'PHYSICIAN_REJECTED':
        return {
          at,
          label: who === 'physician' ? 'You declined the documents — referred to the payer'
            : who === 'vendor' ? 'This claim has been referred for further review'
            : "Physician declined the vendor's documents — referred to you",
          note: e.note,
          type: 'rejected',
        }
      case 'NON_RESPONSIVE':
        return { at, label: who === 'vendor' ? 'Response window closed — escalated to compliance' : 'Vendor did not respond in time — escalated to compliance', type: 'escalated' }
      case 'COMPLIANCE_ACTION':
        return { at, label: COMPLIANCE_ACTION_LABEL[e.response_type] || 'Compliance action recorded', detail: e.note, type: 'compliance' }
      case 'CONFIRMATION_EXPIRED':
        return {
          at,
          label: who === 'physician' ? 'Your confirmation window expired — case reopened automatically'
            : who === 'vendor' ? "Physician's confirmation window expired — case reopened"
            : "Physician's confirmation window expired — case reopened automatically",
          type: 'expired',
        }
      default:
        return null
    }
  }).filter(Boolean)
}

// Backend sends naive UTC ISO strings (no 'Z'); mark them UTC so the browser
// doesn't misread them as local time.
function toDate(d) {
  if (typeof d === 'string' && d.includes('T') && !/[zZ]|[+-]\d\d:?\d\d$/.test(d)) d += 'Z'
  return new Date(d)
}

export const fmtDate = (d) => {
  if (!d) return '—'
  const dt = toDate(d)
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

export function timeAgo(d) {
  const t = toDate(d).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s} sec ago`
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
  const dd = Math.floor(h / 24); return `${dd} day${dd > 1 ? 's' : ''} ago`
}

const ACCENTS = {
  navy:   { chip: 'bg-slate-100 text-ink',          line: '#1B3A5C', ring: 'group-hover:ring-slate-300',   bar: 'bg-slate-600',   chevDot: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 group-hover:bg-[#1B3A5C] group-hover:text-white group-hover:ring-[#1B3A5C]' },
  rose:   { chip: 'bg-rose-50 text-rose-500',       line: '#f43f5e', ring: 'group-hover:ring-rose-300',    bar: 'bg-rose-400',    chevDot: 'bg-rose-50 text-rose-400 ring-1 ring-rose-200 group-hover:bg-rose-500 group-hover:text-white group-hover:ring-rose-500' },
  amber:  { chip: 'bg-amber-50 text-amber-500',     line: '#f59e0b', ring: 'group-hover:ring-amber-300',   bar: 'bg-amber-400',   chevDot: 'bg-amber-50 text-amber-400 ring-1 ring-amber-200 group-hover:bg-amber-500 group-hover:text-white group-hover:ring-amber-500' },
  blue:   { chip: 'bg-blue-50 text-blue-500',       line: '#3b82f6', ring: 'group-hover:ring-blue-300',    bar: 'bg-blue-400',    chevDot: 'bg-blue-50 text-blue-400 ring-1 ring-blue-200 group-hover:bg-blue-500 group-hover:text-white group-hover:ring-blue-500' },
  emerald:{ chip: 'bg-emerald-50 text-emerald-500', line: '#10b981', ring: 'group-hover:ring-emerald-300', bar: 'bg-emerald-400', chevDot: 'bg-emerald-50 text-emerald-500 ring-1 ring-emerald-200 group-hover:bg-emerald-600 group-hover:text-white group-hover:ring-emerald-600' },
}

// tiny deterministic sparkline (no randomness)
function Spark({ color }) {
  const pts = [6, 10, 7, 12, 9, 14, 11, 16].map((y, i) => `${i * 14},${24 - y}`).join(' ')
  return (
    <svg width="100%" height="28" viewBox="0 0 98 24" preserveAspectRatio="none" className="mt-3">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
    </svg>
  )
}

export function StatCard({ icon, label, value, accent = 'navy', valueClass = '', spark = true, loading, onClick, accentBar = true }) {
  const a = ACCENTS[accent] || ACCENTS.navy
  const isClickable = !!onClick
  const inner = (
    <>
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${a.chip}`}>
          <Icon name={icon} size={15} />
        </div>
        {isClickable && (
          <span className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-200 group-hover:translate-x-0.5 ${a.chevDot}`}>
            <Icon name="chevronRight" size={12} stroke={2.5} />
          </span>
        )}
      </div>
      <div className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none truncate">{label}</div>
      {loading
        ? <div className="h-6 sm:h-7 w-16 rounded bg-slate-100 animate-pulse mt-1.5" />
        : <div className={`text-display text-[1.15rem] sm:text-2xl font-bold tabular-nums mt-1 text-slate-900 min-w-0 break-words leading-tight ${valueClass}`}>{value}</div>}
      {spark && <Spark color={a.line} />}
    </>
  )
  if (onClick) {
    return (
      <button onClick={onClick}
              className={`group relative mc-card p-3 sm:p-4 text-left w-full cursor-pointer overflow-hidden transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-6px_rgba(15,23,42,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40`}>
        {accentBar && <span className={`absolute inset-y-0 left-0 w-[3px] ${a.bar}`} aria-hidden />}
        {inner}
      </button>
    )
  }
  return <div className="group mc-card p-3 sm:p-4 overflow-hidden transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-6px_rgba(15,23,42,0.12)]">{inner}</div>
}

export function RiskPill({ band, score }) {
  // A caller-supplied band wins (rows that carry one from the API); otherwise
  // derive it from the score. Either way the classification comes from lib/risk.
  const b = band ? bandByName(band) : riskBand(score)
  return (
    <span className={`pill ${b.pill}`}>
      <Icon name="shieldAlert" size={11} stroke={2.4} />
      {score != null && <span className="tabular-nums">{score}</span>}{b.label}
    </span>
  )
}

const PLAN_STATUS = {
  pending:       { cls: 'pill-medium', label: 'Pending', icon: 'clock' },
  under_review:  { cls: 'pill-high',   label: 'Under Review', icon: 'alertTri' },
  acknowledged:  { cls: 'pill-low',    label: 'Acknowledged', icon: 'check' },
  case_opened:   { cls: 'pill-critical', label: 'Case Opened', icon: 'flag' },
  dismissed:     { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'Dismissed', icon: 'x' },
}
export function PlanStatusPill({ status }) {
  const s = PLAN_STATUS[status] || PLAN_STATUS.pending
  return <span className={`pill ${s.cls}`}><Icon name={s.icon} size={11} stroke={2.5} />{s.label}</span>
}

export function SearchInput({ value, onChange, placeholder, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
        <Icon name="search" size={15} />
      </span>
      <input value={value} onChange={onChange} placeholder={placeholder}
             className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/15 transition" />
    </div>
  )
}

// ─── Filter-dropdown table header ────────────────────────────────────────────
// A table column header that IS the filter, opening a right-anchored dropdown on
// click. Shared by the payer NPI-Disputes table and the physician My-Disputes
// table (both use the unscoped .pselect-panel/.poption/.pbadge recipe). Mirrors
// the vendor portal's own scoped FilterTh.
const FILTER_TH_CLASS = 'text-left py-2.5 px-3.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-slate-400 bg-slate-50 border-b border-slate-100 whitespace-nowrap'

export function PFilterOptionsPanel({ options, value, onChange }) {
  const [indicator, setIndicator] = useState({ top: 0, height: 0, opacity: 0 })
  return (
    <div className="pselect-panel">
      <div className="poptions" onMouseLeave={() => setIndicator((i) => ({ ...i, opacity: 0 }))}>
        <div className="phover-indicator" style={{ top: indicator.top, height: indicator.height, opacity: indicator.opacity }} />
        {options.map((opt) => (
          <div
            key={opt.id}
            className={`poption ${opt.id === value ? 'selected' : ''}`}
            onMouseEnter={(e) => setIndicator({ top: e.currentTarget.offsetTop, height: e.currentTarget.offsetHeight, opacity: 1 })}
            onClick={() => onChange(opt.id)}
          >
            <span className="poption-left truncate">
              {opt.dot && <span className="pdot" style={{ background: opt.dot }} />}
              {opt.label}
            </span>
            <Icon name="check" size={14} className="pcheck" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function PFilterTh({ label, options, value, onChange, defaultValue = 'ALL' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = value && value !== defaultValue

  useEffect(() => {
    if (!open) return
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <th ref={ref} className={FILTER_TH_CLASS} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 cursor-pointer"
        style={{ color: open || active ? '#1B3A5C' : 'inherit', font: 'inherit' }}
      >
        {label}
        <Icon name="chevronDown" size={10} className="text-slate-300" style={{ opacity: open || active ? 1 : 0.6, transition: 'transform .15s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <PFilterOptionsPanel options={options} value={value} onChange={(id) => { onChange(id); setOpen(false) }} />}
    </th>
  )
}
