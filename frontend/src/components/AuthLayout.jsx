import bgImage from '../screens/bg-image.png'
import illustration from '../screens/illustration-family-life.png'

function ShieldLogo({ size = 18, color = 'white' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>

      {/* Blurred overlay */}
      <div className="absolute inset-0 bg-white/25 backdrop-blur-sm" />

      {/* Centered card */}
      <div className="relative z-10 w-full max-w-[1160px] flex rounded-2xl shadow-2xl overflow-hidden"
           style={{ minHeight: '620px' }}>

        {/* LEFT — dark blue panel */}
        <div className="hidden lg:flex w-[48%] flex-shrink-0 flex-col items-center justify-center"
             style={{ backgroundColor: '#1a3d7c', minHeight: '620px' }}>
          <img src={illustration} alt="Healthcare protection"
               className="w-[85%] object-contain"
               style={{ maxHeight: '78%' }} />
        </div>

        {/* RIGHT — content */}
        <div className="flex-1 bg-white flex flex-col justify-center px-10 py-10">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#1a3d7c' }}>
              <ShieldLogo size={16} />
            </div>
            <span className="text-[15px] font-bold text-slate-800 tracking-tight">MedClaim Analytics</span>
          </div>

          <div className="w-full max-w-md mx-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Spinner({ size = 18 }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function StepIndicator({ children }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400 mb-2">
      {children}
    </div>
  )
}

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
      placeholder="——————"
      className="w-full max-w-[16rem] mx-auto block px-5 py-4 rounded-xl border-2 border-slate-200 text-slate-800 text-3xl text-center font-mono outline-none focus:border-[#1a3d7c] focus:ring-4 focus:ring-[#1a3d7c]/10 transition-all disabled:bg-slate-50"
      style={{ letterSpacing: '0.45em' }}
    />
  )
}
