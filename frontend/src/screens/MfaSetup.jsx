// Deactivated — TOTP setup flow replaced by Email OTP.
// Keep for future enterprise/high-security deployment option.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { mfaSetup, mfaVerifySetup } from '../api'
import AuthLayout, { Spinner, StepIndicator, CodeInput } from '../components/AuthLayout'

export default function MfaSetup() {
  const navigate = useNavigate()
  const canvasRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [qrUri, setQrUri] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [copied, setCopied] = useState(false)

  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // On mount: request a TOTP secret + provisioning URI.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError('')
    mfaSetup()
      .then((res) => {
        if (cancelled) return
        setManualCode(res.manual_code)
        setQrUri(res.qr_uri)
      })
      .catch((e) => { if (!cancelled) setLoadError(e.message || 'Could not start MFA setup.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Draw the QR once the canvas is actually mounted (i.e. after loading clears).
  // Drawing inside the fetch .then() fails because the canvas isn't in the DOM yet.
  useEffect(() => {
    if (!loading && qrUri && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrUri, { width: 192, margin: 1 }, (err) => {
        if (err) console.error('QR render failed:', err)
      })
    }
  }, [loading, qrUri])

  const submit = useCallback(async (value) => {
    setSubmitting(true); setError('')
    try {
      const res = await mfaVerifySetup(value)
      // Hand the one-time backup codes to the next screen via sessionStorage —
      // never the URL.
      sessionStorage.setItem('mfa_backup_codes', JSON.stringify(res.backup_codes || []))
      navigate('/mfa/backup-codes', { replace: true })
    } catch (e) {
      if (e.code === 'MFA_NO_SETUP') {
        setError('No setup in progress. Please refresh the page.')
      } else {
        setError('Invalid code. Check your authenticator app and try again.')
      }
      setCode('')
      setSubmitting(false)
    }
  }, [navigate])

  function copyManual() {
    navigator.clipboard?.writeText(manualCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <AuthLayout>
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span className="text-[11px] font-semibold text-emerald-700 tracking-wide">Two-Factor Authentication</span>
      </div>

      <StepIndicator>Step 1 of 2 — Scan QR code</StepIndicator>
      <h1 className="text-3xl font-bold" style={{ color: '#1B3A5C' }}>Secure your account</h1>
      <p className="text-sm text-slate-500 mt-2">
        Set up two-factor authentication to protect your MediClaim account.
      </p>

      {loading ? (
        <div className="mt-8 flex items-center justify-center gap-2 text-slate-500 py-10">
          <Spinner /> <span className="text-sm">Generating your secure key…</span>
        </div>
      ) : loadError ? (
        <div className="mt-8 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : (
        <div className="mt-7 space-y-5">
          {/* QR code */}
          <div className="flex justify-center">
            <div className="p-3 rounded-xl border border-slate-200 bg-white">
              <canvas ref={canvasRef} width={192} height={192} />
            </div>
          </div>

          {/* Can't scan? — manual entry */}
          <div className="text-center">
            <button type="button" onClick={() => setShowManual((v) => !v)}
                    className="text-xs font-medium text-[#1B3A5C] hover:underline">
              {showManual ? 'Hide manual code' : "Can't scan?"}
            </button>
          </div>
          {showManual && (
            <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Manual entry code</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm text-slate-800 break-all">{manualCode}</code>
                <button type="button" onClick={copyManual}
                        className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-white">
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* 6-digit verification */}
          <div className="pt-1">
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 text-center">
              Enter the 6-digit code
            </label>
            <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={submitting} />
            {submitting && (
              <div className="flex items-center justify-center gap-2 text-slate-400 text-xs mt-3">
                <Spinner size={14} /> Verifying…
              </div>
            )}
            {error && (
              <div className="mt-3 text-sm text-rose-600 text-center">{error}</div>
            )}
          </div>

          <p className="text-xs text-slate-400 leading-relaxed text-center">
            Open Google Authenticator, Authy, or any TOTP app and scan the QR code above.
            Then enter the 6-digit code it shows.
          </p>
        </div>
      )}
    </AuthLayout>
  )
}
