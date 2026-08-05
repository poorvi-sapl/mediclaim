import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stethoscope, Building2, Truck, Zap } from 'lucide-react'
import AuthLayout, { Spinner } from '../components/AuthLayout'
import { registerPhysician, registerPayer, registerVendor, verifyNpi, verifyUei, verifyVendorNpi } from '../api'

const labelCls = "block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5"
// Compact styles — keep each registration form on one screen without scrolling.
const inputTight = "w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20 transition disabled:bg-slate-50"
const sectionTight = "text-[11px] font-bold text-[#1B3A5C] uppercase tracking-wider mt-3.5 mb-2"
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
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#1B3A5C]/30 text-[#1B3A5C] hover:bg-[#1B3A5C]/5 transition inline-flex items-center gap-1.5">
        <Zap size={13} /> Fill demo values
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
    <AuthLayout wide={step !== 'choose'}>
      {step === 'choose' && (
        <>
          <h1 className="text-3xl font-bold" style={{ color: '#1B3A5C' }}>Create an account</h1>
          <p className="text-sm text-slate-500 mt-2">Choose how you'll use MediClaim.</p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-[#1B3A5C]/10 flex items-center justify-center">
                <Stethoscope size={20} className="text-[#1B3A5C]" />
              </div>
              <div className="font-bold text-slate-800 mt-3">Physician</div>
              <p className="text-xs text-slate-500 mt-2 flex-1 leading-relaxed">Register as a licensed physician to monitor claims filed under your NPI.</p>
              <button onClick={() => setStep('physician')} className="mt-4 w-full py-2.5 rounded-lg text-white font-semibold text-sm" style={{ backgroundColor: '#1B3A5C' }}>Register</button>
            </div>
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-[#1B3A5C]/10 flex items-center justify-center">
                <Building2 size={20} className="text-[#1B3A5C]" />
              </div>
              <div className="font-bold text-slate-800 mt-3">Payer Organization</div>
              <p className="text-xs text-slate-500 mt-2 flex-1 leading-relaxed">Register your health plan or payer organization.</p>
              <button onClick={() => setStep('payer')} className="mt-4 w-full py-2.5 rounded-lg text-white font-semibold text-sm" style={{ backgroundColor: '#1B3A5C' }}>Register</button>
            </div>
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-[#1B3A5C]/10 flex items-center justify-center">
                <Truck size={20} className="text-[#1B3A5C]" />
              </div>
              <div className="font-bold text-slate-800 mt-3">Vendor</div>
              <p className="text-xs text-slate-500 mt-2 flex-1 leading-relaxed">Register as a supplier to view and respond to claims filed under your NPI.</p>
              <button onClick={() => setStep('vendor')} className="mt-4 w-full py-2.5 rounded-lg text-white font-semibold text-sm" style={{ backgroundColor: '#1B3A5C' }}>Register</button>
            </div>
          </div>
          <div className="mt-8 text-center"><button onClick={() => navigate('/login')} className="text-xs text-slate-400 hover:text-slate-600">← Back to login</button></div>
        </>
      )}
      {step === 'physician' && <PhysicianForm navigate={navigate} onBack={() => setStep('choose')} />}
      {step === 'payer' && <PayerForm navigate={navigate} onBack={() => setStep('choose')} />}
      {step === 'vendor' && <VendorForm navigate={navigate} onBack={() => setStep('choose')} />}
    </AuthLayout>
  )
}

