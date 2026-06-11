// ─────────────────────────────────────────────────────────────────────────
// ClaimLens API client.
// Adapts backend responses into the exact shapes the existing UI components
// already consume, so the components don't need rewriting.
// ─────────────────────────────────────────────────────────────────────────

export const API_BASE =
  import.meta.env.VITE_API_URL || 'http://localhost:4001'

// The "logged-in" physician for the physician portal (Dr. James Wilson).
export const PHYSICIAN_NPI = '1234567890'

// Map an HTTP status + backend detail to a clean, user-facing message.
// Never surfaces raw status codes, stack traces, or error objects to the UI.
function friendlyMessage(status, detail) {
  if (detail && detail.error) return detail.error
  if (status === 422) return 'Some of the information provided was invalid.'
  if (status === 404) return 'The requested record could not be found.'
  if (status === 503) return 'The service is temporarily unavailable. Please try again in a moment.'
  return 'Something went wrong. Please try again.'
}

// Global 401 handler — AuthContext registers a callback so an expired/blacklisted
// token mid-session clears the user and bounces to /login. Not fired for /auth/*
// (those 401s are handled locally by the login form and the session check).
let authErrorHandler = null
export function setAuthErrorHandler(fn) { authErrorHandler = fn }

// Single request path used by all calls. Throws an Error whose `.message` is
// always safe to display, plus `.status` / `.code` for callers that branch.
// `credentials: 'include'` sends the httpOnly claimlens_token cookie.
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
    try { detail = (await res.json()).detail } catch { /* ignore */ }
    if (res.status === 401 && authErrorHandler && !path.startsWith('/auth/')) {
      authErrorHandler()
    }
    const err = new Error(friendlyMessage(res.status, detail))
    err.status = res.status
    err.code = detail && detail.code
    throw err
  }
  return res.status === 204 ? null : res.json()
}

// ─── Auth ────────────────────────────────────────────────────────────────
export async function authLogin(email, password, remember = false) {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, remember }),
  })
}

export async function authLogout() {
  try { await request('/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
}

// Returns the current user, or null if not authenticated.
export async function authMe() {
  try {
    return await request('/auth/me')
  } catch (e) {
    if (e.status === 401) return null
    throw e
  }
}

// ─── MFA (TOTP) ────────────────────────────────────────────────────────────
// All /auth/mfa/* calls return a thrown Error with .status / .code on failure,
// which the MFA screens branch on (e.g. 400 invalid, 429 lockout, 401 expired).

// Step-up setup for a logged-in user: returns { qr_uri, manual_code }.
export async function mfaSetup() {
  return request('/auth/mfa/setup', { method: 'POST' })
}

// Confirm the first TOTP code; returns { success, backup_codes, message }.
export async function mfaVerifySetup(code) {
  return request('/auth/mfa/verify-setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
}

// Second login factor via TOTP; sets the claimlens_token cookie on success.
export async function mfaLogin(code, mfaPendingToken) {
  return request('/auth/mfa/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, mfa_pending_token: mfaPendingToken }),
  })
}

// Second login factor via a backup code; sets the claimlens_token cookie on success.
export async function mfaBackup(backupCode, mfaPendingToken) {
  return request('/auth/mfa/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup_code: backupCode, mfa_pending_token: mfaPendingToken }),
  })
}

// ─── Email OTP (ACTIVE login second factor) ──────────────────────────────────
// Verify the emailed 6-digit code; sets the claimlens_token cookie on success.
export async function otpVerify(code, otpPendingToken) {
  return request('/auth/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, otp_pending_token: otpPendingToken }),
  })
}

// Re-send a fresh OTP (no password re-entry); returns a new otp_pending_token.
export async function otpResend(resendToken) {
  return request('/auth/otp/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resend_token: resendToken }),
  })
}

// Instant demo access — sets the session cookie directly (no password/OTP).
export async function demoLogin(portal) {
  return request('/auth/demo-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portal }),
  })
}

