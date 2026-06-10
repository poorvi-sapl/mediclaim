// Shared shell for the auth-flow screens (MFA setup / backup codes / 2FA login).
// Mirrors the /login page layout exactly: navy illustration panel on the left,
// centered content card (max-w-md) on the right.

function ShieldLogo({ light }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke={light ? 'white' : '#1B3A5C'} strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
    </svg>
  )
}

export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex bg-white">
      {/* LEFT — navy illustration panel (matches /login) */}
      <div className="hidden md:flex md:w-2/5 flex-col justify-between p-10 text-white relative overflow-hidden"
           style={{ backgroundColor: '#1B3A5C' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
            <ShieldLogo light />
          </div>
          <span className="text-lg font-bold tracking-tight">MediClaim Analytics</span>
        </div>

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
            Real-time claims monitoring and supplier intelligence for Medicare &amp; Medicaid plans.
          </p>
        </div>
        <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full bg-white/[0.04]" />
      </div>

      {/* RIGHT — content card */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-20 py-10">
        <div className="w-full max-w-md mx-auto">
          {/* logo (mobile) */}
          <div className="md:hidden flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#1B3A5C' }}>
              <ShieldLogo light />
            </div>
            <span className="text-lg font-bold tracking-tight" style={{ color: '#1B3A5C' }}>MediClaim Analytics</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

// Spinner reused across auth screens (same markup as the /login spinner).
export function Spinner({ size = 18 }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// Step indicator — muted secondary text, matching the auth flow's secondary style.
export function StepIndicator({ children }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400 mb-2">
      {children}
    </div>
  )
}

// 6-digit numeric code input: large, centered, letter-spaced; numeric-only;
// auto-submits when the 6th digit is entered.
export function CodeInput({ value, onChange, onComplete, disabled, autoFocus = true }) {
  function handle(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
    onChange(digits)
    if (digits.length === 6) onComplete?.(digits)
  }
  return (
    <input
      type="text" inputMode="numeric" autoComplete="one-time-code"
      maxLength={6} value={value} onChange={handle} disabled={disabled} autoFocus={autoFocus}
      placeholder="••••••"
      className="w-full max-w-[14rem] mx-auto block px-4 py-3 rounded-lg border border-slate-300 text-slate-800 text-2xl text-center font-mono outline-none focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20 transition disabled:bg-slate-50"
      style={{ letterSpacing: '0.3em' }}
    />
  )
}
