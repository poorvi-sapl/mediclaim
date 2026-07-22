import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { API_BASE } from '../api'
import { Icon } from '../components/ui'

// ---------------------------------------------------------------------------
// API calls — follow the same request() pattern from api.js
// ---------------------------------------------------------------------------

async function request(path, options) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options })
  } catch {
    const err = new Error('Unable to reach the server. Check your connection and try again.')
    err.status = 0
    throw err
  }
  if (!res.ok) {
    let detail
    try { detail = await res.json() } catch { /* ignore */ }
    const err = new Error(detail?.message || 'Something went wrong.')
    err.status = res.status
    err.error = detail?.error
    throw err
  }
  return res.json()
}

async function fetchDispute(caseId, token) {
  return request(`/api/v1/vendor/disputes/${caseId}?token=${encodeURIComponent(token)}`)
}

async function submitResponse(caseId, token, responseType, vendorResponse, docFiles = []) {
  const fd = new FormData()
  fd.append('response_type', responseType)
  fd.append('vendor_response', vendorResponse)
  docFiles.forEach((f) => fd.append('docs', f))
  return request(
    `/api/v1/vendor/disputes/${caseId}/respond?token=${encodeURIComponent(token)}`,
    { method: 'POST', body: fd }
  )
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function fmt(amount) {
  if (amount == null) return 'N/A'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function fmtDate(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'))
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--navy-900, #3E5F94)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <span className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--navy-900, #3E5F94)' }}>NPI Watch</span>
    </div>
  )
}

function StatusBadge({ status }) {
  const cfg = {
    OPEN:                    { tone: 'warning', label: 'Open',           icon: 'clock' },
    RESPONDED_TO_MEDICARE:   { tone: 'success', label: 'Responded',      icon: 'check' },
    RESOLVED_BY_PHYSICIAN:   { tone: 'success', label: 'Resolved',       icon: 'check' },
    NON_RESPONSIVE:          { tone: 'error',   label: 'Non-Responsive', icon: 'x' },
    REFERRED_OIG:            { tone: 'error',   label: 'Referred OIG',   icon: 'alertTri' },
    CLOSED:                  { tone: 'neutral', label: 'Closed',         icon: 'check' },
  }
  const c = cfg[status] || { tone: 'neutral', label: status, icon: 'clock' }
  return <span className={`vbadge ${c.tone}`}><Icon name={c.icon} size={12} />{c.label}</span>
}

function DeadlineBanner({ daysRemaining, deadlinePassed, status }) {
  if (status !== 'OPEN') return null
  if (deadlinePassed) {
    return (
      <div className="rounded-lg px-4 py-3 text-sm font-medium" style={{ background: 'var(--n-100)', color: 'var(--n-600)' }}>
        Response window has closed.
      </div>
    )
  }
  if (daysRemaining <= 3) {
    return (
      <div className="rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: 'var(--error-bg)', color: 'var(--error-tx)', boxShadow: 'inset 0 0 0 1px #EBD3D1' }}>
        URGENT: {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining to respond
      </div>
    )
  }
  return (
    <div className="rounded-lg px-4 py-3 text-sm font-medium" style={{ background: 'var(--warning-bg)', color: 'var(--warning-tx)' }}>
      {daysRemaining} days remaining to respond
    </div>
  )
}

function DetailRow({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 sm:w-44 shrink-0 mt-px">{label}</span>
      <span className="text-[13px] text-slate-800">{value}</span>
    </div>
  )
}

function OptionCard({ id, title, description, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all duration-150 ${
        selected
          ? 'border-[#3E5F94] bg-[#3E5F94]/5'
          : 'border-slate-200 hover:border-slate-300 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
          selected ? 'border-[#3E5F94]' : 'border-slate-300'
        }`}>
          {selected && <div className="w-2 h-2 rounded-full bg-[#3E5F94]" />}
        </div>
        <div>
          <div className="text-[13px] font-semibold text-slate-900">{title}</div>
          <div className="text-[12px] text-slate-500 mt-0.5">{description}</div>
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Error card — shown for expired/invalid tokens
// ---------------------------------------------------------------------------

function ErrorCard({ errorCode, message }) {
  const expired = errorCode === 'link_expired'
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-[480px] w-full bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
          {expired ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          )}
        </div>
        <h2 className="text-[17px] font-bold text-slate-800 mb-2">
          {expired ? 'Link Expired' : 'Invalid Link'}
        </h2>
        <p className="text-[13px] text-slate-500 leading-relaxed mb-1">{message}</p>
        <p className="text-[12px] text-slate-400 mt-3">
          If you believe this is an error, contact{' '}
          <span className="text-[#3E5F94] font-medium">support@npiwatch.com</span>
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function VendorDisputePage() {
  const { case_id } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [loadState, setLoadState] = useState('loading')   // loading | error | loaded
  const [dispute, setDispute] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const [selectedOption, setSelectedOption] = useState(null)
  const [notes, setNotes] = useState('')
  const [docFiles, setDocFiles] = useState([])
  const [submitState, setSubmitState] = useState('idle')  // idle | loading | success | error
  const [submitError, setSubmitError] = useState(null)
  const [submitResult, setSubmitResult] = useState(null)

  useEffect(() => {
    if (!token) {
      setLoadError({ errorCode: 'invalid_token', message: 'This link is invalid or has already been used.' })
      setLoadState('error')
      return
    }
    fetchDispute(case_id, token)
      .then((d) => { setDispute(d); setLoadState('loaded') })
      .catch((e) => {
        setLoadError({ errorCode: e.error || 'invalid_token', message: e.message })
        setLoadState('error')
      })
  }, [case_id, token])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedOption) return
    setSubmitState('loading')
    setSubmitError(null)
    try {
      const result = await submitResponse(case_id, token, selectedOption, notes, docFiles)
      setSubmitResult(result)
      setDispute((prev) => ({ ...prev, status: result.status, vendor_responded_at: new Date().toISOString() }))
      setSubmitState('success')
    } catch (err) {
      setSubmitError(err.message)
      setSubmitState('error')
    }
  }

  // --- Loading ---
  if (loadState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <svg className="animate-spin text-slate-400" width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/>
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      </div>
    )
  }

  // --- Error ---
  if (loadState === 'error') {
    return <ErrorCard errorCode={loadError?.errorCode} message={loadError?.message} />
  }

  // --- Loaded ---
  const {
    status, days_remaining, deadline_passed,
    response_due_date,
    vendor_responded_at, provider_response_type, vendor_response, vendor_docs,
    claim,
  } = dispute

  const isOpen  = status === 'OPEN'
  const alreadyResponded = !!vendor_responded_at

  const hcpcs = Array.isArray(claim?.hcpcs_codes)
    ? claim.hcpcs_codes.join(', ')
    : (claim?.hcpcs_codes || 'N/A')

  return (
    <div className="vendor-theme min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-[680px] mx-auto space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <Logo />
          <StatusBadge status={status} />
        </div>

        {/* ── Page title — deliberately type-blind: the vendor is never told
             whether this is a dispute, fraud report, or deceased-patient case,
             only that documents are required. ── */}
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">
            Supporting Documents Required
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Case #{case_id} · Due {fmtDate(response_due_date)}
          </p>
        </div>

        {/* ── Deadline banner ── */}
        <DeadlineBanner daysRemaining={days_remaining} deadlinePassed={deadline_passed} status={status} />

        {/* ── Claim detail ── */}
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-sm">
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-3">Claim Details</h2>
          <DetailRow label="Claim Number"       value={claim?.claim_number} />
          <DetailRow label="Patient"            value={claim?.patient_name_partial} />
          <DetailRow label="Dates of Service"   value={claim?.dos_from && claim?.dos_to ? `${fmtDate(claim.dos_from)} – ${fmtDate(claim.dos_to)}` : null} />
          <DetailRow label="Service"            value={claim?.service_description} />
          <DetailRow label="HCPCS Codes"        value={hcpcs} />
          <DetailRow label="Amount Billed"      value={fmt(claim?.amount_billed)} />
          <DetailRow label="Physician Role"     value={claim?.physician_npi_role} />
          <DetailRow label="Vendor Name"        value={claim?.vendor_name} />
          <DetailRow label="Vendor Type"        value={claim?.vendor_type} />
        </div>

        {/* ── Already responded ── */}
        {alreadyResponded && (
          <div className="rounded-xl px-5 py-4" style={{ background: 'var(--info-bg)', border: '1px solid #D2E1EB' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--info-tx)' }}>
              Response Submitted
            </div>
            <p className="text-[13px]" style={{ color: 'var(--navy-900)' }}>
              Submitted on {fmtDate(vendor_responded_at)}
            </p>
            {provider_response_type && (
              <p className="text-[12px] mt-1" style={{ color: 'var(--info-tx)' }}>
                Type: {provider_response_type === 'RESPONDED_TO_MEDICARE' ? 'Responded to Medicare directly' : 'Resolved with physician'}
              </p>
            )}
            {vendor_response && (
              <p className="text-[12px] text-slate-600 mt-2 italic">"{vendor_response}"</p>
            )}
            {vendor_docs?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {vendor_docs.map((doc) => (
                  <a
                    key={doc.stored_name}
                    href={`${API_BASE}/api/v1/vendor/disputes/${case_id}/docs/${doc.stored_name}?token=${encodeURIComponent(token)}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-[11px] font-semibold transition-colors"
                    style={{ boxShadow: 'inset 0 0 0 1px #D2E1EB', color: 'var(--info-tx)' }}
                  >
                    {doc.filename}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Response form ── */}
        {isOpen && !deadline_passed && !alreadyResponded && (
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-5 shadow-sm">
            <h2 className="text-[14px] font-bold text-slate-900 mb-1">Your Response Required</h2>
            <p className="text-[12px] text-slate-500 mb-4">Select one of the options below and submit before the deadline.</p>

            {submitState === 'success' ? (
              <div className="rounded-xl px-5 py-5 text-center" style={{ background: 'var(--success-bg)', border: '1px solid #D5E9DD' }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: '#D5E9DD' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success-tx)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div className="text-[15px] font-bold mb-1" style={{ color: 'var(--success-tx)' }}>Response Submitted</div>
                <p className="text-[13px]" style={{ color: 'var(--success-tx)' }}>
                  Your response has been recorded. Case #{case_id} is now marked as{' '}
                  <strong>{submitResult?.status?.replace(/_/g, ' ')}</strong>.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <OptionCard
                    id="RESPONDED_TO_MEDICARE"
                    title="I responded to Medicare directly"
                    description="I have submitted documentation to Medicare and can provide proof."
                    selected={selectedOption === 'RESPONDED_TO_MEDICARE'}
                    onSelect={setSelectedOption}
                  />
                  <OptionCard
                    id="RESOLVED_WITH_PHYSICIAN"
                    title="I resolved this with the physician"
                    description="I contacted the physician's office and they will update their response to confirm this claim."
                    selected={selectedOption === 'RESOLVED_WITH_PHYSICIAN'}
                    onSelect={setSelectedOption}
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
                    Additional notes <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Provide any relevant details about your response..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] text-slate-800 placeholder-slate-400 outline-none focus:border-[#3E5F94]/40 focus:ring-2 focus:ring-[#3E5F94]/10 resize-none transition"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
                    Supporting documents <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <label className="flex items-center justify-center gap-2 w-full px-3 py-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-[#3E5F94]/40 text-[12px] text-slate-500 cursor-pointer transition-colors">
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
                          {f.name}
                          <button type="button" onClick={() => setDocFiles((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-[var(--navy-900)] transition-colors" aria-label={`Remove ${f.name}`}>
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {submitState === 'error' && submitError && (
                  <div className="rounded-lg px-4 py-3 text-[13px]" style={{ background: 'var(--error-bg)', boxShadow: 'inset 0 0 0 1px #EBD3D1', color: 'var(--error-tx)' }}>
                    {submitError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!selectedOption || submitState === 'loading'}
                  className={selectedOption ? 'gbtn gbtn-primary gbtn-lg w-full' : 'gbtn gbtn-lg w-full opacity-50 cursor-not-allowed'}
                >
                  {submitState === 'loading' ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/>
                        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                      </svg>
                      Submitting…
                    </span>
                  ) : 'Submit Response'}
                </button>
              </form>
            )}
          </div>
        )}

        <p className="text-center text-[11px] text-slate-400 pb-4">
          NPI Watch Compliance System · <a href="mailto:support@npiwatch.com" className="hover:underline">support@npiwatch.com</a>
        </p>
      </div>
    </div>
  )
}
