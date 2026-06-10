// Email OTP — step 2 of login (replaces the TOTP/authenticator MfaLogin screen).
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { otpVerify, otpResend } from '../api'
import AuthLayout, { Spinner, CodeInput } from '../components/AuthLayout'

export default function OtpLogin() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()

  const [token, setToken] = useState(null)
  const [resendToken, setResendToken] = useState(null)
  const [maskedEmail, setMaskedEmail] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)    // 429 — hide input
  const [expired, setExpired] = useState(false)   // 401 — back to login
  const [canResend, setCanResend] = useState(false)
  const [resent, setResent] = useState(false)

  // A pending token is mandatory; without it the user reached this page directly.
  useEffect(() => {
    const t = sessionStorage.getItem('otp_pending_token')
    if (!t) { navigate('/login', { replace: true }); return }
    setToken(t)
    setResendToken(sessionStorage.getItem('otp_resend_token') || '')
    setMaskedEmail(sessionStorage.getItem('otp_masked_email') || 'your email')
  }, [navigate])

  // Resend becomes available 60s after landing (or immediately after a failed attempt).
  useEffect(() => {
    const id = setTimeout(() => setCanResend(true), 60000)
    return () => clearTimeout(id)
  }, [])

  async function onSuccess(res) {
    ;['otp_pending_token', 'otp_resend_token', 'otp_masked_email'].forEach((k) => sessionStorage.removeItem(k))
    try { await refreshUser() } catch { /* cookie is set; gate will re-check */ }
    navigate(res.redirect || '/', { replace: true })
  }

  function handleError(e) {
    if (e.status === 429) { setLocked(true); setError('') }
    else if (e.status === 401) { setExpired(true); setError('') }
    else { setError('Invalid or expired code. Try again.'); setCanResend(true) }
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
      sessionStorage.setItem('otp_resend_token', res.resend_token || resendToken)
      setCode('')
      setResent(true)
      setTimeout(() => setResent(false), 3000)
    } catch (e) {
      if (e.status === 401) setExpired(true)
      else setError('Could not resend the code. Please try again.')
    }
  }

  function backToLogin() {
    ;['otp_pending_token', 'otp_resend_token', 'otp_masked_email'].forEach((k) => sessionStorage.removeItem(k))
    navigate('/login', { replace: true })
  }

  return (
    <AuthLayout>
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span className="text-[11px] font-semibold text-emerald-700 tracking-wide">Email Verification</span>
      </div>

      <h1 className="text-3xl font-bold" style={{ color: '#1B3A5C' }}>Check your email</h1>

      {locked ? (
        <div className="mt-6 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">
          Too many attempts. Please wait 15 minutes before trying again.
        </div>
      ) : expired ? (
        <>
          <div className="mt-6 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">
            Session expired.
          </div>
          <button onClick={backToLogin}
                  className="mt-5 w-full py-3 rounded-lg text-white font-semibold transition"
                  style={{ backgroundColor: '#1B3A5C' }}>
            Back to login
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-500 mt-2">
            We sent a 6-digit code to <span className="font-semibold text-slate-700">{maskedEmail}</span>. Enter it below.
          </p>
          <div className="mt-7">
            <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={submitting} />
            {submitting && (
              <div className="flex items-center justify-center gap-2 text-slate-400 text-xs mt-3">
                <Spinner size={14} /> Verifying…
              </div>
            )}
            {error && <div className="mt-3 text-sm text-rose-600 text-center">{error}</div>}
            {resent && <div className="mt-3 text-sm text-emerald-600 text-center">Code resent ✓</div>}
          </div>

          <div className="mt-6 text-center">
            {canResend ? (
              <button type="button" onClick={resend} className="text-sm font-medium text-[#1B3A5C] hover:underline">
                Resend code
              </button>
            ) : (
              <span className="text-xs text-slate-400">Didn't get it? You can resend in a moment.</span>
            )}
          </div>
        </>
      )}

      {!expired && (
        <div className="mt-8 text-center">
          <button type="button" onClick={backToLogin} className="text-xs text-slate-400 hover:text-slate-600">
            ← Back to login
          </button>
        </div>
      )}
    </AuthLayout>
  )
}
