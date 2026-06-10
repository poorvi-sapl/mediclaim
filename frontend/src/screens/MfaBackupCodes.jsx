// Deactivated — TOTP setup flow replaced by Email OTP.
// Keep for future enterprise/high-security deployment option.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, DASHBOARD_PATH } from '../context/AuthContext'
import AuthLayout, { StepIndicator } from '../components/AuthLayout'

// "ABCD1234" -> "ABCD-1234" for readability (display only).
function pretty(code) {
  if (typeof code !== 'string') return code
  const mid = Math.ceil(code.length / 2)
  return `${code.slice(0, mid)}-${code.slice(mid)}`
}

export default function MfaBackupCodes() {
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()

  const [codes, setCodes] = useState(null)   // null = not yet read; [] = none available
  const [confirmed, setConfirmed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    const raw = sessionStorage.getItem('mfa_backup_codes')
    if (!raw) { setCodes([]); return }
    try {
      const parsed = JSON.parse(raw)
      setCodes(Array.isArray(parsed) ? parsed : [])
    } catch { setCodes([]) }
  }, [])

  const prettyCodes = (codes || []).map(pretty)

  function copyAll() {
    navigator.clipboard?.writeText(prettyCodes.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  function download() {
    const body =
      `MediClaim MFA Backup Codes\n` +
      `Generated: ${new Date().toLocaleString()}\n\n` +
      `Store these codes safely. Each can only be used once.\n\n` +
      prettyCodes.join('\n') + '\n'
    const blob = new Blob([body], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mediclaim-backup-codes.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function goToDashboard() {
    setFinishing(true)
    sessionStorage.removeItem('mfa_backup_codes')
    // Re-hydrate so the Protected gate sees mfa_enabled=true (just flipped in the DB).
    let role = user?.role
    try { const u = await refreshUser(); role = u?.role || role } catch { /* keep cached */ }
    navigate(DASHBOARD_PATH[role] || '/', { replace: true })
  }

  // Direct navigation / refresh: codes are one-time and gone from sessionStorage.
  if (codes !== null && codes.length === 0) {
    return (
      <AuthLayout>
        <h1 className="text-3xl font-bold" style={{ color: '#1B3A5C' }}>Backup codes</h1>
        <p className="text-sm text-slate-500 mt-3 leading-relaxed">
          Backup codes can only be viewed once during setup. If you've lost your codes,
          contact your administrator.
        </p>
        <button onClick={goToDashboard} disabled={finishing}
                className="mt-8 w-full py-3 rounded-lg text-white font-semibold transition disabled:opacity-70"
                style={{ backgroundColor: '#1B3A5C' }}>
          Go to dashboard
        </button>
      </AuthLayout>
    )
  }

  if (codes === null) return <AuthLayout><div className="py-10" /></AuthLayout>

  return (
    <AuthLayout>
      <StepIndicator>Step 2 of 2 — Save backup codes</StepIndicator>
      <h1 className="text-3xl font-bold" style={{ color: '#1B3A5C' }}>Save your backup codes</h1>

      <div className="mt-5 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-sm text-amber-800 leading-relaxed">
        These codes will only be shown once. Save them somewhere safe — a password manager,
        printed copy, or secure note. Each code can only be used once.
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {prettyCodes.map((c, i) => (
          <div key={i}
               className="font-mono text-sm bg-slate-50 ring-1 ring-slate-200 rounded-lg px-3 py-2 text-center text-slate-800">
            {c}
          </div>
        ))}
      </div>

      <div className="mt-5 flex gap-3">
        <button onClick={copyAll}
                className="flex-1 py-2.5 rounded-lg font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 transition text-sm">
          {copied ? 'Copied ✓' : 'Copy all codes'}
        </button>
        <button onClick={download}
                className="flex-1 py-2.5 rounded-lg font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 transition text-sm">
          Download as .txt
        </button>
      </div>

      <label className="mt-6 flex items-start gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
               className="w-4 h-4 mt-0.5 rounded border-slate-300 text-[#1B3A5C] focus:ring-[#1B3A5C]/30" />
        <span className="text-sm text-slate-600">I have saved my backup codes in a safe place</span>
      </label>

      <button onClick={goToDashboard} disabled={!confirmed || finishing}
              className="mt-6 w-full py-3 rounded-lg text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#1B3A5C' }}>
        Continue to dashboard
      </button>
    </AuthLayout>
  )
}
