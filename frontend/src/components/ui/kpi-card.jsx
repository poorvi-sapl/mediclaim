// KPI card for the payer portal — label, metric, optional delta/trend, optional
// icon, and a baseline meter.
//
// JSX rather than TSX because this codebase has no TypeScript at all (0 .ts/.tsx
// files, no tsconfig). A lone .tsx would compile under Vite's esbuild but nothing
// would ever type-check it, so the annotations would be decorative. See the
// integration notes for the commands to adopt TS properly.
//
// Three deliberate departures from the reference design, each for a reason:
//
//  1. The metric value wears an INK token, not the tone colour. A stat tile's
//     value is text and belongs in text ink; the tone is carried by the icon,
//     the corner wash and the meter. Painting the number itself in a reserved
//     status colour costs legibility and spends the colour on decoration.
//  2. Tones map onto this product's tokens and its four risk bands, not a generic
//     zinc/blue/emerald/amber/rose ramp. success/warning/danger would otherwise
//     collide with the low/high/critical band colours, which carry meaning.
//  3. No dark: variants — tailwind.config.js sets no darkMode, so they'd be inert.
//
// Delta direction is NOT assumed to be good news. On a fraud dashboard "OIG
// flagged +12%" is bad, so `upIsGood` decides which way is green. Default false,
// because most metrics here are counts of problems.

import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { bandByName } from '@/lib/risk'

// tone -> { accent, ink, wash }. Risk-flavoured tones borrow the band colours from
// lib/risk.js so a "danger" tile and a critical pill are the same red.
//
// Two steps per tone, because the palette validator showed they're complementary
// and neither works alone:
//   accent — the band's bright step. Passes CVD separation (worst adjacent pair
//            ΔE 18.1 protan) so tones stay distinguishable side by side, but the
//            gold is only 2.16:1 on white. Used for large areas: the meter fill
//            (which sits on its own tinted track, not on white) and corner wash.
//   ink    — the band's dark step. Passes contrast ≥3:1 but the greens and golds
//            collapse to ΔE 5.2 for protanopes, so it is never load-bearing for
//            identity. Used for thin marks that must be legible: the icon glyph
//            and the delta text.
const critical = bandByName('critical')
const high = bandByName('high')
const low = bandByName('low')

const TONE = {
  default: { accent: 'var(--color-primary-tint)', ink: 'var(--color-accent)', wash: 'var(--color-bg-soft)' },
  primary: { accent: 'var(--color-primary-tint)', ink: 'var(--color-primary)', wash: 'var(--color-bg-soft)' },
  success: { accent: low.color, ink: low.text, wash: low.soft },
  warning: { accent: high.color, ink: high.text, wash: high.soft },
  danger: { accent: critical.color, ink: critical.text, wash: critical.soft },
  // `ai` kept for call-site compatibility. Its own accent navy failed the
  // lightness and chroma checks (L 0.41, C 0.093 — reads near-gray next to the
  // other tones), so it renders as `default` rather than as a sixth hue.
  ai: { accent: 'var(--color-primary-tint)', ink: 'var(--color-accent)', wash: 'var(--color-bg-soft)' },
}

const SIZE = {
  sm: { pad: '14px 16px 16px', label: 11.5, value: 22, caption: 11, icon: 28 },
  md: { pad: '20px 22px 22px', label: 12.5, value: 28, caption: 12, icon: 32 },
  lg: { pad: '24px 26px 26px', label: 13, value: 34, caption: 13, icon: 38 },
}

/**
 * @param {object}  props
 * @param {string}  props.label      Sentence-case label, no trailing colon.
 * @param {string|number} props.value  Pre-formatted metric, or a number to localise.
 * @param {number|string} [props.delta]  Signed change. A number renders as "+12%".
 * @param {'up'|'down'|'flat'} [props.trend]  Direction indicator.
 * @param {boolean} [props.upIsGood]  Whether a rise is good news. Default false —
 *   most payer metrics count problems, so up is bad.
 * @param {string}  [props.caption]   Sub text under the value. `sub` is an alias.
 * @param {React.ReactNode} [props.icon]  Stroked icon, recoloured to the tone.
 * @param {'default'|'primary'|'success'|'warning'|'danger'|'ai'} [props.tone]
 * @param {'sm'|'md'|'lg'} [props.size]
 * @param {number}  [props.pct]      0-100 meter fill. Omit for a full decorative bar.
 * @param {boolean} [props.compact]  Drops the min-height.
 * @param {() => void} [props.onClick]  Renders as a button when provided.
 */
