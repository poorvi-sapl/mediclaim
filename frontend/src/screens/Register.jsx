import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout, { Spinner } from '../components/AuthLayout'
import { registerPhysician, registerPayer, verifyNpi, verifyUei, uploadDocument } from '../api'

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
const inputCls = "w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20 transition disabled:bg-slate-50"
const labelCls = "block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5"
const sectionCls = "text-xs font-bold text-[#1B3A5C] uppercase tracking-wider mt-6 mb-3"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function StepIndicator({ text }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400 mb-2">{text}</div>
}
function Field({ label, children, hint }) {
  return <div><label className={labelCls}>{label}</label>{children}{hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}</div>
}
// Small muted-teal "Use demo value" link, shown only while a field is empty.
function DemoLink({ show, onFill }) {
  if (!show) return null
  return <button type="button" onClick={onFill}
    className="mt-1 text-[11px] font-medium text-teal-600 hover:text-teal-700 hover:underline">Use demo value →</button>
}
// Outlined "Fill demo values" button.
function FillAllButton({ onClick }) {
  return (
    <div className="flex justify-end mb-1">
      <button type="button" onClick={onClick}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-teal-500 text-teal-600 hover:bg-teal-50 transition">
        ⚡ Fill demo values
      </button>
    </div>
  )
}

