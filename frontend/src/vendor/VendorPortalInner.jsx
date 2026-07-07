import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Shell from '../components/Shell'
import { Icon, StatCard, fmtUSD, fmtDate, timeAgo } from '../components/ui'
import {
  API_BASE,
  getVendorStats,
  getVendorClaims,
  getVendorDisputes,
  submitVendorResponse,
} from '../api'

const VENDOR_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'claims',    label: 'My Claims', icon: 'claims'    },
  { id: 'disputes',  label: 'Disputes',  icon: 'alertTri'  },
]

const STATUS_COLORS = {
  PENDING:        'bg-amber-100 text-amber-700',
  CONFIRMED:      'bg-emerald-100 text-emerald-700',
  DISPUTED:       'bg-red-100 text-red-700',
  FRAUD_REPORTED: 'bg-rose-900/10 text-rose-800',
}

function StatusBadge({ status }) {
  const cls = STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'
  const label = status?.replace(/_/g, ' ') || '—'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>
}

function DaysChip({ days, passed }) {
  if (passed) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700">OVERDUE</span>
  if (days > 7) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">{days}d left</span>
  if (days > 3) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">{days}d left</span>
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">{days}d left</span>
}

function Spinner() {
  return (
    <svg className="animate-spin text-slate-400" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardScreen({ stats, claims, loading, error, onViewAllClaims, onViewDisputes }) {
  const recentClaims = claims.slice(0, 10)

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
        <div className="mc-card bg-rose-50 border-rose-200 px-5 py-4">
          <p className="text-sm font-semibold text-rose-600">Failed to load dashboard</p>
          <p className="text-xs text-slate-500 mt-1">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-7 py-5 space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon="claims"    label="Total Claims"    value={stats?.total_claims ?? 0}      accent="navy"    spark={false} />
        <StatCard icon="check"     label="Confirmed Rate"  value={`${stats?.confirmed_rate ?? 0}%`} accent="emerald" spark={false} />
        <StatCard icon="alertTri"  label="Open Disputes"   value={stats?.open_disputes ?? 0}     accent="amber"   spark={false} />
        <StatCard icon="clock"     label="Overdue"         value={stats?.overdue_disputes ?? 0}  accent="rose"    spark={false} />
      </div>

      {/* Dispute alert banner */}
      {stats?.open_disputes > 0 && (
        <button
          onClick={onViewDisputes}
          className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 ring-1 ring-amber-300 hover:bg-amber-100 transition-colors"
        >
          <Icon name="alertTri" size={18} className="text-amber-600 shrink-0" />
          <span className="text-[13px] font-semibold text-amber-800">
            You have {stats.open_disputes} open dispute{stats.open_disputes !== 1 ? 's' : ''} requiring a response.
            {stats.open_disputes > 0 && ' Click to view and respond.'}
          </span>
          <Icon name="chevronRight" size={14} className="ml-auto text-amber-500 shrink-0" />
        </button>
      )}

      {/* Recent claims */}
      <div className="mc-card">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <span className="text-[13px] font-bold text-slate-800">Recent Claims</span>
          <button onClick={onViewAllClaims} className="text-[12px] font-semibold text-[#1a3d7c] hover:underline">
            View all →
          </button>
        </div>
        {recentClaims.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-slate-400">No claims on file.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-2.5">Claim #</th>
                  <th className="px-3 py-2.5">Patient</th>
                  <th className="px-3 py-2.5">Service</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentClaims.map((c) => (
                  <tr key={c.notification_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-[11px] text-slate-700">{c.claim_number}</td>
                    <td className="px-3 py-3 text-slate-600">{c.patient_name_partial || '—'}</td>
                    <td className="px-3 py-3 text-slate-600 max-w-[180px] truncate">{c.service_description || '—'}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-800">{fmtUSD(c.amount_billed)}</td>
                    <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{fmtDate(c.dos_from)}</td>
                    <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Claims list ──────────────────────────────────────────────────────────────
const STATUS_FILTER_OPTIONS = ['ALL', 'PENDING', 'CONFIRMED', 'DISPUTED', 'FRAUD_REPORTED']

function ClaimsScreen({ claims, statusFilter, setStatusFilter, claimSearch, setClaimSearch, loading, onSelectClaim }) {
  const filtered = claims.filter((c) => {
    const matchStatus = statusFilter === 'ALL' || c.status === statusFilter
    const matchSearch = !claimSearch || c.claim_number?.toLowerCase().includes(claimSearch.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {STATUS_FILTER_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                statusFilter === s
                  ? 'bg-[#1a3d7c] text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {s === 'ALL' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <input
          value={claimSearch}
          onChange={(e) => setClaimSearch(e.target.value)}
          placeholder="Search by claim #…"
          className="ml-auto px-3 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-700 placeholder-slate-400 outline-none focus:border-[#1a3d7c]/40 focus:ring-2 focus:ring-[#1a3d7c]/10 bg-white w-48"
        />
      </div>

      <div className="mc-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-slate-400">No claims match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-3">Claim #</th>
                  <th className="px-3 py-3">Patient</th>
                  <th className="px-3 py-3">Service</th>
                  <th className="px-3 py-3 text-right">Billed</th>
                  <th className="px-3 py-3">DOS</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((c) => (
                  <tr
                    key={c.notification_id}
                    onClick={() => onSelectClaim(c)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-5 py-3 font-mono text-[11px] text-slate-700">{c.claim_number}</td>
                    <td className="px-3 py-3 text-slate-600">{c.patient_name_partial || '—'}</td>
                    <td className="px-3 py-3 text-slate-600 max-w-[200px] truncate">{c.service_description || '—'}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-800">{fmtUSD(c.amount_billed)}</td>
                    <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{fmtDate(c.dos_from)}</td>
                    <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Claim detail ─────────────────────────────────────────────────────────────
function ClaimDetailScreen({ claim, disputes, onViewDispute }) {
  if (!claim) return <div className="px-7 py-8 text-slate-400">No claim selected.</div>

  const relatedDispute = disputes.find(
    (d) => d.claim_number === claim.claim_number
  )

  return (
    <div className="px-4 sm:px-7 py-5 max-w-3xl">
      <div className="mc-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-slate-900">Claim {claim.claim_number}</h2>
          <StatusBadge status={claim.status} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-[13px]">
          {[
            ['Patient',          claim.patient_name_partial || '—'],
            ['Service',          claim.service_description  || '—'],
            ['Date of Service',  `${fmtDate(claim.dos_from)} — ${fmtDate(claim.dos_to)}`],
            ['Physician NPI',    claim.physician_npi || '—'],
            ['Physician Role',   claim.physician_npi_role || '—'],
            ['Amount Billed',    fmtUSD(claim.amount_billed)],
            ['Amount Paid',      fmtUSD(claim.amount_paid)],
            ['Notification',     fmtDate(claim.created_at)],
            ['Response',         claim.response_at ? fmtDate(claim.response_at) : '—'],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-slate-50 pb-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
              <div className="font-medium text-slate-800">{value}</div>
            </div>
          ))}
        </div>

        {relatedDispute && (
          <div className="pt-2">
            <button
              onClick={() => onViewDispute(relatedDispute)}
              className="flex items-center gap-2 text-[13px] font-semibold text-[#1a3d7c] hover:underline"
            >
              <Icon name="alertTri" size={14} />
              View Dispute →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Disputes list ────────────────────────────────────────────────────────────
const DISPUTE_STATUS_COLORS = {
  OPEN:                 'bg-amber-100 text-amber-700',
  NON_RESPONSIVE:       'bg-red-100 text-red-700',
  RESPONDED_TO_MEDICARE: 'bg-emerald-100 text-emerald-700',
  RESOLVED_BY_PHYSICIAN: 'bg-emerald-100 text-emerald-700',
}

function DisputeStatusBadge({ status }) {
  const cls = DISPUTE_STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'
  const label = status?.replace(/_/g, ' ') || '—'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>
}

const DISPUTE_TYPE_OPTIONS = [
  { id: 'ALL',          label: 'All Types' },
  { id: 'DISPUTE',      label: 'Dispute' },
  { id: 'FRAUD_REPORT', label: 'Fraud Report' },
]

// Every non-OPEN, non-NON_RESPONSIVE status (RESPONDED_TO_MEDICARE, RESOLVED_BY_PHYSICIAN,
// CLOSED, REFERRED_OIG, ...) is bucketed under "Responded" for this simplified filter.
const DISPUTE_STATUS_OPTIONS = [
  { id: 'ALL',            label: 'All Statuses' },
  { id: 'OPEN',           label: 'Open' },
  { id: 'NON_RESPONSIVE', label: 'Non-Responsive' },
  { id: 'RESPONDED',      label: 'Responded' },
]
function statusBucket(status) {
  return status === 'OPEN' || status === 'NON_RESPONSIVE' ? status : 'RESPONDED'
}

// Only shown once "Responded" is picked — splits that bucket by which path the
// vendor took: straight to Medicare, or resolved with physician (including the
// PENDING_PHYSICIAN_CONFIRMATION cases still awaiting the physician's sign-off).
const RESPONSE_TYPE_OPTIONS = [
  { id: 'ALL',       label: 'All Responses' },
  { id: 'MEDICARE',  label: 'Responded to Medicare' },
  { id: 'PHYSICIAN', label: 'Responded to Physician' },
]
function responseTypeBucket(status) {
  if (status === 'RESPONDED_TO_MEDICARE') return 'MEDICARE'
  if (status === 'RESOLVED_BY_PHYSICIAN' || status === 'PENDING_PHYSICIAN_CONFIRMATION') return 'PHYSICIAN'
  return null
}

const DISPUTE_SORT_OPTIONS = [
  { id: 'NONE',      label: 'Default Order' },
  { id: 'DAYS_ASC',  label: 'Days Left: Low to High' },
  { id: 'DAYS_DESC', label: 'Days Left: High to Low' },
]

const filterSelectCls = 'px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-700 outline-none focus:border-[#1a3d7c]/40 focus:ring-2 focus:ring-[#1a3d7c]/10'

function DisputesScreen({ disputes, loading, typeFilter, setTypeFilter, statusFilter, setStatusFilter, responseTypeFilter, setResponseTypeFilter, sortOrder, setSortOrder, search, setSearch, onSelect }) {
  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  const filtered = disputes.filter((d) => {
    const matchType = typeFilter === 'ALL' || d.dispute_type === typeFilter
    const matchStatus = statusFilter === 'ALL' || statusBucket(d.status) === statusFilter
    const matchResponseType = statusFilter !== 'RESPONDED' || responseTypeFilter === 'ALL' || responseTypeBucket(d.status) === responseTypeFilter
    const matchSearch = !search
      || d.claim_number?.toLowerCase().includes(search.toLowerCase())
      || d.physician_notes?.toLowerCase().includes(search.toLowerCase())
    return matchType && matchStatus && matchResponseType && matchSearch
  })

  if (sortOrder === 'DAYS_ASC') {
    filtered.sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))
  } else if (sortOrder === 'DAYS_DESC') {
    filtered.sort((a, b) => (b.days_remaining ?? 0) - (a.days_remaining ?? 0))
  }

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4">
      {disputes.length === 0 ? (
        <div className="mc-card px-6 py-10 text-center text-[13px] text-slate-400">
          No disputes on file.
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterSelectCls}>
              {DISPUTE_TYPE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterSelectCls}>
              {DISPUTE_STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {statusFilter === 'RESPONDED' && (
              <select value={responseTypeFilter} onChange={(e) => setResponseTypeFilter(e.target.value)} className={filterSelectCls}>
                {RESPONSE_TYPE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            )}
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={filterSelectCls}>
              {DISPUTE_SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <div className="relative ml-auto w-full sm:w-auto sm:min-w-[220px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon name="search" size={13} /></span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search claim # or notes…"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-medium text-slate-700 placeholder-slate-400 outline-none focus:border-[#1a3d7c]/40 focus:ring-2 focus:ring-[#1a3d7c]/10"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="mc-card px-6 py-10 text-center text-[13px] text-slate-400">
              No disputes match these filters.
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((d) => (
                <div
                  key={d.case_id}
                  onClick={() => onSelect(d)}
                  className="mc-card p-5 flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer hover:border-slate-300 transition-colors"
                >
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-slate-900">Claim {d.claim_number}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d.dispute_type === 'FRAUD_REPORT' ? 'bg-rose-100 text-rose-700' : 'bg-orange-100 text-orange-700'}`}>
                        {d.dispute_type === 'FRAUD_REPORT' ? 'FRAUD REPORT' : 'DISPUTE'}
                      </span>
                      <DisputeStatusBadge status={d.status} />
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <DaysChip days={d.days_remaining} passed={d.deadline_passed} />
                      {d.billing_provider_notified_at && (
                        <span className="text-[11px] text-slate-400">
                          Notified {timeAgo(d.billing_provider_notified_at)}
                        </span>
                      )}
                    </div>
                    {d.physician_notes && (
                      <p className="text-[12px] text-slate-500 italic">"{d.physician_notes}"</p>
                    )}
                  </div>
                  {d.status === 'OPEN' && !d.deadline_passed && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelect(d) }}
                      className="shrink-0 px-4 py-2 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90"
                      style={{ backgroundColor: '#1a3d7c' }}
                    >
                      Respond
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Chronological history of a dispute case from the vendor's side — what the
// physician reported, when the vendor was notified, what they responded with
// (plus docs), and how the physician's confirmation loop played out. Mirrors
// the physician portal's own PhysicianDisputeTimeline (App.jsx) for parity.
function VendorDisputeTimeline({ dispute: d }) {
  const past = [
    { at: d.opened_at, label: d.dispute_type === 'FRAUD_REPORT' ? 'Physician reported this as fraud' : 'Physician disputed this claim', note: d.physician_notes },
    d.billing_provider_notified_at && { at: d.billing_provider_notified_at, label: 'You were notified — 15 days to respond' },
    d.vendor_responded_at && {
      at: d.vendor_responded_at,
      label: d.provider_response_type === 'RESPONDED_TO_MEDICARE' ? 'You responded to Medicare' : 'You resolved this directly with the physician',
      detail: d.vendor_response,
      docs: d.vendor_docs,
    },
    d.status === 'RESOLVED_BY_PHYSICIAN' && { at: d.closed_at || d.vendor_responded_at, label: 'Physician confirmed this was resolved' },
    !d.vendor_responded_at && (d.status === 'NON_RESPONSIVE' || d.deadline_passed) && { at: d.response_due_date, label: 'Response window closed — escalated to compliance' },
    !d.vendor_responded_at && !d.deadline_passed && !['OPEN', 'NON_RESPONSIVE'].includes(d.status) && { at: d.closed_at, label: d.status?.replace(/_/g, ' ') },
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at))

  const pending =
    d.status === 'PENDING_PHYSICIAN_CONFIRMATION' ? 'confirming'
    : d.status === 'OPEN' && !d.escalation_unlocked && !d.deadline_passed ? 'awaiting'
    : null

  return (
    <div className="space-y-3">
      {past.map((t, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full bg-[#1a3d7c]" />
            {(i < past.length - 1 || pending || (d.status === 'OPEN' && d.escalation_unlocked)) && <div className="w-px flex-1 bg-slate-200 mt-1" />}
          </div>
          <div className="pb-3 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[12px] font-semibold text-slate-800">{t.label}</span>
              <span className="text-[11px] text-slate-400">{fmtDate(t.at)}</span>
            </div>
            {t.note && <p className="text-[12px] text-slate-500 italic mt-0.5">"{t.note}"</p>}
            {t.detail && <p className="text-[12px] text-slate-600 mt-0.5">"{t.detail}"</p>}
            {t.docs?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1.5">
                {t.docs.map((doc) => (
                  <a key={doc.stored_name} href={`${API_BASE}/api/v1/vendor/disputes/${d.case_id}/docs/${doc.stored_name}`}
                     target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-[11px] font-medium text-slate-600 hover:bg-slate-200 transition-colors">
                    <Icon name="doc" size={11} /> {doc.filename} <span className="text-slate-400">({fmtFileSize(doc.size)})</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {pending === 'confirming' && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full bg-[#1a3d7c] ring-4 ring-[#1a3d7c]/15" />
          </div>
          <div className="min-w-0">
            <span className="text-[12px] font-semibold text-navy">Awaiting physician confirmation</span>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {d.physician_confirmation_due_date ? `They have until ${fmtDate(d.physician_confirmation_due_date)} to confirm or reject this.` : 'Waiting on the physician to confirm this is resolved.'}
              {' '}If they don't confirm it, this case reopens and you'll be able to respond to Medicare directly instead.
            </p>
          </div>
        </div>
      )}

      {pending === 'awaiting' && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full bg-slate-300" />
          </div>
          <span className="text-[12px] font-medium text-slate-400">
            Awaiting your response{d.days_remaining != null ? ` · ${d.days_remaining}d left` : ''}
          </span>
        </div>
      )}

      {d.status === 'OPEN' && d.escalation_unlocked && (
        <div className="flex gap-3">
          <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
            <div className="w-2 h-2 rounded-full bg-rose-500" />
          </div>
          <div className="min-w-0">
            <span className="text-[12px] font-semibold text-rose-700">Physician didn't confirm — case reopened</span>
            <p className="text-[12px] text-slate-500 mt-0.5">
              You can now respond to Medicare directly instead, or try resolving with the physician again.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Dispute detail + response form ──────────────────────────────────────────
function fmtFileSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DisputeDetailScreen({
  dispute,
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
}) {
  if (!dispute) return <div className="px-7 py-8 text-slate-400">No dispute selected.</div>

  const canRespond = dispute.status === 'OPEN' && !dispute.deadline_passed

  return (
    <div className="px-4 sm:px-7 py-5 space-y-5">
      {/* Dispute info card */}
      <div className="mc-card p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Case #{dispute.case_id} — Claim {dispute.claim_number}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${dispute.dispute_type === 'FRAUD_REPORT' ? 'bg-rose-100 text-rose-700' : 'bg-orange-100 text-orange-700'}`}>
                {dispute.dispute_type === 'FRAUD_REPORT' ? 'FRAUD REPORT' : 'DISPUTE'}
              </span>
              <DisputeStatusBadge status={dispute.status} />
              <DaysChip days={dispute.days_remaining} passed={dispute.deadline_passed} />
            </div>
          </div>
        </div>

      </div>

      {/* Full history of the case, not just the current status — what the physician
          reported, when you were notified, what you responded with (and any docs),
          and how it was resolved. */}
      <div className="mc-card p-5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">Timeline</h3>
        <VendorDisputeTimeline dispute={dispute} />
      </div>

      {/* Claim details — same info the vendor sees for any claim in My Claims, so
          they can actually recognize which order/patient/service this is about. */}
      {dispute.claim && (
        <div className="mc-card p-5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">Claim Details</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-[13px]">
            {[
              ['Patient',           dispute.claim.patient_name_partial || '—'],
              ['Service',           dispute.claim.service_description || '—'],
              ['HCPCS Codes',       Array.isArray(dispute.claim.hcpcs_codes) ? (dispute.claim.hcpcs_codes.join(', ') || '—') : (dispute.claim.hcpcs_codes || '—')],
              ['Date of Service',   dispute.claim.dos_from || dispute.claim.dos_to ? `${fmtDate(dispute.claim.dos_from)} — ${fmtDate(dispute.claim.dos_to)}` : '—'],
              ['Amount Billed',     fmtUSD(dispute.claim.amount_billed)],
              ['Amount Paid',       fmtUSD(dispute.claim.amount_paid)],
              ['Physician',         dispute.claim.physician_name || '—'],
              ['Physician NPI',     dispute.claim.physician_npi || '—'],
              ['Physician Role',    dispute.claim.physician_npi_role || '—'],
              ['Practice',          dispute.claim.physician_practice || '—'],
            ].map(([label, value]) => (
              <div key={label} className="border-b border-slate-50 pb-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
                <div className="font-medium text-slate-800">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Case reopened because the physician rejected the vendor's "Resolve with
          the physician" attempt — make that explicit instead of leaving the vendor
          to infer it from escalation_unlocked + a status that just says "OPEN". */}
      {dispute.status === 'OPEN' && dispute.escalation_unlocked && (
        <div className="mc-card p-5 bg-rose-50 border-rose-200 space-y-1">
          <div className="flex items-center gap-2">
            <Icon name="alertTri" size={16} className="text-rose-600" />
            <span className="text-[13px] font-bold text-rose-800">Physician rejected your resolution</span>
          </div>
          <p className="text-[12px] text-rose-700">
            The physician reviewed your "Resolve with the physician" response below and did not confirm it resolved the dispute. The case has reopened — you can now respond to Medicare directly instead, or try resolving with the physician again.
          </p>
        </div>
      )}

      {/* Submit success */}
      {submitResult && (
        <div className="mc-card p-5 bg-emerald-50 border-emerald-200">
          <div className="flex items-center gap-2">
            <Icon name="check" size={16} className="text-emerald-600" />
            <span className="text-[13px] font-bold text-emerald-800">Response submitted successfully</span>
          </div>
          <p className="text-[12px] text-emerald-700 mt-1">Status updated to: <strong>{submitResult.status?.replace(/_/g, ' ')}</strong></p>
        </div>
      )}

      {/* Response form */}
      {canRespond && !submitResult && (
        <div className="mc-card p-5 space-y-4">
          <h3 className="text-[14px] font-bold text-slate-900">Submit Your Response</h3>
          {!dispute.escalation_unlocked && (
            <p className="text-[12px] text-slate-500 -mt-2">
              Try resolving this with the physician first. If they don't confirm it's resolved, you'll get the option to respond to Medicare directly instead.
            </p>
          )}

          <div className={`grid grid-cols-1 gap-3 ${dispute.escalation_unlocked ? 'sm:grid-cols-2' : ''}`}>
            {[
              dispute.escalation_unlocked && {
                type: 'RESPONDED_TO_MEDICARE',
                title: 'I responded to Medicare directly',
                desc: 'You have contacted Medicare and submitted a correction, resubmission, or audit response.',
              },
              {
                type: 'RESOLVED_WITH_PHYSICIAN',
                title: 'Resolve with the physician',
                desc: "Sends your response to the physician here in the app. They'll review it and confirm whether this resolves the dispute.",
              },
            ].filter(Boolean).map((opt) => (
              <button
                key={opt.type}
                onClick={() => setResponseType(opt.type)}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  responseType === opt.type
                    ? 'border-[#1a3d7c] bg-[#EEF2F7]'
                    : 'border-slate-200 hover:border-[#1a3d7c]/40 bg-white'
                }`}
              >
                <div className={`text-[12px] font-bold mb-1 ${responseType === opt.type ? 'text-[#1a3d7c]' : 'text-slate-800'}`}>
                  {opt.title}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">{opt.desc}</p>
              </button>
            ))}
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Additional Notes (optional)
            </label>
            <textarea
              value={vendorResponseText}
              onChange={(e) => setVendorResponseText(e.target.value)}
              rows={3}
              placeholder="Describe any actions taken or provide reference numbers…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-[#1a3d7c]/40 focus:ring-2 focus:ring-[#1a3d7c]/10 transition resize-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Supporting Documents (optional)
            </label>
            <label className="flex items-center justify-center gap-2 w-full px-3 py-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-[#1a3d7c]/40 text-[12px] text-slate-500 cursor-pointer transition-colors">
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
                    <button onClick={() => setDocFiles((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-500 transition-colors" aria-label={`Remove ${f.name}`}>
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3">
              <Icon name="alertTri" size={14} className="text-rose-500 mt-0.5 shrink-0" />
              <span className="text-[12px] text-rose-700">{submitError}</span>
            </div>
          )}

          <button
            onClick={onSubmit}
            disabled={!responseType || submitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#1a3d7c' }}
          >
            {submitting ? <><Spinner />Submitting…</> : 'Submit Response'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main portal component ────────────────────────────────────────────────────
export default function VendorPortalInner() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [screen, setScreen] = useState(() => {
    try { return sessionStorage.getItem('vendor_screen') || 'dashboard' } catch { return 'dashboard' }
  })
  const [history, setHistory] = useState([])

  const [stats,         setStats]         = useState(null)
  const [claims,        setClaims]        = useState([])
  const [disputes,      setDisputes]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)

  const [selectedClaim,   setSelectedClaim]   = useState(null)
  const [selectedDispute, setSelectedDispute] = useState(null)

  const [statusFilter,  setStatusFilter]  = useState('ALL')
  const [claimSearch,   setClaimSearch]   = useState('')

  // Lifted (not local to DisputesScreen) so the filters/sort survive navigating into
  // a dispute's detail view and back — DisputesScreen unmounts while screen !== 'disputes'.
  const [disputeTypeFilter,     setDisputeTypeFilter]     = useState('ALL')
  const [disputeStatusFilter,   setDisputeStatusFilter]   = useState('ALL')
  const [disputeResponseType,   setDisputeResponseType]   = useState('ALL')
  const [disputeSortOrder,      setDisputeSortOrder]      = useState('NONE')
  const [disputeSearch,         setDisputeSearch]         = useState('')

  const [responseType,      setResponseType]      = useState(null)
  const [vendorResponseText, setVendorResponseText] = useState('')
  const [docFiles,          setDocFiles]          = useState([])
  const [submitting,        setSubmitting]        = useState(false)
  const [submitResult,      setSubmitResult]      = useState(null)
  const [submitError,       setSubmitError]       = useState(null)

  function navTo(s) {
    setHistory((h) => [...h, { screen }])
    try { sessionStorage.setItem('vendor_screen', s) } catch {}
    setScreen(s)
  }

  function goBack() {
    setHistory((h) => {
      if (!h.length) return h
      const prev = h[h.length - 1]
      try { sessionStorage.setItem('vendor_screen', prev.screen) } catch {}
      setScreen(prev.screen)
      return h.slice(0, -1)
    })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getVendorStats(), getVendorClaims(), getVendorDisputes()])
      .then(([s, c, d]) => {
        if (cancelled) return
        setStats(s)
        setClaims(c.claims || [])
        setDisputes(d.disputes || [])
        setError(null)
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Refresh on entering the detail screen — otherwise it just shows whatever was in
  // `disputes` when the list was last fetched, which goes stale the moment the
  // physician confirms/rejects/decides in a separate session (no live push here).
  useEffect(() => {
    if (screen !== 'disputeDetail') return
    let cancelled = false
    getVendorDisputes().then((d) => {
      if (cancelled) return
      const fresh = d.disputes || []
      setDisputes(fresh)
      setSelectedDispute((prev) => (prev ? fresh.find((x) => x.case_id === prev.case_id) || prev : prev))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [screen])

  async function handleRespond(caseId) {
    if (!responseType) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await submitVendorResponse(caseId, responseType, vendorResponseText, docFiles)
      setSubmitResult(result)
      setDisputes((prev) =>
        prev.map((d) => (d.case_id === caseId ? { ...d, status: result.status } : d))
      )
      if (selectedDispute?.case_id === caseId) {
        setSelectedDispute((prev) => ({ ...prev, status: result.status }))
      }
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
    DME:         'DME Supplier',
  }
  const vendorTypeLabel = stats?.vendor_type
    ? (VENDOR_TYPE_LABELS[stats.vendor_type] || stats.vendor_type)
    : null
  const vendorLocation = [stats?.vendor_city, stats?.vendor_state].filter(Boolean).join(', ')

  // Billing-contact rows shown in the profile dropdown.
  const profileRows = [
    { label: 'NPI',       value: user?.npi },
    { label: 'Specialty', value: vendorTypeLabel },
    { label: 'Location',  value: vendorLocation },
    { label: 'Name',      value: stats?.contact_name || user?.full_name },
    { label: 'Email',     value: stats?.contact_email || user?.email },
    { label: 'Role',      value: user?.role },
    { label: 'Vendor',    value: stats?.vendor_name },
  ]
  const SCREEN_TITLES = {
    dashboard:     supplierName,
    claims:        'My Claims',
    claimDetail:   'Claim Detail',
    disputes:      'Disputes',
    disputeDetail: 'Dispute Detail',
  }
  const navActiveId = screen === 'claimDetail' ? 'claims' : screen === 'disputeDetail' ? 'disputes' : screen

  return (
    <Shell
      navItems={VENDOR_NAV}
      activeId={navActiveId}
      onNavigate={navTo}
      title={SCREEN_TITLES[screen] || 'Vendor Portal'}
      user={user}
      subtitle={vendorTypeLabel ? `${vendorTypeLabel} · ${vendorLocation || '—'}` : 'Vendor Portal'}
      infoRows={profileRows}
      showSearch={false}
      notifCount={stats?.open_disputes || 0}
      bellTitle="Open disputes"
      onBellClick={() => navTo('disputes')}
      canGoBack={history.length > 0 && screen !== 'dashboard'}
      onBack={goBack}
      onLogout={async () => { await logout(); navigate('/welcome', { replace: true }) }}
    >
      {screen === 'dashboard' && (
        <DashboardScreen
          stats={stats}
          claims={claims}
          loading={loading}
          error={error}
          onViewAllClaims={() => navTo('claims')}
          onViewDisputes={() => navTo('disputes')}
        />
      )}
      {screen === 'claims' && (
        <ClaimsScreen
          claims={claims}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          claimSearch={claimSearch}
          setClaimSearch={setClaimSearch}
          loading={loading}
          onSelectClaim={(c) => { setSelectedClaim(c); navTo('claimDetail') }}
        />
      )}
      {screen === 'claimDetail' && (
        <ClaimDetailScreen
          claim={selectedClaim}
          disputes={disputes}
          onViewDispute={(d) => {
            setSelectedDispute(d)
            setResponseType(null)
            setVendorResponseText('')
            setDocFiles([])
            setSubmitResult(null)
            setSubmitError(null)
            navTo('disputeDetail')
          }}
        />
      )}
      {screen === 'disputes' && (
        <DisputesScreen
          disputes={disputes}
          loading={loading}
          typeFilter={disputeTypeFilter}
          setTypeFilter={setDisputeTypeFilter}
          statusFilter={disputeStatusFilter}
          setStatusFilter={setDisputeStatusFilter}
          responseTypeFilter={disputeResponseType}
          setResponseTypeFilter={setDisputeResponseType}
          sortOrder={disputeSortOrder}
          setSortOrder={setDisputeSortOrder}
          search={disputeSearch}
          setSearch={setDisputeSearch}
          onSelect={(d) => {
            setSelectedDispute(d)
            setResponseType(null)
            setVendorResponseText('')
            setDocFiles([])
            setSubmitResult(null)
            setSubmitError(null)
            navTo('disputeDetail')
          }}
        />
      )}
      {screen === 'disputeDetail' && (
        <DisputeDetailScreen
          dispute={selectedDispute}
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
        />
      )}
    </Shell>
  )
}