// ─── Registration ───────────────────────────────────────────────────────────
export async function registerPhysician(body) {
  return request('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

export async function registerPayer(body) {
  return request('/auth/register/payer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

// Inline verification during registration (public, rate-limited).
export async function verifyNpi(npi) {
  return request(`/auth/verify-npi?npi=${encodeURIComponent(npi)}`)
}
export async function verifyUei(uei) {
  return request(`/auth/verify-uei?uei=${encodeURIComponent(uei)}`)
}

// Document upload (multipart). Requires a session cookie.
export async function uploadDocument(file, docType) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('doc_type', docType)
  return request('/documents/upload', { method: 'POST', body: fd })
}

async function get(path) {
  return request(path)
}

// Backend sends naive UTC ISO strings (no 'Z') — mark them UTC before parsing.
function toUtcDate(s) {
  if (typeof s === 'string' && s.includes('T') && !/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z'
  return new Date(s)
}

// ─── mapping helpers ───────────────────────────────────────────────────────

// backend service_category (lowercase) -> UI label
const CATEGORY_LABEL = {
  dme: 'DME', hospice: 'Hospice', home_health: 'Home Health',
  drugs: 'Drugs', hospital: 'Hospital',
}
const catLabel = (c) => CATEGORY_LABEL[c] || (c ? c[0].toUpperCase() + c.slice(1) : '—')

// UI action -> backend action_type  (and the reverse for incoming SSE/actions)
export const ACTION_TO_BACKEND = {
  confirmed: 'confirm', disputed: 'dispute',
  flagged: 'flag_supplier', unknownPatient: 'unknown_patient',
  deniedOrder: 'did_not_order',
}
export const ACTION_FROM_BACKEND = {
  confirm: 'confirmed', dispute: 'disputed',
  flag_supplier: 'flagged', unknown_patient: 'unknownPatient',
  did_not_order: 'deniedOrder',
}

// backend rule_name -> the UI's flag code keys (FLAG_LABELS / FLAG_STYLES)
const RULE_TO_FLAG = {
  oig_leie_hit: 'OIG_HIT', cross_npi_supplier: 'CROSS_NPI',
  volume_spike: 'VOLUME_SPIKE', geographic_anomaly: 'GEO_ANOMALY',
  new_high_value_supplier: 'NEW_SUPPLIER', duplicate_billing: 'DUPLICATE',
  identity_reuse: 'IDENTITY_REUSE', abnormal_hospice_duration: 'HOSPICE_DURATION',
  upcoding: 'UPCODING', unbundling: 'UNBUNDLING',
  deceased_patient: 'DECEASED', impossible_day: 'IMPOSSIBLE_DAY',
  modifier_abuse: 'MODIFIER_ABUSE', rapid_cycling: 'RAPID_CYCLING',
  supplier_concentration: 'SUPPLIER_CONCENTRATION',
}
const RULE_META = {  // for the NPI-detail "Rules Fired" list
  volume_spike: { label: 'Volume Spike', points: 25 },
  geographic_anomaly: { label: 'Geographic Anomaly', points: 15 },
  cross_npi_supplier: { label: 'Cross-NPI Supplier', points: 30 },
  oig_leie_hit: { label: 'OIG Hit', points: 35 },
  new_high_value_supplier: { label: 'New High-Value Supplier', points: 10 },
  duplicate_billing: { label: 'Duplicate Billing', points: 20 },
  identity_reuse: { label: 'Patient Identity Reuse', points: 20 },
  abnormal_hospice_duration: { label: 'Abnormal Hospice Duration', points: 15 },
  upcoding: { label: 'Upcoding', points: 20 },
  unbundling: { label: 'Unbundling', points: 15 },
  deceased_patient: { label: 'Deceased Patient', points: 30 },
  impossible_day: { label: 'Impossible Day', points: 40 },
  modifier_abuse: { label: 'Modifier Abuse', points: 24 },
  rapid_cycling: { label: 'Rapid Patient Cycling', points: 30 },
  supplier_concentration: { label: 'Supplier Concentration', points: 18 },
}

// compact rule labels for claim flag badges
const RULE_LABEL = {
  oig_leie_hit: 'OIG Hit', cross_npi_supplier: 'Cross-NPI',
  volume_spike: 'Volume Spike', geographic_anomaly: 'Geo Anomaly',
  new_high_value_supplier: 'New Supplier', duplicate_billing: 'Duplicate',
  identity_reuse: 'Identity Reuse', abnormal_hospice_duration: 'Long Hospice',
  upcoding: 'Upcoding', unbundling: 'Unbundling',
  deceased_patient: 'Deceased', impossible_day: 'Impossible Day',
  modifier_abuse: 'Modifier Abuse', rapid_cycling: 'Rapid Cycling',
  supplier_concentration: 'Supplier Conc.',
}

function mapClaim(c) {
  const names = c.flags || []
  const sev = c.severities || []
  const desc = c.flag_descriptions || []
  return {
    id: c.id,
    date: c.date_of_service,
    patient: c.patient_name,
    patientZip: c.patient_zip || '',
    description: c.service_description,
    code: c.hcpcs_code || c.cpt_code || '',
    category: catLabel(c.service_category),
    supplier: c.supplier_name,
    supplierNpi: c.supplier_npi || '',
    amount: Number(c.claim_amount),
    reviewed: c.reviewed,
    latestAction: c.latest_action || null,     // backend action_type, or null
    action: c.latest_action ? ACTION_FROM_BACKEND[c.latest_action] : null,
    oigFlagged: c.oig_flagged,
    unknownSupplier: c.oig_flagged,
    rawFlags: names,                            // raw rule_name strings
    hasRuleFlag: names.length > 0,
    supplierHighRisk: names.some((n) => n === 'oig_leie_hit' || n === 'cross_npi_supplier'),
    // structured per-claim flags: { label, severity, description }
    flags: names.map((n, i) => ({
      label: RULE_LABEL[n] || n,
      severity: sev[i] || 'medium',
      description: desc[i] || '',
    })),
  }
}

// ─── Physician portal ────────────────────────────────────────────────────

export async function getPhysician(npi = PHYSICIAN_NPI) {
  const s = await get(`/physician/${npi}/summary`)
  return {
    physician: {
      name: s.physician_name, npi: s.npi,
      specialty: s.specialty || '',
      city: s.practice_city || '', state: s.practice_state || '',
    },
    summary: {
      totalClaimsMonth: s.total_claims_month,
      pendingReview: s.unreviewed_count,
      unknownSuppliers: s.unknown_supplier_count,
      totalAmountBilled: Number(s.total_amount_month),
    },
  }
}

export async function getClaims(npi = PHYSICIAN_NPI) {
  // page through all of this physician's claims (page_size max 100)
  const all = []
  let page = 0
  while (true) {
    const data = await get(`/physician/${npi}/claims?page=${page}&page_size=100`)
    all.push(...data.items)
    if (all.length >= data.total || data.items.length === 0) break
    page += 1
  }
  return all.map(mapClaim)
}

// UI category label -> backend service_category value
const CATEGORY_TO_BACKEND = {
  'Home Health': 'home_health', Hospice: 'hospice', DME: 'dme',
  Drugs: 'drugs', Hospital: 'hospital',
}

// Server-side filtered + paginated claims for the Claims screen filter bar.
// filters: { page, pageSize, category, dateFrom, dateTo, reviewed, supplierSearch }
//   category: UI label or 'All' / 'All Categories'  (omitted when "all")
//   reviewed: 'all' | 'unreviewed' | 'reviewed'
export async function getClaimsPage(npi = PHYSICIAN_NPI, f = {}) {
  const p = new URLSearchParams()
  p.set('page', f.page ?? 0)
  p.set('page_size', f.pageSize ?? 50)
  if (f.category && !f.category.startsWith('All')) {
    p.set('category', CATEGORY_TO_BACKEND[f.category] || f.category.toLowerCase())
  }
  if (f.dateFrom) p.set('date_from', f.dateFrom)
  if (f.dateTo) p.set('date_to', f.dateTo)
  if (f.reviewed === 'unreviewed') p.set('reviewed', 'false')
  else if (f.reviewed === 'reviewed') p.set('reviewed', 'true')
  if (f.supplierSearch) p.set('supplier_search', f.supplierSearch)

  const data = await get(`/physician/${npi}/claims?${p.toString()}`)
  return {
    items: data.items.map(mapClaim),
    total: data.total,
    page: data.page,
    totalPages: data.total_pages,
    // NPI-wide aggregate cards
    totalCount: data.total_count ?? data.total,
    flaggedCount: data.flagged_count ?? 0,
    confirmedCount: data.confirmed_count ?? 0,
  }
}

export async function getFlaggedSuppliers(npi = PHYSICIAN_NPI) {
  const data = await get(`/physician/${npi}/flagged-suppliers`)
  const PLAN_STATUS_LABEL = {
    pending: 'Pending', under_review: 'Under Review', acknowledged: 'Acknowledged',
  }
  return data.items.map((s, i) => ({
    id: s.supplier_id || i,
    name: s.supplier_name,
    claimsCount: s.claim_count,
    totalAmount: Number(s.total_amount),
    firstFlagged: (s.flagged_at || s.first_flagged_at || '').slice(0, 10),
    flaggedAt: s.flagged_at || s.first_flagged_at,
    planStatus: s.plan_status || 'pending',
    planStatusLabel: PLAN_STATUS_LABEL[s.plan_status] || 'Pending',
    status: s.oig_flagged ? 'Escalated' : (PLAN_STATUS_LABEL[s.plan_status] || 'Under Review'),
  }))
}

export async function postAction(claimId, npi, uiAction) {
  const action_type = ACTION_TO_BACKEND[uiAction] || uiAction
  return request('/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim_id: claimId, npi, action_type }),
  })
}

// ─── Plan portal ───────────────────────────────────────────────────────────

function mapNpiRow(r, i) {
  return {
    id: r.npi || i,
    name: r.physician_name,
    npi: r.npi,
    specialty: r.specialty || '',
    state: r.practice_state || '',
    city: r.practice_city || '',
    score: r.risk_score,
    needsManualReview: r.needs_manual_review || false,
    totalClaims: r.total_claim_count,
    totalAmount: Number(r.total_claim_amount),
    physicianFlags: r.physician_flag_count,
    topSupplier: r.top_supplier_name || '—',
    rulesFiredCount: [r.volume_flag, r.geo_flag, r.cross_npi_flag, r.oig_flag,
                      r.new_supplier_flag, r.identity_reuse_flag, r.hospice_duration_flag,
                      r.upcoding_flag, r.unbundling_flag].filter(Boolean).length,
    rulesFired: [
      r.oig_flag && RULE_META.oig_leie_hit,
      r.cross_npi_flag && RULE_META.cross_npi_supplier,
      r.volume_flag && RULE_META.volume_spike,
      r.geo_flag && RULE_META.geographic_anomaly,
      r.new_supplier_flag && RULE_META.new_high_value_supplier,
      r.identity_reuse_flag && RULE_META.identity_reuse,
      r.hospice_duration_flag && RULE_META.abnormal_hospice_duration,
      r.upcoding_flag && RULE_META.upcoding,
      r.unbundling_flag && RULE_META.unbundling,
    ].filter(Boolean),
  }
}

// filters: { riskBand: 'high'|'medium'|'low'|'all', specialty, state }
export async function getNpiRiskList(filters = {}) {
  const p = new URLSearchParams({ page: '0', page_size: '100', min_score: '0' })
  if (filters.riskBand && filters.riskBand !== 'all') p.set('risk_band', filters.riskBand)
  if (filters.specialty) p.set('specialty', filters.specialty)
  if (filters.state) p.set('state', filters.state)
  if (filters.patternFilter) p.set('pattern_filter', filters.patternFilter)
  const data = await get(`/plan/npi-risk-list?${p.toString()}`)
  return data.items.map(mapNpiRow)
}

export async function getPlanSummary() {
  const s = await get('/plan/summary')
  const list = await getNpiRiskList()
  const totalClaims = list.reduce((acc, n) => acc + (n.totalClaims || 0), 0)
  return {
    summary: {
      totalNPIs: s.total_npis,
      highRiskNPIs: s.high_risk_npis,
      activeAlertsToday: s.alerts_today,
      totalClaims,
    },
    npis: list,
  }
}

// LLM (GPT-4o) plain-English risk explanation for an NPI, grounded in fired rules.
export async function getNpiSummary(npi) {
  const d = await get(`/plan/npi/${npi}/summary`)
  return { summary: d.summary, source: d.source, riskBand: d.risk_band, riskScore: d.risk_score }
}

// Drill-down: what a rule means + the claims/patients that triggered it.
export async function getRuleEvidence(npi, rule) {
  const d = await get(`/plan/npi/${npi}/rule/${rule}`)
  return {
    label: d.label,
    explanation: d.explanation,
    count: d.count,
    physicianName: d.physician_name || null,
    practiceLat: d.practice_lat != null ? Number(d.practice_lat) : null,
    practiceLng: d.practice_lng != null ? Number(d.practice_lng) : null,
    claims: (d.claims || []).map((c) => ({
      id: c.claim_id,
      patient: c.patient_name,
      date: c.date_of_service,
      supplier: c.supplier_name,
      description: c.service_description,
      category: catLabel(c.service_category),
      amount: Number(c.claim_amount),
      why: c.why,
      severity: c.severity,
      // geographic_anomaly map coords (null for rows/rules without geocodes)
      patientLat: c.patient_lat != null ? Number(c.patient_lat) : null,
      patientLng: c.patient_lng != null ? Number(c.patient_lng) : null,
      practiceLat: c.practice_lat != null ? Number(c.practice_lat) : null,
      practiceLng: c.practice_lng != null ? Number(c.practice_lng) : null,
    })),
  }
}

export async function getNpiDetail(npi) {
  const d = await get(`/plan/npi/${npi}/detail`)
  const sc = d.score || {}
  const rulesFired = (sc.score_breakdown || []).map((b) => ({
    label: b.factor, points: b.points, rule: b.rule, detail: '',
  }))
  return {
    id: npi,
    name: d.profile?.physician_name || `NPI ${npi}`,
    npi,
    specialty: d.profile?.specialty || '',
    state: d.profile?.practice_state || '',
    city: d.profile?.practice_city || '',
    verification: d.verification || null,   // CMS registration verification, or null for pre-feature accounts
    score: sc.risk_score ?? 0,
    totalClaims: sc.total_claim_count ?? d.claims?.total ?? 0,
    totalAmount: Number(sc.total_claim_amount ?? 0),
    physicianFlags: sc.physician_flag_count ?? 0,
    rulesFiredCount: rulesFired.length,
    rulesFired,
    claims: (d.claims?.items || []).map((c) => ({
      id: c.id, date: c.date_of_service, patient: c.patient_name,
      description: c.service_description, code: c.hcpcs_code || c.cpt_code || '',
      category: catLabel(c.service_category), supplier: c.supplier_name,
      amount: Number(c.claim_amount),
      flags: (c.flags || []).map((f) => RULE_TO_FLAG[f]).filter(Boolean),
    })),
    actions: (d.physician_actions || []).map((a, i) => ({
      id: a.id || i,
      action: ACTION_FROM_BACKEND[a.action_type] || 'confirmed',
      patient: a.patient_name, supplier: a.supplier_name,
      note: a.note || '', ts: a.created_at,
    })),
  }
}

export async function getSuppliers() {
  const data = await get('/plan/suppliers?page=0&page_size=100')
  const band = (score) => score > 80 ? 'Critical' : score > 60 ? 'High'
    : score > 30 ? 'Medium' : 'Low'
  return data.items.map((s, i) => ({
    id: s.supplier_id || i,
    name: s.supplier_name,
    distinctNPIs: s.distinct_npi_count ?? 0,
    physicianFlags: s.physician_flag_count,
    totalAmount: Number(s.total_claim_amount),
    firstSeen: s.first_seen || '—',
    risk: band(s.risk_score),
    riskScore: s.risk_score ?? 0,
    oig: s.oig_flag,
  }))
}

// All physicians billing a supplier — the core of the Supplier Case view.
export async function getSupplierPhysicians(supplierId) {
  const d = await get(`/plan/suppliers/${supplierId}/physicians`)
  return {
    supplierId: d.supplier_id,
    distinctNpis: d.distinct_npi_count,
    totalDenials: d.total_denials,
    physicians: (d.physicians || []).map((p) => ({
      npi: p.npi, name: p.physician_name, specialty: p.specialty,
      city: p.practice_city, state: p.practice_state,
      claimCount: p.claim_count, totalAmount: Number(p.total_amount),
      flags: p.physician_flag_count, flagsOnThisSupplier: p.flags_on_this_supplier ?? 0,
      denials: p.denial_count, hasDenied: p.has_denied,
      firstClaim: p.first_claim_date, lastClaim: p.last_claim_date,
    })),
  }
}

// ─── Live alerts (history + detail + notifications) ──────────────────────

function mapAlert(a) {
  return {
    id: a.id,
    action: ACTION_FROM_BACKEND[a.action_type] || a.action_type,
    physicianName: a.physician_name,
    npi: a.npi,
    supplierName: a.supplier_name,
    supplierId: a.supplier_id,
    supplierNpi: a.supplier_npi || a.supplier_id,
    patientName: a.patient_name,
    amount: Number(a.claim_amount),
    claimId: a.id,
    escalation: a.escalation,
    escalationLabel: a.escalation_label,
    planStatus: a.plan_status || 'pending',
    ts: a.timestamp ? toUtcDate(a.timestamp) : new Date(),
  }
}

// REST companion to the SSE stream — historical alerts for initial page load.
export async function getAlertsHistory(limit = 50, offset = 0, supplierId = null) {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (supplierId) p.set('supplier_id', supplierId)
  const data = await get(`/plan/alerts?${p.toString()}`)
  return { items: (data.items || []).map(mapAlert), total: data.total }
}

function mapActionDetail(d) {
  return {
    actionId: d.action_id,
    npi: d.npi,
    physicianName: d.physician_name,
    supplierName: d.supplier_name,
    supplierId: d.supplier_id,
    claimId: d.claim_id,
    actionType: d.action_type,
    action: ACTION_FROM_BACKEND[d.action_type] || d.action_type,
    amount: Number(d.amount),
    createdAt: d.created_at,
    planStatus: d.plan_status,
    caseRef: d.case_ref,
    history: (d.history || []).map((h) => ({
      status: h.status, note: h.note, by: h.changed_by, at: h.changed_at,
    })),
  }
}

// Full detail for the "Review" button.
export async function getActionDetail(actionId) {
  return mapActionDetail(await get(`/plan/actions/${actionId}`))
}

// Investigator updates the plan status on a flag, with an optional note.
// status: pending | under_review | acknowledged | case_opened | dismissed
export async function setActionStatus(actionId, status, note) {
  const d = await request(`/plan/actions/${actionId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note: note || null }),
  })
  return mapActionDetail(d)
}

// Unread alert badge count + mark-seen.
export async function getNotificationsCount() {
  const d = await get('/auth/notifications/count')
  return d.unread ?? 0
}

export async function markNotificationsSeen() {
  await request('/auth/notifications/seen', { method: 'POST' })
}

// ─── Live alerts (SSE) ───────────────────────────────────────────────────

export function subscribeAlerts(onAlert, opts = {}) {
  const es = new EventSource(`${API_BASE}/plan/alerts/stream`, { withCredentials: true })
  es.onopen = () => opts.onOpen?.()
  es.onerror = () => opts.onError?.()   // EventSource auto-reconnects; onopen fires again on recovery
  es.onmessage = (ev) => {
    if (!ev.data) return
    try {
      const a = JSON.parse(ev.data)
      onAlert({
        id: a.id,
        action: ACTION_FROM_BACKEND[a.action_type] || a.action_type,
        physicianName: a.physician_name,
        npi: a.npi,
        supplierName: a.supplier_name,
        supplierNpi: a.supplier_npi,
        patientName: a.patient_name,
        amount: Number(a.claim_amount),
        claimId: a.id,
        escalation: a.escalation,
        escalationLabel: a.escalation_label,
        ts: a.timestamp ? toUtcDate(a.timestamp) : new Date(),
      })
    } catch { /* ignore keep-alive / non-JSON */ }
  }
  return es
}