export function KpiCard({
  label,
  value,
  delta,
  trend = 'flat',
  upIsGood = false,
  caption,
  sub,
  icon,
  tone = 'default',
  size = 'md',
  pct = 100,
  compact = false,
  onClick,
  className = '',
}) {
  const t = TONE[tone] || TONE.default
  const s = SIZE[size] || SIZE.md
  const Wrapper = onClick ? 'button' : 'div'
  const subtext = caption ?? sub

  const deltaText =
    typeof delta === 'number' ? `${delta > 0 ? '+' : ''}${delta}%` : delta
  const isUp = trend === 'up'
  const isDown = trend === 'down'
  const DeltaIcon = isUp ? TrendingUp : isDown ? TrendingDown : Minus
  // Direction x whether up is good, so a rising problem count reads as a problem.
  const deltaGood = isUp ? upIsGood : isDown ? !upIsGood : null
  // Dark steps: delta is 12px text and needs the contrast, and it carries a
  // direction icon + sign so hue is never the only cue.
  const deltaColor =
    deltaGood === null
      ? 'var(--color-text-muted)'
      : deltaGood
        ? low.text
        : critical.text

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        // flex column + an mt-auto meter below: in a grid row the cards stretch to
        // equal height, so pushing the meter to the bottom lines every meter up
        // regardless of whether a card has a caption line. Without it the cards
        // with a caption pushed their meter ~15px lower than the ones without.
        'relative overflow-hidden bg-white text-left w-full flex flex-col transition-shadow duration-150',
        onClick && 'cursor-pointer hover:shadow-md',
        !compact && 'min-h-[92px]',
        className
      )}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 18,
        padding: s.pad,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7), 0 1px 2px rgba(10,31,61,.05)',
      }}
    >
      {/* Corner pulse — the reference design's two concentric circles, clipped by the
          card's rounded corner and overflow-hidden. */}
      <span aria-hidden className="pointer-events-none absolute rounded-full"
            style={{ top: -26, right: -26, width: 68, height: 68, background: t.accent, opacity: 0.1 }} />
      <span aria-hidden className="pointer-events-none absolute rounded-full"
            style={{ top: -8, right: -8, width: 34, height: 34, background: t.accent, opacity: 0.1 }} />

      {/* The icon leads the label on the LEFT. It used to sit top-right, where it
          landed on top of the corner wash and the two circles merged into a blob. */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && (
            <span className="rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ width: s.icon, height: s.icon, background: t.wash, color: t.ink }}>
              {icon}
            </span>
          )}
          <div className="font-semibold truncate" style={{ fontSize: s.label, color: 'var(--color-text-body)' }}>
            {label}
          </div>
        </div>
        {typeof deltaText !== 'undefined' && deltaText !== null && (
          <span className="flex items-center gap-1 font-semibold flex-shrink-0"
                style={{ fontSize: 12, color: deltaColor }}>
            <DeltaIcon size={13} aria-hidden />
            {deltaText}
          </span>
        )}
      </div>

      {/* Proportional figures on purpose — tabular-nums gives every digit the width
          of a 0, which reads loose at display sizes. Tabular is for table columns. */}
      <div style={{
        fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: s.value,
        color: 'var(--color-text-dark)', letterSpacing: '-.02em', marginTop: 12, lineHeight: 1.1,
      }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>

      {subtext && (
        <div style={{ fontSize: s.caption, color: 'var(--color-text-body)', marginTop: 3 }}>
          {subtext}
        </div>
      )}

      {/* Meter: fill carries the tone, the unfilled track is a lighter step of the
          same colour so the state reads across the whole bar.
          The wrapper is what aligns a row of cards: mt-auto pins it to the card's
          bottom edge (so every meter lines up even when only some cards have a
          caption) while pt-3.5 keeps a minimum gap when the card is at min-height.
          The gap lives on the wrapper, not as marginTop on the bar — an inline
          margin would beat mt-auto and the alignment would silently not happen. */}
      <div className="mt-auto pt-3.5">
        <div className="overflow-hidden" style={{ height: 4, borderRadius: 4, background: t.wash }}>
          <div style={{
            height: '100%', borderRadius: 4, background: t.accent,
            width: `${Math.max(0, Math.min(100, pct))}%`,
          }} />
        </div>
      </div>
    </Wrapper>
  )
}
