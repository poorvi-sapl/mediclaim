import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth, DASHBOARD_PATH } from '../context/AuthContext'
import { demoLogin } from '../api'

const SHOW_DEMO_CREDS = import.meta.env.DEV

function Spinner() {
  return (
    <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export default function Login() {
  const { login, refreshUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState(location.state?.email || '')   // pre-filled after registration
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showDemoModal, setShowDemoModal] = useState(false)
  const [demoLoading, setDemoLoading] = useState(null)   // 'physician' | 'payer' | null

  // DEMO ENDPOINT — instant one-click access (no password, no OTP).
  async function tryDemo(portal) {
    setDemoLoading(portal); setError('')
    try {
      const r = await demoLogin(portal)
      await refreshUser()              // hydrate AuthContext so Protected lets us in
      setShowDemoModal(false)
      navigate(r.redirect, { replace: true })
    } catch (err) {
      setError(err.message || 'Demo unavailable. Please try again.')
      setDemoLoading(null); setShowDemoModal(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await login(email, password, remember)
      if (res.otp_required) {
        // Hand the OTP step its short-lived tokens + masked email via sessionStorage.
        sessionStorage.setItem('otp_pending_token', res.otp_pending_token)
        sessionStorage.setItem('otp_resend_token', res.resend_token || '')
        sessionStorage.setItem('otp_masked_email', res.masked_email || '')
        navigate('/otp/login', { replace: true })
        return
      }
      // Demo bypass (@claimlens.com) — straight to the dashboard.
      navigate(res.redirect || DASHBOARD_PATH[res.role] || '/', { replace: true })
    } catch (err) {
      setError(err.status === 401
        ? 'Invalid email or password. Please try again.'
        : (err.message || 'Something went wrong. Please try again.'))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* LEFT — navy illustration panel */}
      <div className="hidden md:flex md:w-2/5 flex-col justify-between p-10 text-white relative overflow-hidden"
           style={{ backgroundColor: '#1B3A5C' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">MediClaim Analytics</span>
        </div>

        {/* Illustration */}
        <div className="flex-1 flex items-center justify-center">
          <svg width="240" height="240" viewBox="0 0 200 200" fill="none" className="opacity-90">
            <circle cx="100" cy="100" r="78" fill="#26516f" />
            <path d="M100 44l38 14v30c0 28-38 46-38 46s-38-18-38-46V58z" fill="#3d6e92" />
            <path d="M82 100l12 12 24-26" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="150" cy="60" r="10" fill="#5fb8a8" />
            <circle cx="52" cy="140" r="7" fill="#5fb8a8" opacity="0.7" />
          </svg>
        </div>

        <div>
          <h2 className="text-2xl font-bold leading-tight">Healthcare Fraud<br />Detection Platform</h2>
          <p className="text-sm text-white/60 mt-3 leading-relaxed">
            Real-time claims monitoring and supplier intelligence for Medicare & Medicaid plans.
          </p>
        </div>
        <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full bg-white/[0.04]" />
      </div>

      {/* RIGHT — login form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-20 py-10">
        <div className="w-full max-w-md mx-auto">

          {/* logo (mobile) + badge */}
          <div className="md:hidden flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#1B3A5C' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight" style={{ color: '#1B3A5C' }}>MediClaim Analytics</span>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-semibold text-emerald-700 tracking-wide">Healthcare Fraud Detection Platform</span>
          </div>

          <h1 className="text-3xl font-bold" style={{ color: '#1B3A5C' }}>Welcome Back</h1>
          <p className="text-sm text-slate-500 mt-2">Monitor claims · Detect fraud · Protect patients.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Email Address</label>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                disabled={loading} placeholder="admin@mediclaim.com" autoComplete="username"
                className="w-full px-4 py-3 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20 transition disabled:bg-slate-50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">Password</label>
                <button type="button" className="text-xs font-medium text-[#1B3A5C] hover:underline">Forgot Password?</button>
              </div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} required value={password}
                  onChange={(e) => setPassword(e.target.value)} disabled={loading}
                  placeholder="••••••••" autoComplete="current-password"
                  className="w-full px-4 py-3 pr-12 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20 transition disabled:bg-slate-50"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} tabIndex={-1}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={loading}
                     className="w-4 h-4 rounded border-slate-300 text-[#1B3A5C] focus:ring-[#1B3A5C]/30" />
              <span className="text-sm text-slate-600">Keep me signed in</span>
            </label>

            {error && (
              <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
            )}

            <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-white font-semibold transition disabled:opacity-70"
                    style={{ backgroundColor: '#1B3A5C' }}>
              {loading ? <><Spinner /> Signing in…</> : 'Sign In'}
            </button>

            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs text-slate-400">or</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <button type="button" onClick={() => setShowDemoModal(true)}
                    className="w-full py-3 rounded-lg font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 transition">
              Don't have access? Request a Demo
            </button>
          </form>

          {SHOW_DEMO_CREDS && (
            <div className="mt-8 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-4 py-3 text-xs text-slate-500 leading-relaxed">
              <div className="font-semibold text-slate-600 mb-1">Demo credentials</div>
              <div>Physician: <span className="font-mono">physician@claimlens.com</span> / <span className="font-mono">demo1234</span></div>
              <div>Payer: <span className="font-mono">plan@claimlens.com</span> / <span className="font-mono">demo1234</span></div>
              <div className="mt-1">Or click "Request a Demo" for instant access.</div>
            </div>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            Don't have an account?{' '}
            <button type="button" onClick={() => navigate('/register')}
                    className="font-semibold text-[#1B3A5C] hover:underline">Create an account</button>
          </p>
        </div>
      </div>

      {/* Request-a-Demo modal */}
      {showDemoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
             onClick={() => setShowDemoModal(false)}>
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 sm:p-8 relative"
               onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowDemoModal(false)} aria-label="Close"
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
            <h2 className="text-2xl font-bold" style={{ color: '#1B3A5C' }}>Try a live demo</h2>
            <p className="text-sm text-slate-500 mt-1">Choose a portal to explore MediClaim instantly.</p>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-xl p-5 flex flex-col hover:shadow-md hover:border-[#1B3A5C]/40 transition">
                <div className="text-2xl">🩺</div>
                <div className="font-bold text-slate-800 mt-2">Physician Portal</div>
                <p className="text-xs text-slate-500 mt-2 flex-1 leading-relaxed">
                  See claims filed under your NPI, flag fraud, and dispute orders you didn't place.
                </p>
                <button onClick={() => tryDemo('physician')} disabled={!!demoLoading}
                        className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-70"
                        style={{ backgroundColor: '#1B3A5C' }}>
                  {demoLoading === 'physician' ? <><Spinner /> Loading…</> : 'Try Physician'}
                </button>
              </div>
              <div className="border border-slate-200 rounded-xl p-5 flex flex-col hover:shadow-md hover:border-[#1B3A5C]/40 transition">
                <div className="text-2xl">🏥</div>
                <div className="font-bold text-slate-800 mt-2">Payer Portal</div>
                <p className="text-xs text-slate-500 mt-2 flex-1 leading-relaxed">
                  Investigate fraud, view NPI risk scores, and monitor live alerts.
                </p>
                <button onClick={() => tryDemo('payer')} disabled={!!demoLoading}
                        className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-white font-semibold text-sm transition disabled:opacity-70"
                        style={{ backgroundColor: '#1B3A5C' }}>
                  {demoLoading === 'payer' ? <><Spinner /> Loading…</> : 'Try Payer'}
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 mt-5 text-center leading-relaxed">
              Demo accounts are pre-loaded with synthetic Medicare claims and fraud patterns. No real patient data.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