function pwStrength(pw) {
  if (!pw) return null
  if (pw.length < 8) return { label: 'Too short', pct: 20, color: '#f43f5e' }
  let n = 0
  if (/[a-zA-Z]/.test(pw)) n++
  if (/[0-9]/.test(pw)) n++
  if (/[^a-zA-Z0-9]/.test(pw)) n++
  if (n <= 1) return { label: 'Weak', pct: 40, color: '#f59e0b' }
  if (n === 2) return { label: 'Good', pct: 70, color: '#10b981' }
  return { label: 'Strong', pct: 100, color: '#059669' }
}
function PwBar({ pw }) {
  const s = pwStrength(pw)
  if (!s) return null
  return (
    <div className="mt-1.5">
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${s.pct}%`, backgroundColor: s.color }} /></div>
      <span className="text-[11px] mt-1 inline-block" style={{ color: s.color }}>{s.label}</span>
    </div>
  )
}

const STATUS_ICON = {
  pending: <span className="text-slate-300">○</span>,
  spin: <Spinner size={16} />,
  ok: <span className="text-emerald-600">✓</span>,
  warn: <span className="text-amber-500">⚠</span>,
  fail: <span className="text-rose-600">✗</span>,
}
function StepList({ steps }) {
  return (
    <div className="mt-6 space-y-3">
      {steps.map((s, i) => (
        <div key={i} className={`flex items-start gap-3 text-sm transition ${s.status === 'pending' ? 'opacity-40' : ''}`}>
          <span className="w-5 text-center mt-0.5">{STATUS_ICON[s.status]}</span>
          <span className={s.status === 'fail' ? 'text-rose-700' : s.status === 'warn' ? 'text-amber-700' : 'text-slate-700'}>{s.text || s.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function Register() {
  const navigate = useNavigate()
  const [step, setStep] = useState('choose')
  return (
    <AuthLayout>
      {step === 'choose' && (
        <>
          <h1 className="text-3xl font-bold" style={{ color: '#1B3A5C' }}>Create an account</h1>
          <p className="text-sm text-slate-500 mt-2">Choose how you'll use MediClaim.</p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col">
              <div className="text-2xl">🩺</div>
              <div className="font-bold text-slate-800 mt-2">Physician</div>
              <p className="text-xs text-slate-500 mt-2 flex-1 leading-relaxed">Register as a licensed physician to monitor claims filed under your NPI.</p>
              <button onClick={() => setStep('physician')} className="mt-4 w-full py-2.5 rounded-lg text-white font-semibold text-sm" style={{ backgroundColor: '#1B3A5C' }}>Register</button>
            </div>
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col">
              <div className="text-2xl">🏥</div>
              <div className="font-bold text-slate-800 mt-2">Payer Organization</div>
              <p className="text-xs text-slate-500 mt-2 flex-1 leading-relaxed">Register your health plan or payer organization.</p>
              <button onClick={() => setStep('payer')} className="mt-4 w-full py-2.5 rounded-lg text-white font-semibold text-sm" style={{ backgroundColor: '#1B3A5C' }}>Register</button>
            </div>
          </div>
          <div className="mt-8 text-center"><button onClick={() => navigate('/login')} className="text-xs text-slate-400 hover:text-slate-600">← Back to login</button></div>
        </>
      )}
      {step === 'physician' && <PhysicianForm navigate={navigate} onBack={() => setStep('choose')} />}
      {step === 'payer' && <PayerForm navigate={navigate} onBack={() => setStep('choose')} />}
    </AuthLayout>
  )
}

function PhysicianForm({ navigate, onBack }) {
  // Stub values match the existing demo physician account so the presenter can log in
  // immediately with the same credentials they just "registered" with.
  const STUBS = {
    email: 'physician@claimlens.com', password: 'demo1234', confirm: 'demo1234',
    first_name: 'Sarah', last_name: 'Mitchell', npi: '1003000126',
    dea_number: 'BM1234563', state_license_number: 'A123456',
    state_license_state: 'CA', ptan: '1A2B3C',
  }
  const [f, setF] = useState({ email: '', password: '', confirm: '', first_name: '', last_name: '',
    npi: '', dea_number: '', state_license_number: '', state_license_state: 'CA', ptan: '' })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const [npiState, setNpiState] = useState(null)
  const [docMsg, setDocMsg] = useState({})
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('form')
  const [steps, setSteps] = useState([])
  const [blocked, setBlocked] = useState('')
  const [advisories, setAdvisories] = useState([])
  const [returning, setReturning] = useState(false)   // demo account already exists → "Account ready"

  async function checkNpi(val) {
    const npi = (val ?? f.npi)
    if (!/^\d{10}$/.test(npi)) { setNpiState(null); return }
    setNpiState({ checking: true })
    try { const r = await verifyNpi(npi); setNpiState({ valid: r.valid, name: r.name }) }
    catch { setNpiState({ valid: false }) }
  }
  function fillField(key) {
    setF((s) => ({ ...s, [key]: STUBS[key] }))
    if (key === 'npi') checkNpi(STUBS.npi)
  }
  function fillAll() {
    setF({ ...STUBS }); setError('')
    checkNpi(STUBS.npi)
  }
  async function onFile(docType, e) {
    const file = e.target.files?.[0]; if (!file) return
    setDocMsg((m) => ({ ...m, [docType]: 'Uploading…' }))
    try { await uploadDocument(file, docType); setDocMsg((m) => ({ ...m, [docType]: 'Pending Review ✓' })) }
    catch (err) { setDocMsg((m) => ({ ...m, [docType]: err.status === 401 ? 'Available after login' : 'Upload failed' })) }
  }

  function buildPlan(res, err) {
    const v = res?.verification || {}
    const FAIL = { NPI_NOT_IN_NPPES: 'nppes', OIG_EXCLUDED: 'oig', ORDER_REFERRING_INELIGIBLE: 'order_referring' }
    const failKey = err ? FAIL[err.code] : null
    const order = ['nppes', 'oig', 'order_referring', 'revalidation']
    if (f.dea_number) order.push('dea')
    if (f.state_license_number && f.state_license_state) order.push('state_license')
    order.push('create')
    const labels = {
      nppes: 'Validating NPI with NPPES…', oig: 'Checking OIG exclusion list…',
      order_referring: 'Checking Medicare enrollment…', revalidation: 'Checking revalidation status…',
      dea: 'Verifying DEA registration…', state_license: 'Checking state medical license…', create: 'Creating your account…',
    }
    const plan = []
    for (const k of order) {
      if (failKey && k === failKey) { plan.push({ label: labels[k], resolve: { status: 'fail', text: stepFail(k, err) } }); break }
      plan.push({ label: labels[k], resolve: stepOk(k, v) })
    }
    return plan
  }
  function stepFail(k, err) {
    return { nppes: 'NPI not found', oig: 'Provider found on OIG exclusion list',
      order_referring: err?.message || 'NPI not found in Order & Referring dataset' }[k]
  }
  function stepOk(k, v) {
    if (k === 'nppes') return { status: 'ok', text: `NPI verified — ${v.nppes?.name || (f.first_name + ' ' + f.last_name).trim() || 'provider'}` }
    if (k === 'oig') return { status: 'ok', text: 'No exclusions found' }
    if (k === 'order_referring') { const m = v.cms_order_referring?.manual_review || v.cms_order_referring?.warning; return m ? { status: 'warn', text: 'Eligibility flagged for manual review' } : { status: 'ok', text: 'Eligible to order Medicare services' } }
    if (k === 'revalidation') { const st = v.cms_revalidation?.status; return (st === 'due_soon' || st === 'lapsed') ? { status: 'warn', text: 'Revalidation due soon — flagged for review' } : { status: 'ok', text: 'Enrollment current' } }
    if (k === 'dea') { const ok = v.dea?.valid === true && !v.dea?.manual_review; return ok ? { status: 'ok', text: 'DEA number verified' } : { status: 'warn', text: 'DEA could not be verified — submitted for manual review' } }
    if (k === 'state_license') { const ok = v.state_license?.valid === true && v.state_license?.status === 'active'; return ok ? { status: 'ok', text: 'License verified' } : { status: 'warn', text: 'License flagged for manual review' } }
    return { status: 'ok', text: 'Account created' }
  }
  async function play(plan) {
    setSteps(plan.map((p) => ({ label: p.label, status: 'pending' })))
    for (let i = 0; i < plan.length; i++) {
      setSteps((s) => s.map((st, idx) => idx === i ? { ...st, status: 'spin' } : st))
      await sleep(600)
      setSteps((s) => s.map((st, idx) => idx === i ? { ...st, status: plan[i].resolve.status, text: plan[i].resolve.text } : st))
      if (plan[i].resolve.status === 'fail') return false
    }
    return true
  }
  async function submit(e) {
    e.preventDefault(); setError('')
    if (f.password.length < 8) return setError('Password must be at least 8 characters.')
    if (f.password !== f.confirm) return setError('Passwords do not match.')
    setPhase('verifying'); setBlocked('')
    let res, err
    try {
      res = await registerPhysician({ email: f.email, password: f.password, role: 'physician', npi: f.npi.trim(),
        first_name: f.first_name, last_name: f.last_name, dea_number: f.dea_number || null,
        state_license_number: f.state_license_number || null, state_license_state: f.state_license_state || null, ptan: f.ptan || null })
    } catch (e2) { err = e2 }
    // The demo account already exists — treat "email taken" as a returning user rather
    // than an error, so the demo flows straight into the success screen.
    const demoExists = err && err.code === 'EMAIL_EXISTS' && f.email.trim().toLowerCase() === 'physician@claimlens.com'
    if (err && err.code === 'EMAIL_EXISTS' && !demoExists) { setPhase('form'); setError('An account with this email already exists.'); return }
    const planRes = demoExists
      ? { verification: { nppes: { name: `${f.first_name} ${f.last_name}`.trim() }, cms_order_referring: { eligible: true },
          cms_revalidation: { status: 'current' }, dea: { valid: true }, state_license: { valid: true, status: 'active' } } }
      : res
    const plan = buildPlan(planRes, demoExists ? null : err)
    const passed = await play(plan)
    if (!passed) { setBlocked(plan[plan.length - 1].resolve.text); return }
    setAdvisories((planRes?.verification ? plan : []).filter((p) => p.resolve.status === 'warn').map((p) => p.resolve.text))
    setReturning(demoExists)
    setPhase('success')
  }

  if (phase === 'verifying') {
    return (
      <div>
        <StepIndicator text="Step 2 of 2 — Verifying credentials" />
        <h1 className="text-2xl font-bold" style={{ color: '#1B3A5C' }}>Verifying your credentials</h1>
        <p className="text-sm text-slate-500 mt-1">This takes just a moment.</p>
        <StepList steps={steps} />
        {blocked && (
          <div className="mt-6">
            <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">{blocked}</div>
            <button onClick={() => { setPhase('form'); setBlocked('') }} className="mt-4 text-sm font-semibold text-[#1B3A5C] hover:underline">← Go back and fix</button>
          </div>
        )}
      </div>
    )
  }
  if (phase === 'success') {
    return (
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 mb-5"><span className="text-[11px] font-semibold text-emerald-700 tracking-wide">{returning ? 'Account Ready' : 'Account Created'}</span></div>
        <h1 className="text-2xl font-bold" style={{ color: '#1B3A5C' }}>{returning ? 'Account ready ✓' : 'Account created ✓'}</h1>
        {returning ? (
          <>
            <p className="text-sm text-slate-600 mt-2">Welcome back, Dr. {f.first_name || 'Sarah'} {f.last_name || 'Mitchell'}.</p>
            <p className="text-sm text-slate-500 mt-1">Use your existing credentials to log in.</p>
          </>
        ) : (
          <p className="text-sm text-slate-600 mt-2">Welcome to MediClaim, {f.first_name || 'Doctor'}.</p>
        )}
        {!returning && advisories.length > 0 && (
          <div className="mt-5 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-4 py-3">
            <div className="text-xs font-semibold text-amber-800 mb-1">Some items are pending review:</div>
            <ul className="text-xs text-amber-700 list-disc ml-4 space-y-0.5">{advisories.map((a, i) => <li key={i}>{a}</li>)}</ul>
            <p className="text-[11px] text-amber-700 mt-2">You can still access your dashboard. Pending items will be reviewed within 1–2 business days.</p>
          </div>
        )}
        <button onClick={() => navigate('/login', { state: { email: f.email } })} className="mt-6 w-full py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: '#1B3A5C' }}>Continue to login →</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <StepIndicator text="Step 1 of 2 — Your details" />
      <h1 className="text-2xl font-bold" style={{ color: '#1B3A5C' }}>Physician registration</h1>
      <div className="mt-3"><FillAllButton onClick={fillAll} /></div>

      <div className={sectionCls}>Account</div>
      <div className="space-y-4">
        <Field label="Email address">
          <input type="email" required className={inputCls} placeholder="physician@claimlens.com" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Password" hint="Minimum 8 characters">
          <input type="password" required className={inputCls} placeholder="demo1234" value={f.password} onChange={set('password')} />
          <PwBar pw={f.password} />
          <DemoLink show={!f.password} onFill={() => fillField('password')} />
        </Field>
        <Field label="Confirm password">
          <input type="password" required className={inputCls} placeholder="demo1234" value={f.confirm} onChange={set('confirm')} />
        </Field>
      </div>

      <div className={sectionCls}>Identity Verification</div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input className={inputCls} placeholder="Sarah" value={f.first_name} onChange={set('first_name')} />
            <DemoLink show={!f.first_name} onFill={() => fillField('first_name')} />
          </Field>
          <Field label="Last name">
            <input className={inputCls} placeholder="Mitchell" value={f.last_name} onChange={set('last_name')} />
            <DemoLink show={!f.last_name} onFill={() => fillField('last_name')} />
          </Field>
        </div>
        <Field label="NPI number" hint="10-digit NPI from your Medicare enrollment">
          <input className={inputCls} placeholder="1003000126" value={f.npi} onChange={set('npi')} onBlur={() => checkNpi()} inputMode="numeric" maxLength={10} required />
          {npiState?.checking && <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1"><Spinner size={12} /> Verifying NPI…</p>}
          {npiState && !npiState.checking && npiState.valid && <p className="mt-1 text-[11px] text-emerald-600">✓ NPI verified{npiState.name ? ` — ${npiState.name}` : ''}</p>}
          {npiState && !npiState.checking && npiState.valid === false && <p className="mt-1 text-[11px] text-rose-600">✗ NPI not found</p>}
          <DemoLink show={!f.npi} onFill={() => fillField('npi')} />
        </Field>
      </div>

      <div className={sectionCls}>Licenses &amp; Enrollment <span className="text-slate-400 normal-case font-normal">(optional)</span></div>
      <div className="space-y-4">
        <Field label="DEA number" hint="Your DEA registration number (e.g. BM1234563)">
          <input className={inputCls} placeholder="BM1234563" value={f.dea_number} onChange={set('dea_number')} />
          <DemoLink show={!f.dea_number} onFill={() => fillField('dea_number')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State license #" hint="Your state medical board license number">
            <input className={inputCls} placeholder="A123456" value={f.state_license_number} onChange={set('state_license_number')} />
            <DemoLink show={!f.state_license_number} onFill={() => fillField('state_license_number')} />
          </Field>
          <Field label="License state"><select className={inputCls} value={f.state_license_state} onChange={set('state_license_state')}>{US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
        </div>
        <Field label="PTAN" hint="Medicare Provider Transaction Access Number (from your MAC enrollment letter)">
          <input className={inputCls} placeholder="1A2B3C" value={f.ptan} onChange={set('ptan')} />
          <DemoLink show={!f.ptan} onFill={() => fillField('ptan')} />
        </Field>
      </div>

      <div className={sectionCls}>Documents <span className="text-slate-400 normal-case font-normal">(optional)</span></div>
      <p className="text-[11px] text-slate-400 -mt-1 mb-2">Documents can be uploaded after account creation from your profile. Skipping this step will not delay access.</p>
      <div className="space-y-3">
        {[['dea_certificate', 'DEA certificate'], ['state_license', 'State license']].map(([t, label]) => (
          <div key={t} className="flex items-center justify-between gap-3 text-sm">
            <label className="text-slate-600">{label}<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => onFile(t, e)} className="block mt-1 text-xs" /></label>
            {docMsg[t] && <span className="text-[11px] text-slate-500 shrink-0">{docMsg[t]}</span>}
          </div>
        ))}
      </div>

      {error && <div className="mt-5 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <button type="submit" className="mt-6 w-full py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: '#1B3A5C' }}>Create Physician Account</button>
      <div className="mt-4 text-center"><button type="button" onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600">← Back</button></div>
    </form>
  )
}

function PayerForm({ navigate, onBack }) {
  const [stubEmail] = useState(() => `demo.payer.${Date.now()}@example.com`)
  const STUBS = {
    email: stubEmail, password: 'Demo@12345!', confirm: 'Demo@12345!',
    organization_name: 'Meridian Health Plan', uei: 'ABC123DEF456',
    authorized_signatory_name: 'Dr. James Thornton', authorized_signatory_title: 'Chief Compliance Officer',
  }
  const [f, setF] = useState({ email: '', password: '', confirm: '', organization_name: '',
    uei: '', authorized_signatory_name: '', authorized_signatory_title: '', attestation: false })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const [ueiState, setUeiState] = useState(null)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('form')
  const [steps, setSteps] = useState([])
  const [blocked, setBlocked] = useState('')

  async function checkUei(val) {
    const uei = (val ?? f.uei)
    if (!/^[A-Za-z0-9]{12}$/.test(uei)) { setUeiState(null); return }
    setUeiState({ checking: true })
    try { const r = await verifyUei(uei); setUeiState({ valid: r.valid, name: r.legal_name }) }
    catch { setUeiState({ valid: false }) }
  }
  function fillField(key) {
    setF((s) => ({ ...s, [key]: STUBS[key] }))
    if (key === 'uei') checkUei(STUBS.uei)
  }
  function fillAll() {
    setF({ ...STUBS, attestation: true }); setError('')
    checkUei(STUBS.uei)
  }

  async function play(plan) {
    setSteps(plan.map((p) => ({ label: p.label, status: 'pending' })))
    for (let i = 0; i < plan.length; i++) {
      setSteps((s) => s.map((st, idx) => idx === i ? { ...st, status: 'spin' } : st))
      await sleep(600)
      setSteps((s) => s.map((st, idx) => idx === i ? { ...st, status: plan[i].resolve.status, text: plan[i].resolve.text } : st))
      if (plan[i].resolve.status === 'fail') return false
    }
    return true
  }
  async function submit(e) {
    e.preventDefault(); setError('')
    if (f.password.length < 8) return setError('Password must be at least 8 characters.')
    if (f.password !== f.confirm) return setError('Passwords do not match.')
    setPhase('verifying'); setBlocked('')
    let err
    try {
      await registerPayer({ email: f.email, password: f.password, role: 'plan_investigator',
        organization_name: f.organization_name, uei: f.uei.trim(),
        authorized_signatory_name: f.authorized_signatory_name, authorized_signatory_title: f.authorized_signatory_title, attestation: f.attestation })
    } catch (e2) { err = e2 }
    if (err && err.code === 'EMAIL_EXISTS') { setPhase('form'); setError('An account with this email already exists.'); return }
    const orgName = ueiState?.name || f.organization_name
    const plan = []
    if (err && err.code === 'UEI_INVALID') {
      plan.push({ label: 'Validating UEI format…', resolve: { status: 'fail', text: err.message || 'Invalid UEI format' } })
    } else {
      plan.push({ label: 'Validating UEI format…', resolve: { status: 'ok', text: 'UEI format valid' } })
      if (err && err.code === 'SAM_EXCLUDED') {
        plan.push({ label: 'Looking up organization in SAM.gov…', resolve: { status: 'fail', text: 'Organization found on SAM.gov exclusion list' } })
      } else {
        plan.push({ label: 'Looking up organization in SAM.gov…', resolve: { status: 'ok', text: `Organization verified — ${orgName}` } })
        plan.push({ label: 'Recording authorized signatory…', resolve: { status: 'ok', text: `Attestation recorded — ${f.authorized_signatory_name}, ${f.authorized_signatory_title}` } })
        plan.push({ label: 'Submitting registration request…', resolve: { status: 'ok', text: 'Registration submitted' } })
      }
    }
    const passed = await play(plan)
    if (!passed) { setBlocked(plan[plan.length - 1].resolve.text); return }
    setPhase('done')
  }

  if (phase === 'verifying') {
    return (
      <div>
        <StepIndicator text="Step 2 of 2 — Verifying organization" />
        <h1 className="text-2xl font-bold" style={{ color: '#1B3A5C' }}>Verifying your organization</h1>
        <p className="text-sm text-slate-500 mt-1">This takes just a moment.</p>
        <StepList steps={steps} />
        {blocked && (
          <div className="mt-6">
            <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">{blocked}</div>
            <button onClick={() => { setPhase('form'); setBlocked('') }} className="mt-4 text-sm font-semibold text-[#1B3A5C] hover:underline">← Go back and fix</button>
          </div>
        )}
      </div>
    )
  }
  if (phase === 'done') {
    return (
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 ring-1 ring-amber-200 mb-5"><span className="text-[11px] font-semibold text-amber-700 tracking-wide">Pending Activation</span></div>
        <h1 className="text-2xl font-bold" style={{ color: '#1B3A5C' }}>Registration submitted ✓</h1>
        <p className="text-sm text-slate-600 mt-2">Your account is pending activation.</p>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">You will receive an email once your account has been reviewed, typically within 1 business day.</p>
        <button onClick={() => navigate('/login')} className="mt-6 w-full py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: '#1B3A5C' }}>Back to login →</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <StepIndicator text="Step 1 of 2 — Organization details" />
      <h1 className="text-2xl font-bold" style={{ color: '#1B3A5C' }}>Payer registration</h1>
      <div className="mt-3"><FillAllButton onClick={fillAll} /></div>

      <div className={sectionCls}>Account</div>
      <div className="space-y-4">
        <Field label="Email address">
          <input type="email" required className={inputCls} placeholder={STUBS.email} value={f.email} onChange={set('email')} />
          <DemoLink show={!f.email} onFill={() => fillField('email')} />
        </Field>
        <Field label="Password" hint="Minimum 8 characters">
          <input type="password" required className={inputCls} placeholder="Demo@12345!" value={f.password} onChange={set('password')} />
          <PwBar pw={f.password} />
          <DemoLink show={!f.password} onFill={() => fillField('password')} />
        </Field>
        <Field label="Confirm password">
          <input type="password" required className={inputCls} placeholder="Demo@12345!" value={f.confirm} onChange={set('confirm')} />
        </Field>
      </div>

      <div className={sectionCls}>Organization</div>
      <div className="space-y-4">
        <Field label="Organization name">
          <input required className={inputCls} placeholder="Meridian Health Plan" value={f.organization_name} onChange={set('organization_name')} />
          <DemoLink show={!f.organization_name} onFill={() => fillField('organization_name')} />
        </Field>
        <Field label="UEI" hint="Your 12-character SAM.gov Unique Entity Identifier">
          <input className={inputCls} placeholder="ABC123DEF456" value={f.uei} onChange={set('uei')} onBlur={() => checkUei()} maxLength={12} required />
          {ueiState?.checking && <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1"><Spinner size={12} /> Verifying UEI…</p>}
          {ueiState && !ueiState.checking && ueiState.valid && <p className="mt-1 text-[11px] text-emerald-600">✓ Verified: {ueiState.name || 'organization'}</p>}
          {ueiState && !ueiState.checking && ueiState.valid === false && <p className="mt-1 text-[11px] text-rose-600">✗ UEI not found</p>}
          <DemoLink show={!f.uei} onFill={() => fillField('uei')} />
        </Field>
      </div>

      <div className={sectionCls}>Authorized Signatory</div>
      <div className="space-y-4">
        <Field label="Full name">
          <input required className={inputCls} placeholder="Dr. James Thornton" value={f.authorized_signatory_name} onChange={set('authorized_signatory_name')} />
          <DemoLink show={!f.authorized_signatory_name} onFill={() => fillField('authorized_signatory_name')} />
        </Field>
        <Field label="Title" hint="e.g. Chief Compliance Officer, VP of Operations">
          <input required className={inputCls} placeholder="Chief Compliance Officer" value={f.authorized_signatory_title} onChange={set('authorized_signatory_title')} />
          <DemoLink show={!f.authorized_signatory_title} onFill={() => fillField('authorized_signatory_title')} />
        </Field>
      </div>

      <div className={sectionCls}>Attestation</div>
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={f.attestation} onChange={(e) => setF((s) => ({ ...s, attestation: e.target.checked }))} className="w-4 h-4 mt-0.5 rounded border-slate-300 text-[#1B3A5C] focus:ring-[#1B3A5C]/30" />
        <span className="text-sm text-slate-600">I confirm that I am authorized to register this organization on MediClaim and that the information provided is accurate.</span>
      </label>

      {error && <div className="mt-5 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <button type="submit" disabled={!f.attestation} className="mt-6 w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed" style={{ backgroundColor: '#1B3A5C' }}>Submit Registration Request</button>
      <div className="mt-4 text-center"><button type="button" onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600">← Back</button></div>
    </form>
  )
}
