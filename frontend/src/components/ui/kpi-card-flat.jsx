// Flat KPI card recipe: label + a tinted icon circle up top, big value/sub
// below, a solid-color progress bar along the bottom. `glow` doubles as the
// icon circle's tint and `iconColor` as both the icon and progress-bar fill.
//
// Renders with literal hex values / inline styles rather than the
// .kpi/.kpi-badge/.kpi-track classes + var(--n-*) custom properties the
// vendor moodboard originally used — those are scoped under .vendor-theme,
// and this component is shared by the physician portal too (which isn't
// wrapped in that scope), so class-based styling silently no-opped there.
const TONE = {
  default: { glow: '#F1F4F9', iconColor: '#5B84C4' },
  primary: { glow: '#E9F0F6', iconColor: '#5A9BC9' },
  success: { glow: '#E9F3ED', iconColor: '#3A7D5C' },
  warning: { glow: '#FBF3E4', iconColor: '#D1A85C' },
  danger:  { glow: '#F7EBEA', iconColor: '#A6453F' },
  ai:      { glow: '#EAF1F5', iconColor: '#2E6B8F' },
}

/** KPI card — pass `pct` (0-100) to drive the progress track; omit it and the
 * track just renders full, purely decorative. `icon` is a stroked SVG (e.g.
 * a lucide-react icon with no fill) — it's recolored via the tone's iconColor.
 * Recipe: label + a tinted icon circle in the header row (sitting on a soft
 * corner glow, clipped by the card's own rounded corner into a defined
 * quarter-circle wash — light blur so the shape stays legible, not a diffuse
 * blob), big value/sub below, a solid-color progress bar along the bottom. */
export function KpiCard({ label, value, sub, icon, tone = 'default', pct = 100, onClick, className = '' }) {
  const t = TONE[tone] || TONE.default
  const Wrapper = onClick ? 'button' : 'div'

  return (
    <Wrapper onClick={onClick}
             className={`relative overflow-hidden bg-white text-left w-full transition-shadow duration-150 ${onClick ? 'cursor-pointer hover:shadow-md' : ''} ${className}`}
             style={{ border: '1px solid #E1E6EE', borderRadius: 18, padding: '20px 22px 22px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7), 0 1px 2px rgba(10,31,61,.05), 0 1px 1px rgba(10,31,61,.03)' }}>
      {icon && (
        <>
          <div className="absolute rounded-full pointer-events-none"
               style={{ top: -32, right: -32, width: 115, height: 115, opacity: 0.5, filter: 'blur(5px)',
                        background: `radial-gradient(circle, ${t.iconColor} 0%, ${t.iconColor} 40%, transparent 75%)` }} />
          {/* Crisp boundary hugging the wash's actual visible edge (not the
              blurred glow's full box) — clipped by the card's own rounded
              corner + overflow-hidden into the same quarter-circle arc, so it
              reads as the line separating the tint from the white card. */}
          <div className="absolute rounded-full pointer-events-none"
               style={{ top: -29.5, right: -29.5, width: 110, height: 110,
                        border: `1.5px solid ${t.iconColor}`, opacity: 0.45 }} />
        </>
      )}
      <div className="relative flex items-start justify-between gap-3">
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#647089' }}>{label}</div>
        {icon && (
          <div className="relative rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, background: t.glow }}>
            <span style={{ color: t.iconColor, display: 'flex' }}>{icon}</span>
          </div>
        )}
      </div>
      <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 28, color: '#0A1F3D', letterSpacing: '-.02em', marginTop: 12 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#647089', marginTop: 3 }}>{sub}</div>}
      <div className="overflow-hidden" style={{ height: 4, borderRadius: 4, background: '#F1F4F9', marginTop: 14 }}>
        <div style={{ height: '100%', borderRadius: 4, width: `${Math.max(0, Math.min(100, pct))}%`, background: t.iconColor }} />
      </div>
    </Wrapper>
  )
}
