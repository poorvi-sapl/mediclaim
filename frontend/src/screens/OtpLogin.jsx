import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { otpVerify, otpResend } from '../api'
import AuthLayout, { Spinner, CodeInput } from '../components/AuthLayout'
import { DASHBOARD_PATH } from '../context/AuthContext'

export default function OtpLogin() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()

  const [token,       setToken]       = useState(null)
  const [resendToken, setResendToken] = useState(null)
  const [maskedEmail, setMaskedEmail] = useState('')
  const [code,        setCode]        = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState('')
  const [locked,      setLocked]      = useState(false)
  const [expired,     setExpired]     = useState(false)
  const [canResend,   setCanResend]   = useState(false)
  const [resent,      setResent]      = useState(false)
  const [countdown,   setCountdown]   = useState(60)

  useEffect(() => {
    const t = sessionStorage.getItem('otp_pending_token')
    if (!t) { navigate('/login', { replace: true }); return }
    setToken(t)
    setResendToken(sessionStorage.getItem('otp_resend_token') || '')
    setMaskedEmail(sessionStorage.getItem('otp_masked_email') || 'your email')
  }, [navigate])

  useEffect(() => {
    if (canResend) return
    if (countdown <= 0) { setCanResend(true); return }
    const id = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [countdown, canResend])

  async function onSuccess(res) {
    ;['otp_pending_token', 'otp_resend_token', 'otp_masked_email'].forEach(k => sessionStorage.removeItem(k))
    try { await refreshUser() } catch { /* gate will re-check */ }
    // After OTP verification, land on the welcome page; the user enters their portal from there.
    navigate('/welcome', { replace: true })
  }

  function handleError(e) {
    if (e.status === 429)      { setLocked(true);  setError('') }
    else if (e.status === 401) { setExpired(true); setError('') }
    else { setError('Invalid or expired code. Please try again.'); setCanResend(true) }
    setSubmitting(false)
  }

  const submit = useCallback(async (value) => {
    if (!token) return
    setSubmitting(true); setError('')
    try { onSuccess(await otpVerify(value, token)) }
    catch (e) { setCode(''); handleError(e) }
  }, [token])

  async function resend() {
    if (!resendToken) return
    setError(''); setResent(false)
    try {
      const res = await otpResend(resendToken)
      setToken(res.otp_pending_token)
      setResendToken(res.resend_token || resendToken)
      sessionStorage.setItem('otp_pending_token', res.otp_pending_token)
      sessionStorage.setItem('otp_resend_token',  res.resend_token || resendToken)
      setCode(''); setResent(true); setCanResend(false); setCountdown(60)
      setTimeout(() => setResent(false), 3000)
    } catch (e) {
      if (e.status === 401) setExpired(true)
      else setError('Could not resend the code. Please try again.')
    }
  }

  function backToLogin() {
    ;['otp_pending_token', 'otp_resend_token', 'otp_masked_email'].forEach(k => sessionStorage.removeItem(k))
    navigate('/login', { replace: true })
  }

  return (
    <AuthLayout>
      {/* Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span className="text-[11px] font-semibold text-emerald-700 tracking-wide">Email Verification</span>
      </div>

      <h1 className="text-[1.6rem] font-extrabold tracking-tight" style={{ color: '#1a3d7c' }}>
        Check your email
      </h1>

      {locked ? (
        <div className="mt-6 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3.5 text-sm text-rose-700 leading-relaxed">
          Too many attempts. Please wait 15 minutes before trying again.
        </div>
      ) : expired ? (
        <>
          <div className="mt-6 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3.5 text-sm text-rose-700">
            Your session has expired. Please sign in again.
          </div>
          <button onClick={backToLogin}
                  className="mt-5 w-full py-3 rounded-xl text-white text-[13px] font-bold transition hover:opacity-90"
                  style={{ backgroundColor: '#1a3d7c' }}>
            Back to login
          </button>
        </>
      ) : (
        <>
          <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
            We sent a 6-digit code to{' '}
            <span className="font-semibold text-slate-700">{maskedEmail}</span>.
            {' '}Enter it below.
          </p>

          {/* Code input */}
          <div className="mt-8 flex flex-col items-center gap-4">
            <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={submitting} />

            {submitting && (
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Spinner size={13} /> Verifying…
              </div>
            )}

            {error && (
              <div className="w-full flex items-start gap-2.5 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3.5 py-2.5">
                <svg className="text-rose-500 shrink-0 mt-0.5" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span className="text-[12px] text-rose-700">{error}</span>
              </div>
            )}

            {resent && (
              <div className="w-full text-center rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-3.5 py-2.5 text-[12px] text-emerald-700 font-medium">
                Code resent successfully ✓
              </div>
            )}
          </div>

          {/* Resend */}
          <div className="mt-6 text-center">
            {canResend ? (
              <button type="button" onClick={resend}
                      className="text-[13px] font-semibold hover:underline"
                      style={{ color: '#1a3d7c' }}>
                Resend code
              </button>
            ) : (
              <span className="text-[12px] text-slate-400">
                Didn't get it? Resend in{' '}
                <span className="font-semibold text-slate-600">{countdown}s</span>
              </span>
            )}
          </div>
        </>
      )}

      {/* Back to login */}
      {!expired && (
        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <button type="button" onClick={backToLogin}
                  className="text-[12px] text-slate-400 hover:text-slate-600 transition-colors">
            ← Back to login
          </button>
        </div>
      )}
    </AuthLayout>
  )
}
