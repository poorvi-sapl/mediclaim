import { fmtUSD, fmtDate } from '../../components/ui'

// Pairs of same-patient claims within 30 days (client-side).
function duplicatePairs(claims) {
  const byPatient = {}
  claims.forEach((c) => { (byPatient[c.patient] = byPatient[c.patient] || []).push(c) })
  const pairs = []
  Object.entries(byPatient).forEach(([patient, list]) => {
    const ordered = [...list].sort((a, b) => new Date(a.date) - new Date(b.date))
    for (let i = 0; i < ordered.length - 1; i++) {
      const days = Math.round((new Date(ordered[i + 1].date) - new Date(ordered[i].date)) / 86400000)
      if (days >= 0 && days <= 30) pairs.push({ patient, c1: ordered[i], c2: ordered[i + 1], days })
    }
  })
  return pairs
}

export function volumeStats(claims) {
  const withDates = (claims || []).filter((c) => !Number.isNaN(new Date(c.date).getTime()))
  if (withDates.length === 0) return null
  const ordered = [...withDates].sort((a, b) => new Date(a.date) - new Date(b.date))
  const ts = ordered.map((c) => new Date(c.date).getTime())
  const spanWeeks = Math.max(1, (ts[ts.length - 1] - ts[0]) / (7 * 86400000))
  const avg = Math.max(1, Math.round(withDates.length / spanWeeks))
  let peak = 0
  for (let i = 0; i < ts.length; i++) {
    const end = ts[i] + 7 * 86400000
    let cnt = 0
    for (let j = i; j < ts.length && ts[j] <= end; j++) cnt++
    if (cnt > peak) peak = cnt
  }
  return { start: ordered[0].date, end: ordered[ordered.length - 1].date, peak, avg, ratio: Math.max(2, Math.round(peak / avg)) }
}

const milesOf = (why) => { const m = /([\d,]+)\s*miles/i.exec(why || ''); return m ? parseInt(m[1].replace(/,/g, ''), 10) : -1 }

function TwoLine({ c }) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-800 truncate">{c.patient}</div>
        <div className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</div>
      </div>
      <div className="text-[13px] text-slate-500 mt-0.5">{fmtDate(c.date)} · {c.category} · {c.supplier}</div>
    </div>
  )
}

// Compact evidence list for the fraud-pattern modal. Capped with a "+N more" footer
// (no expand button), no red text anywhere.
export default function EvidencePanel({ variant, evidence = [], practice, physicians = [], cap = 8, onOpenNpi }) {
  const isCross = variant === 'crossnpi'
  const total = isCross ? physicians.length : evidence.length
  const vol = variant === 'volume' ? volumeStats(evidence) : null
  const pairs = variant === 'duplicate' ? duplicatePairs(evidence) : null
  const usePairs = pairs && pairs.length > 0

  let rows = evidence
  if (variant === 'geo') rows = [...evidence].sort((a, b) => (milesOf(b.why) - milesOf(a.why)) || (b.amount || 0) - (a.amount || 0))

  const noun = isCross ? 'physician' : 'claim'
  const label = isCross
    ? `${total} physician${total !== 1 ? 's' : ''} billing this supplier`
    : `${total} claim${total !== 1 ? 's' : ''} triggered this`

  return (
    <div>
      {variant === 'geo' && practice && (
        <div className="rounded-lg bg-[#F9FAFB] border border-slate-200 px-4 py-2.5 text-sm text-slate-600 mb-4">
          Practice: <span className="font-semibold text-slate-800">{practice.city || '—'}, {practice.state || '—'}</span>
        </div>
      )}
      {vol && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Normal</div><div className="text-sm font-semibold text-slate-800 tabular-nums">{vol.avg}/wk</div></div>
          <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Peak</div><div className="text-sm font-semibold text-slate-800 tabular-nums">{vol.peak}/wk</div></div>
          <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Window</div><div className="text-[11px] font-semibold text-slate-800">{fmtDate(vol.start)}–{fmtDate(vol.end)}</div></div>
        </div>
      )}

      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Evidence — {label}</div>

      {total === 0 ? (
        <div className="text-sm text-slate-400 py-2">No specific records.</div>
      ) : isCross ? (
        <div className="divide-y divide-[#F3F4F6]">
          {physicians.slice(0, cap).map((p) => (
            <button key={p.npi} type="button" onClick={() => onOpenNpi?.(p)}
                    className="group w-full text-left -mx-2 px-2 py-2.5 rounded flex items-center justify-between gap-3 cursor-pointer hover:bg-[#F9FAFB] transition-colors">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate group-hover:underline">{p.name}</div>
                <div className="text-[11px] text-slate-400 tabular-nums">NPI {p.npi}</div>
              </div>
              <div className="text-[13px] text-slate-500 tabular-nums flex-shrink-0">{p.claimCount} claims</div>
            </button>
          ))}
        </div>
      ) : usePairs ? (
        <div className="space-y-3">
          {pairs.slice(0, cap).map((p, i) => (
            <div key={i} className="rounded-lg border border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-800">{p.patient}</div>
              <div className="text-[13px] text-slate-500 mt-1.5">Claim 1: {fmtDate(p.c1.date)} · {fmtUSD(p.c1.amount, 2)}</div>
              <div className="text-[13px] text-slate-500 mt-0.5">Claim 2: {fmtDate(p.c2.date)} · {fmtUSD(p.c2.amount, 2)}</div>
              <div className="text-[13px] font-medium text-slate-600 mt-1.5">{p.days} day{p.days !== 1 ? 's' : ''} apart</div>
            </div>
          ))}
        </div>
      ) : variant === 'geo' ? (
        <div className="divide-y divide-[#F3F4F6]">
          {rows.slice(0, cap).map((c) => (
            <div key={c.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-800 truncate">{c.patient}</div>
                <div className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</div>
              </div>
              <div className="text-[13px] text-slate-500 mt-0.5">{fmtDate(c.date)} · {c.category} · {c.supplier}</div>
              {milesOf(c.why) >= 0 && <div className="text-[13px] text-amber-600 mt-0.5">{milesOf(c.why).toLocaleString()} miles from practice</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-[#F3F4F6]">
          {rows.slice(0, cap).map((c) => <TwoLine key={c.id} c={c} />)}
        </div>
      )}

      {total > cap && <div className="text-xs text-slate-400 text-center pt-3">+ {total - cap} more {noun}s</div>}
    </div>
  )
}