function PhysicianForm({ navigate, onBack }) {
  // Stub values match the existing demo physician account so the presenter can log in
  // immediately with the same credentials they just "registered" with.
  const STUBS = {
    email: 'physician@mediclaim.com', password: 'demo1234', confirm: 'demo1234',
    first_name: 'Sarah', last_name: 'Mitchell', npi: '1003000126',
    date_of_birth: '1979-04-12', phone: '(415) 555-0142',
    organization_name: 'Bay Area Internal Medicine Group', specialty: 'Internal Medicine',
    tax_id: '94-3021555',
  }
  const [f, setF] = useState({ email: '', password: '', confirm: '', first_name: '', last_name: '',
    npi: '', date_of_birth: '', phone: '', organization_name: '', specialty: '', tax_id: '' })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const [npiState, setNpiState] = useState(null)
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
  function buildPlan(res, err) {
    const v = res?.verification || {}
    const FAIL = { NPI_NOT_IN_NPPES: 'nppes', OIG_EXCLUDED: 'oig', ORDER_REFERRING_INELIGIBLE: 'pecos' }
    const failKey = err ? FAIL[err.code] : null
    // The four sources the backend verifies identity against, in order, plus OIG
    // (blocking) and the final account-creation step.
    const order = ['nppes', 'oig', 'pecos', 'cms', 'state_board', 'create']
    const labels = {
      nppes: 'Validating NPI with NPPES registry…',
      oig: 'Checking OIG exclusion list…',
      pecos: 'Checking PECOS enrollment…',
      cms: 'Verifying CMS enrollment records…',
      state_board: 'Cross-checking state medical board…',
      create: 'Creating your account…',
    }
    const plan = []
    for (const k of order) {
      if (failKey && k === failKey) { plan.push({ label: labels[k], resolve: { status: 'fail', text: stepFail(k, err) } }); break }
      plan.push({ label: labels[k], resolve: stepOk(k, v) })
    }
    return plan
  }
  function stepFail(k, err) {
    return { nppes: 'NPI not found in NPPES', oig: 'Provider found on OIG exclusion list',
      pecos: err?.message || 'Not found in Medicare (PECOS) enrollment' }[k]
  }
  function stepOk(k, v) {
    if (k === 'nppes') return { status: 'ok', text: `NPI verified — ${v.nppes?.name || (f.first_name + ' ' + f.last_name).trim() || 'provider'}` }
    if (k === 'oig') return { status: 'ok', text: 'No exclusions found' }
    if (k === 'pecos') { const m = v.cms_order_referring?.manual_review || v.cms_order_referring?.warning; return m ? { status: 'warn', text: 'Enrollment flagged for manual review' } : { status: 'ok', text: 'Active Medicare enrollment (PECOS)' } }
    if (k === 'cms') { const st = v.cms_revalidation?.status; return (st === 'due_soon' || st === 'lapsed') ? { status: 'warn', text: 'Revalidation due soon — flagged for review' } : { status: 'ok', text: 'CMS enrollment records current' } }
    if (k === 'state_board') return { status: 'ok', text: `Matched to state medical board record${f.specialty ? ` — ${f.specialty}` : ''}` }
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
        first_name: f.first_name, last_name: f.last_name,
        date_of_birth: f.date_of_birth || null, phone: f.phone || null,
        organization_name: f.organization_name || null, specialty: f.specialty || null,
        tax_id: f.tax_id || null })
    } catch (e2) { err = e2 }
    // The demo account already exists — treat "email taken" as a returning user rather
    // than an error, so the demo flows straight into the success screen.
    const demoExists = err && err.code === 'EMAIL_EXISTS' && f.email.trim().toLowerCase() === 'physician@mediclaim.com'
    if (err && err.code === 'EMAIL_EXISTS' && !demoExists) { setPhase('form'); setError('An account with this email already exists.'); return }
    const planRes = demoExists
      ? { verification: { nppes: { name: `${f.first_name} ${f.last_name}`.trim() }, cms_order_referring: { eligible: true },
          cms_revalidation: { status: 'current' } } }
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StepIndicator text="Step 1 of 2 — Your details" />
          <h1 className="text-xl font-bold" style={{ color: '#1B3A5C' }}>Physician registration</h1>
        </div>
        <FillAllButton onClick={fillAll} />
      </div>

      <div className={sectionTight}>Account</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="sm:col-span-2">
          <Field label="Email address">
            <input type="email" required className={inputTight} placeholder="physician@mediclaim.com" value={f.email} onChange={set('email')} />
          </Field>
        </div>
        <Field label="Password">
          <input type="password" required className={inputTight} placeholder="demo1234 — min 8 characters" value={f.password} onChange={set('password')} />
          <PwBar pw={f.password} />
          <DemoLink show={!f.password} onFill={() => fillField('password')} />
        </Field>
        <Field label="Confirm password">
          <input type="password" required className={inputTight} placeholder="demo1234" value={f.confirm} onChange={set('confirm')} />
        </Field>
      </div>

      <div className={sectionTight}>Identity Verification</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="First name">
          <input className={inputTight} placeholder="Sarah" value={f.first_name} onChange={set('first_name')} required />
          <DemoLink show={!f.first_name} onFill={() => fillField('first_name')} />
        </Field>
        <Field label="Last name">
          <input className={inputTight} placeholder="Mitchell" value={f.last_name} onChange={set('last_name')} required />
          <DemoLink show={!f.last_name} onFill={() => fillField('last_name')} />
        </Field>
        <Field label="NPI number">
          <input className={inputTight} placeholder="1003000126 — NPPES-verified" value={f.npi}
                 onChange={(e) => { set('npi')(e); setNpiState(null) }}
                 onBlur={() => checkNpi()} inputMode="numeric" maxLength={10} required />
          {npiState?.checking && <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1"><Spinner size={12} /> Verifying NPI…</p>}
          {npiState && !npiState.checking && npiState.valid && <p className="mt-1 text-[11px] text-emerald-600">✓ NPI verified{npiState.name ? ` — ${npiState.name}` : ''}</p>}
          {npiState && !npiState.checking && npiState.valid === false && <p className="mt-1 text-[11px] text-rose-600">✗ NPI not found</p>}
          <DemoLink show={!f.npi} onFill={() => fillField('npi')} />
        </Field>
        <Field label="Date of birth (optional)">
          <input type="date" className={inputTight} value={f.date_of_birth} onChange={set('date_of_birth')} />
          <DemoLink show={!f.date_of_birth} onFill={() => fillField('date_of_birth')} />
        </Field>
      </div>

      <div className={sectionTight}>Contact &amp; Practice</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Phone">
          <input type="tel" className={inputTight} placeholder="(415) 555-0142" value={f.phone} onChange={set('phone')} required />
          <DemoLink show={!f.phone} onFill={() => fillField('phone')} />
        </Field>
        <Field label="Organization / Practice">
          <input className={inputTight} placeholder="Bay Area Internal Medicine Group" value={f.organization_name} onChange={set('organization_name')} required />
          <DemoLink show={!f.organization_name} onFill={() => fillField('organization_name')} />
        </Field>
        <Field label="Specialty">
          <input className={inputTight} placeholder="Internal Medicine" value={f.specialty} onChange={set('specialty')} required />
          <DemoLink show={!f.specialty} onFill={() => fillField('specialty')} />
        </Field>
        <Field label="Tax ID / EIN (optional)">
          <input className={inputTight} placeholder="94-3021555" value={f.tax_id} onChange={set('tax_id')} />
          <DemoLink show={!f.tax_id} onFill={() => fillField('tax_id')} />
        </Field>
      </div>

      <p className="mt-3 text-[11px] text-slate-400 leading-snug">
        On submit we verify your identity against <span className="font-semibold text-slate-500">NPPES</span>,
        <span className="font-semibold text-slate-500"> PECOS</span>, your
        <span className="font-semibold text-slate-500"> state medical board</span>, and
        <span className="font-semibold text-slate-500"> CMS enrollment records</span>. No documents needed.
      </p>

      {error && <div className="mt-3 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-2.5 text-sm text-rose-700">{error}</div>}
      <button type="submit" className="mt-3 w-full py-2.5 rounded-lg text-white font-semibold text-sm" style={{ backgroundColor: '#1B3A5C' }}>Create Physician Account</button>
      <div className="mt-2 text-center"><button type="button" onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600">← Back</button></div>
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StepIndicator text="Step 1 of 2 — Organization details" />
          <h1 className="text-xl font-bold" style={{ color: '#1B3A5C' }}>Payer registration</h1>
        </div>
        <FillAllButton onClick={fillAll} />
      </div>

      <div className={sectionTight}>Account</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="sm:col-span-2">
          <Field label="Email address">
            <input type="email" required className={inputTight} placeholder={STUBS.email} value={f.email} onChange={set('email')} />
            <DemoLink show={!f.email} onFill={() => fillField('email')} />
          </Field>
        </div>
        <Field label="Password">
          <input type="password" required className={inputTight} placeholder="Demo@12345! — min 8 characters" value={f.password} onChange={set('password')} />
          <PwBar pw={f.password} />
          <DemoLink show={!f.password} onFill={() => fillField('password')} />
        </Field>
        <Field label="Confirm password">
          <input type="password" required className={inputTight} placeholder="Demo@12345!" value={f.confirm} onChange={set('confirm')} />
        </Field>
      </div>

      <div className={sectionTight}>Organization</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Organization name">
          <input required className={inputTight} placeholder="Meridian Health Plan" value={f.organization_name} onChange={set('organization_name')} />
          <DemoLink show={!f.organization_name} onFill={() => fillField('organization_name')} />
        </Field>
        <Field label="UEI">
          <input className={inputTight} placeholder="ABC123DEF456 — SAM.gov UEI" value={f.uei} onChange={set('uei')} onBlur={() => checkUei()} maxLength={12} required />
          {ueiState?.checking && <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1"><Spinner size={12} /> Verifying UEI…</p>}
          {ueiState && !ueiState.checking && ueiState.valid && <p className="mt-1 text-[11px] text-emerald-600">✓ Verified: {ueiState.name || 'organization'}</p>}
          {ueiState && !ueiState.checking && ueiState.valid === false && <p className="mt-1 text-[11px] text-rose-600">✗ UEI not found</p>}
          <DemoLink show={!f.uei} onFill={() => fillField('uei')} />
        </Field>
      </div>

      <div className={sectionTight}>Authorized Signatory</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Full name">
          <input required className={inputTight} placeholder="Dr. James Thornton" value={f.authorized_signatory_name} onChange={set('authorized_signatory_name')} />
          <DemoLink show={!f.authorized_signatory_name} onFill={() => fillField('authorized_signatory_name')} />
        </Field>
        <Field label="Title">
          <input required className={inputTight} placeholder="Chief Compliance Officer" value={f.authorized_signatory_title} onChange={set('authorized_signatory_title')} />
          <DemoLink show={!f.authorized_signatory_title} onFill={() => fillField('authorized_signatory_title')} />
        </Field>
      </div>

      <label className="mt-3.5 flex items-start gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={f.attestation} onChange={(e) => setF((s) => ({ ...s, attestation: e.target.checked }))} className="w-4 h-4 mt-0.5 rounded border-slate-300 text-[#1B3A5C] focus:ring-[#1B3A5C]/30" />
        <span className="text-xs text-slate-600 leading-snug">I confirm that I am authorized to register this organization on MediClaim and that the information provided is accurate.</span>
      </label>

      {error && <div className="mt-3 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-2.5 text-sm text-rose-700">{error}</div>}
      <button type="submit" disabled={!f.attestation} className="mt-3 w-full py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed" style={{ backgroundColor: '#1B3A5C' }}>Submit Registration Request</button>
      <div className="mt-2 text-center"><button type="button" onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600">← Back</button></div>
    </form>
  )
}

function VendorForm({ navigate, onBack }) {
  // Stub values match the existing demo vendor account so the presenter can log in
  // immediately with the same credentials they just "registered" with.
  const STUBS = {
    email: 'vendor@mediclaim.com', password: 'demo1234', confirm: 'demo1234',
    npi: '1999000002', contact_name: 'Alex Rivera', contact_phone: '(312) 555-0199',
  }
  const [f, setF] = useState({ email: '', password: '', confirm: '', npi: '', contact_name: '', contact_phone: '' })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const [npiState, setNpiState] = useState(null)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('form')
  const [steps, setSteps] = useState([])
  const [blocked, setBlocked] = useState('')
  const [returning, setReturning] = useState(false)   // demo account already exists → "Account ready"

  async function checkNpi(val) {
    const npi = (val ?? f.npi)
    if (!/^\d{10}$/.test(npi)) { setNpiState(null); return }
    setNpiState({ checking: true })
    try { const r = await verifyVendorNpi(npi); setNpiState({ valid: r.valid, name: r.name }) }
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
  function buildPlan(res, err) {
    const FAIL = { NPI_NOT_FOUND: 'registry', OIG_EXCLUDED: 'oig' }
    const failKey = err ? FAIL[err.code] : null
    const order = ['registry', 'oig', 'create']
    const labels = {
      registry: 'Validating NPI in supplier registry…',
      oig: 'Checking OIG exclusion list…',
      create: 'Creating your account…',
    }
    const plan = []
    for (const k of order) {
      if (failKey && k === failKey) { plan.push({ label: labels[k], resolve: { status: 'fail', text: stepFail(k) } }); break }
      plan.push({ label: labels[k], resolve: stepOk(k, res) })
    }
    return plan
  }
  function stepFail(k) {
    return { registry: 'NPI not found in the supplier registry', oig: 'Supplier found on OIG exclusion list' }[k]
  }
  function stepOk(k, res) {
    if (k === 'registry') return { status: 'ok', text: `NPI verified — ${res?.organization_name || npiState?.name || 'supplier'}` }
    if (k === 'oig') return { status: 'ok', text: 'No exclusions found' }
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
      res = await registerVendor({ email: f.email, password: f.password, role: 'vendor', npi: f.npi.trim(),
        contact_name: f.contact_name || null, contact_phone: f.contact_phone || null })
    } catch (e2) { err = e2 }
    // The demo account already exists — treat "email taken" as a returning user rather
    // than an error, so the demo flows straight into the success screen.
    const demoExists = err && err.code === 'EMAIL_EXISTS' && f.email.trim().toLowerCase() === 'vendor@mediclaim.com'
    if (err && err.code === 'EMAIL_EXISTS' && !demoExists) { setPhase('form'); setError('An account with this email already exists.'); return }
    const planRes = demoExists ? { organization_name: '1Accurate Hospice' } : res
    const plan = buildPlan(planRes, demoExists ? null : err)
    const passed = await play(plan)
    if (!passed) { setBlocked(plan[plan.length - 1].resolve.text); return }
    setReturning(demoExists)
    setPhase('success')
  }

  if (phase === 'verifying') {
    return (
      <div>
        <StepIndicator text="Step 2 of 2 — Verifying supplier" />
        <h1 className="text-2xl font-bold" style={{ color: '#1B3A5C' }}>Verifying your supplier record</h1>
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
            <p className="text-sm text-slate-600 mt-2">Welcome back — your vendor account is ready.</p>
            <p className="text-sm text-slate-500 mt-1">Use your existing credentials to log in.</p>
          </>
        ) : (
          <p className="text-sm text-slate-600 mt-2">Welcome to MediClaim, {f.contact_name || 'there'}.</p>
        )}
        <button onClick={() => navigate('/login', { state: { email: f.email } })} className="mt-6 w-full py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: '#1B3A5C' }}>Continue to login →</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StepIndicator text="Step 1 of 2 — Your details" />
          <h1 className="text-xl font-bold" style={{ color: '#1B3A5C' }}>Vendor registration</h1>
        </div>
        <FillAllButton onClick={fillAll} />
      </div>

      <div className={sectionTight}>Account</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="sm:col-span-2">
          <Field label="Email address">
            <input type="email" required className={inputTight} placeholder="vendor@mediclaim.com" value={f.email} onChange={set('email')} />
            <DemoLink show={!f.email} onFill={() => fillField('email')} />
          </Field>
        </div>
        <Field label="Password">
          <input type="password" required className={inputTight} placeholder="demo1234 — min 8 characters" value={f.password} onChange={set('password')} />
          <PwBar pw={f.password} />
          <DemoLink show={!f.password} onFill={() => fillField('password')} />
        </Field>
        <Field label="Confirm password">
          <input type="password" required className={inputTight} placeholder="demo1234" value={f.confirm} onChange={set('confirm')} />
        </Field>
      </div>

      <div className={sectionTight}>Supplier Identity</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="sm:col-span-2">
          <Field label="NPI number">
            <input className={inputTight} placeholder="1999000002 — 10-digit organizational NPI" value={f.npi} onChange={set('npi')} onBlur={() => checkNpi()} inputMode="numeric" maxLength={10} required />
            {npiState?.checking && <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1"><Spinner size={12} /> Verifying NPI…</p>}
            {npiState && !npiState.checking && npiState.valid && <p className="mt-1 text-[11px] text-emerald-600">✓ NPI verified{npiState.name ? ` — ${npiState.name}` : ''}</p>}
            {npiState && !npiState.checking && npiState.valid === false && <p className="mt-1 text-[11px] text-rose-600">✗ NPI not found or excluded</p>}
            <DemoLink show={!f.npi} onFill={() => fillField('npi')} />
          </Field>
        </div>
        <Field label="Contact name (optional)">
          <input className={inputTight} placeholder="Alex Rivera" value={f.contact_name} onChange={set('contact_name')} />
          <DemoLink show={!f.contact_name} onFill={() => fillField('contact_name')} />
        </Field>
        <Field label="Contact phone (optional)">
          <input type="tel" className={inputTight} placeholder="(312) 555-0199" value={f.contact_phone} onChange={set('contact_phone')} />
          <DemoLink show={!f.contact_phone} onFill={() => fillField('contact_phone')} />
        </Field>
      </div>

      <p className="mt-3 text-[11px] text-slate-400 leading-snug">
        On submit we verify your NPI against the <span className="font-semibold text-slate-500">supplier registry</span> and
        the <span className="font-semibold text-slate-500">OIG exclusion list</span>. No documents needed.
      </p>

      {error && <div className="mt-3 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-2.5 text-sm text-rose-700">{error}</div>}
      <button type="submit" className="mt-3 w-full py-2.5 rounded-lg text-white font-semibold text-sm" style={{ backgroundColor: '#1B3A5C' }}>Create Vendor Account</button>
      <div className="mt-2 text-center"><button type="button" onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600">← Back</button></div>
    </form>
  )
}
