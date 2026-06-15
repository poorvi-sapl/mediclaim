import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth, DASHBOARD_PATH } from '../context/AuthContext'
import { demoLogin } from '../api'
import bgImage from './bg-image.png'
import illustration from './illustration-family-life.png'

const SHOW_DEMO_CREDS = import.meta.env.DEV

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export default function Login() {
  const { login, refreshUser } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()

  const [email,    setEmail]    = useState(location.state?.email || '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [showDemoModal, setShowDemoModal] = useState(false)
  const [demoLoading,   setDemoLoading]   = useState(null)

  async function tryDemo(portal) {
    setDemoLoading(portal); setError('')
    try {
      const r = await demoLogin(portal)
      const u = await refreshUser()
      setShowDemoModal(false)
      navigate(r.redirect || DASHBOARD_PATH[u?.role] || '/', { replace: true })
    } catch (err) {
      setError(err.message || 'Demo unavailable. Please try again.')
      setDemoLoading(null); setShowDemoModal(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await login(email, password, remember)
      if (res.otp_required) {
        sessionStorage.setItem('otp_pending_token', res.otp_pending_token)
        sessionStorage.setItem('otp_resend_token',  res.resend_token || '')
        sessionStorage.setItem('otp_masked_email',  res.masked_email || '')
        navigate('/otp/login', { replace: true })
        return
      }
      navigate(res.redirect || DASHBOARD_PATH[res.role] || DASHBOARD_PATH['physician'], { replace: true })
    } catch (err) {
      setError(err.status === 401
        ? 'Invalid email or password. Please try again.'
        : (err.message || 'Unable to reach the server. Check your connection and try again.'))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-3 sm:p-6"
         style={{ backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>

      {/* Blurred overlay */}
      <div className="absolute inset-0 bg-white/25 backdrop-blur-sm" />

      {/* Centered card */}
      <div className="relative z-10 w-full max-w-[1160px] flex rounded-2xl shadow-2xl overflow-hidden" style={{ minHeight: 'clamp(0px, 85vh, 680px)' }}>
        <button
          onClick={() => navigate('/welcome')}
          aria-label="Close"
          className="absolute top-4 right-4 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-all text-xl leading-none">
          ×
        </button>

        {/* ── LEFT: illustration panel ── */}
        <div className="hidden lg:flex w-[48%] flex-shrink-0 flex-col items-center justify-center relative self-stretch"
             style={{ backgroundColor: '#1a3d7c' }}>
          <img src={illustration} alt="Healthcare protection"
               className="w-[85%] object-contain"
               style={{ maxHeight: '78%' }} />
        </div>

        {/* ── RIGHT: form panel ── */}
        <div className="flex-1 bg-white flex flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-9 lg:py-8">

          {/* Logo + badge */}
          <div className="mb-4 sm:mb-5">
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#1a3d7c' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>
                </svg>
              </div>
              <span className="text-[15px] font-bold text-slate-800 tracking-tight">MedClaim Analytics</span>
            </div>
            <div className="inline-flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-semibold text-slate-600 tracking-wide">Healthcare Fraud Detection Platform</span>
            </div>
          </div>

          <div className="border-t border-slate-100 mb-4 sm:mb-5" />

          {/* Heading */}
          <div className="mb-4 sm:mb-5">
            <h1 className="text-2xl sm:text-[1.55rem] font-extrabold tracking-tight" style={{ color: '#1a3d7c' }}>Welcome Back</h1>
            <p className="text-[11px] text-slate-400 mt-1">Monitor claims · Detect fraud · Protect patients.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 flex-1">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email Address</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                     disabled={loading} placeholder="admin@medclaim.gov" autoComplete="username"
                     className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-[13px] placeholder-slate-300 outline-none focus:border-[#1a3d7c]/40 focus:ring-2 focus:ring-[#1a3d7c]/10 transition-all bg-white disabled:opacity-60" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Password</label>
                <button type="button" className="text-[11px] font-semibold hover:underline" style={{ color: '#1a3d7c' }}>Forgot Password?</button>
              </div>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} required value={password}
                       onChange={e => setPassword(e.target.value)} disabled={loading}
                       placeholder="••••••••••" autoComplete="current-password"
                       className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-slate-200 text-slate-800 text-[13px] placeholder-slate-300 outline-none focus:border-[#1a3d7c]/40 focus:ring-2 focus:ring-[#1a3d7c]/10 transition-all bg-white disabled:opacity-60" />
                <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  {showPw
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} disabled={loading}
                     className="w-4 h-4 rounded border-slate-300 focus:ring-[#1a3d7c]/30" style={{ accentColor: '#1a3d7c' }} />
              <span className="text-[12px] text-slate-600">Keep me signed in</span>
            </label>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3.5 py-2.5">
                <svg className="text-rose-500 shrink-0 mt-0.5" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span className="text-[12px] text-rose-700 leading-snug">{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all hover:opacity-90 disabled:opacity-70"
                    style={{ backgroundColor: '#1a3d7c' }}>
              {loading ? <><Spinner />Signing in…</> : <>Sign In <span className="ml-0.5">→</span></>}
            </button>

          </form>

          {/* Demo credentials */}
          {SHOW_DEMO_CREDS && (
            <div className="mt-4 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Demo Credentials</div>
              <div className="space-y-1.5">
                {[
                  { label: 'Physician', email: 'physician@mediclaim.com', password: 'demo1234' },
                  { label: 'Payer',     email: 'payer@mediclaim.com',     password: 'demo1234' },
                ].map(({ label, email: demoEmail, password: demoPw }) => (
                  <button key={label} type="button"
                          onClick={() => { setEmail(demoEmail); setPassword(demoPw); setError('') }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-[#1a3d7c]/30 hover:bg-[#EEF2F7] transition-all text-left group">
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-slate-600 group-hover:text-[#1a3d7c] transition-colors">{label}</span>
                      <span className="ml-2 text-[11px] font-mono text-slate-400 truncate">{demoEmail}</span>
                    </div>
                    <span className="text-[10px] font-semibold text-[#1a3d7c] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Use →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-4 text-center text-[12px] text-slate-500">
            Don't have an account?{' '}
            <button type="button" onClick={() => navigate('/register')}
                    className="font-semibold hover:underline" style={{ color: '#1a3d7c' }}>Create an account</button>
          </p>
        </div>
      </div>

      {/* Demo modal — rendered via portal so the page backdrop-blur cannot trap it */}
      {showDemoModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4"
             onClick={() => setShowDemoModal(false)}>
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 sm:p-8 relative"
               onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowDemoModal(false)} aria-label="Close"
                    className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors text-xl leading-none">×</button>
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900">Try a live demo</h2>
              <p className="text-sm text-slate-500 mt-1">Choose a portal to explore MediClaim instantly — no sign-up needed.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { portal: 'physician', emoji: '🩺', title: 'Physician Portal', desc: "See claims filed under your NPI, flag fraud, and dispute orders you didn't place." },
                { portal: 'payer',    emoji: '🏥', title: 'Payer Portal',     desc: 'Investigate fraud, view NPI risk scores, and monitor live alerts across physicians.' },
              ].map(({ portal, emoji, title, desc }) => (
                <div key={portal} className="border border-slate-200 rounded-xl p-5 flex flex-col hover:border-[#1a3d7c]/30 hover:shadow-md transition-all">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl mb-3">{emoji}</div>
                  <div className="font-bold text-slate-800 text-[14px]">{title}</div>
                  <p className="text-[12px] text-slate-500 mt-1.5 flex-1 leading-relaxed">{desc}</p>
                  <button onClick={() => tryDemo(portal)} disabled={!!demoLoading}
                          className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-[13px] font-semibold transition-all hover:-translate-y-0.5 disabled:opacity-60"
                          style={{ backgroundColor: '#1a3d7c' }}>
                    {demoLoading === portal ? <><Spinner />Loading…</> : `Try ${title.split(' ')[0]}`}
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-5 text-center leading-relaxed">
              Demo accounts use synthetic Medicare claims — no real patient data.
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
