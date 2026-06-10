import { useState, useEffect } from 'react'
import { getRuleEvidence, getSuppliers, getSupplierPhysicians } from '../../api'
import { Icon, fmtUSD, fmtDate } from '../../components/ui'
import EvidencePanel, { volumeStats } from './EvidencePanel'

function topSupplier(claims) {
  if (!claims || claims.length === 0) return null
  const counts = {}
  claims.forEach((c) => { if (c.supplier) counts[c.supplier] = (counts[c.supplier] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}
function supplierFromEvidence(claims) {
  const why = (claims || []).find((c) => c.why && /supplier\s+'/i.test(c.why))?.why
  const m = why && /supplier\s+'([^']+)'/i.exec(why)
  return (m && m[1]) || topSupplier(claims)
}

// Concise, plain-English "why" per pattern (≤ ~20 words, no red).
function whyText(rule, ctx) {
  const sup = ctx.supplierName || 'this supplier'
  switch (rule) {
    case 'oig_leie_hit': return `Supplier ${sup} appears on the federal OIG exclusion list. Medicare cannot reimburse.`
    case 'cross_npi_supplier': return `Supplier ${sup} bills under ${ctx.physCount || 'multiple'} distinct physician NPIs — a coordinated fraud signal.`
    case 'geographic_anomaly': return `Patients are located far from the physician's practice in ${ctx.practice?.city || '—'}, ${ctx.practice?.state || '—'}.`
    case 'duplicate_billing': return 'Same service billed twice for this patient within 30 days.'
    case 'volume_spike': return ctx.vol
      ? `Claims spiked ${ctx.vol.ratio}× above normal between ${fmtDate(ctx.vol.start)} and ${fmtDate(ctx.vol.end)}.`
      : 'Claim volume spiked sharply in a concentrated period.'
    case 'unbundling': return 'Single services split across multiple billing codes on the same date.'
    case 'new_high_value_supplier': return `Supplier ${sup} appeared recently and immediately submitted high-value claims — no prior billing history under this NPI.`
    case 'upcoding': return 'Claims here are billed well above the national median for their service category.'
    case 'deceased_patient': return 'Claims filed for patients with no prior activity in over six months — consistent with billing after patient death.'
    case 'impossible_day': return 'This physician billed an implausible number of claims on a single day.'
    case 'modifier_abuse': return 'Near-identical services billed separately for the same patient on the same date — consistent with modifier abuse to bypass duplicate checks.'
    case 'rapid_cycling': return 'This physician billed an unusually high number of distinct patients in a single day.'
    case 'supplier_concentration': return `A single supplier accounts for the large majority of this physician's billing — ${sup}.`
    default: return ctx.explanation || 'This rule fired on the claims below.'
  }
}

const milesOf = (why) => { const m = /([\d,]+)\s*miles/i.exec(why || ''); return m ? parseInt(m[1].replace(/,/g, ''), 10) : -1 }
const sumAmt = (cs) => cs.reduce((s, c) => s + (c.amount || 0), 0)

function groupBySupplier(claims) {
  const map = {}
  claims.forEach((c) => {
    const k = c.supplier || '—'
    if (!map[k]) map[k] = { supplier: k, count: 0, total: 0 }
    map[k].count += 1
    map[k].total += c.amount || 0
  })
  return Object.values(map).sort((a, b) => b.total - a.total)
}
// Same patient + date + supplier with ≥2 claims = one unbundling instance.
function groupUnbundling(claims) {
  const map = {}
  claims.forEach((c) => {
    const k = `${c.patient}|${c.date}|${c.supplier}`
    if (!map[k]) map[k] = { key: k, patient: c.patient, date: c.date, supplier: c.supplier, claims: [] }
    map[k].claims.push(c)
  })
  return Object.values(map).filter((g) => g.claims.length >= 2).sort((a, b) => sumAmt(b.claims) - sumAmt(a.claims))
}
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

// Shared clickable-name styles.
const LINK = 'font-semibold text-[#1E3A5F] hover:underline cursor-pointer'
const SUMMARY = 'text-[13px] text-slate-500 text-center mt-3'
const VIEWALL = 'text-[13px] text-[#1E3A5F] underline'
const RED_CARD = { background: '#FEF2F2', border: '1px solid #FECACA' }

function SupplierLink({ name, onOpenSupplier }) {
  return <button type="button" onClick={() => onOpenSupplier?.(name)} className={LINK}>{name}</button>
}
function StatBox({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800 tabular-nums">{value}</div>
    </div>
  )
}

export default function FraudPatternPanel({ npi, label, rule, focusClaim, practice, onClose, onOpenNpi, onOpenSupplier, onViewClaims, onHighlightClaim }) {
  const [evidence, setEvidence] = useState(null)
  const [physicians, setPhysicians] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setEvidence(null); setPhysicians([]); setError(null)
    getRuleEvidence(npi, rule).then(async (d) => {
      if (cancelled) return
      setEvidence(d)
      if (rule === 'cross_npi_supplier') {
        const name = supplierFromEvidence(d.claims)
        try {
          const list = await getSuppliers()
          const sup = list.find((s) => s.name === name) || list.find((s) => (s.name || '').toLowerCase() === (name || '').toLowerCase())
          if (sup?.id) { const p = await getSupplierPhysicians(sup.id); if (!cancelled) setPhysicians(p.physicians || []) }
        } catch { /* ignore */ }
      }
    }).catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [npi, rule])

  const ready = !!evidence
  const claims = evidence?.claims || []
  const supplierName = ready ? supplierFromEvidence(claims) : null
  const vol = ready && rule === 'volume_spike' ? volumeStats(claims) : null
  const physCount = physicians.length || undefined
  const why = ready ? whyText(rule, { supplierName, physCount, practice, vol, explanation: evidence.explanation }) : ''

  function renderContent() {
    // OIG — excluded suppliers grouped
    if (rule === 'oig_leie_hit') {
      const groups = groupBySupplier(claims)
      return (
        <div className="mt-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">OIG Excluded Suppliers</div>
          {groups.map((g) => (
            <div key={g.supplier} className="rounded-lg px-4 py-3 mb-2" style={RED_CARD}>
              <button type="button" onClick={() => onOpenSupplier?.(g.supplier)} className={`block text-left text-[14px] ${LINK}`}>{g.supplier}</button>
              <div className="text-[13px] text-[#6B7280] mt-0.5">{g.count} claim{g.count !== 1 ? 's' : ''} · {fmtUSD(g.total)} total</div>
            </div>
          ))}
          <div className={SUMMARY}>{claims.length} claims across {groups.length} excluded supplier{groups.length !== 1 ? 's' : ''} · {fmtUSD(sumAmt(claims))} total exposure</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'OIG_HIT', label: 'OIG' })} className={VIEWALL}>View all affected claims →</button></div>
        </div>
      )
    }

    // VOLUME SPIKE — stat boxes + summary + view link (no claim list)
    if (rule === 'volume_spike') {
      return (
        <div className="mt-4">
          {vol && (
            <div className="grid grid-cols-3 gap-2">
              <StatBox label="Normal" value={`${vol.avg}/wk`} />
              <StatBox label="Peak" value={`${vol.peak}/wk`} />
              <StatBox label="Window" value={`${fmtDate(vol.start)}–${fmtDate(vol.end)}`} />
            </div>
          )}
          <div className={SUMMARY}>{claims.length} claims during spike window · {fmtUSD(sumAmt(claims))} total</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ from: vol?.start, to: vol?.end, label: 'Spike window' })} className={VIEWALL}>View spike claims →</button></div>
        </div>
      )
    }

    // UNBUNDLING — grouped cards (max 3)
    if (rule === 'unbundling') {
      const groups = groupUnbundling(claims)
      return (
        <div className="mt-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Unbundled Claim Groups</div>
          {groups.slice(0, 3).map((g) => (
            <div key={g.key} className="rounded-lg px-4 py-3 mb-2" style={RED_CARD}>
              <div className="text-sm font-semibold text-slate-800">{g.patient} — {fmtDate(g.date)}</div>
              <div className="text-[13px] text-slate-500 mt-0.5">Supplier: <SupplierLink name={g.supplier} onOpenSupplier={onOpenSupplier} /></div>
              <div className="mt-2 space-y-1">
                {g.claims.map((c) => (
                  <button key={c.id} type="button" onClick={() => onHighlightClaim?.(c.id)} className="w-full flex items-center justify-between gap-3 text-left group">
                    <span className="text-[13px] text-slate-600 group-hover:text-[#1E3A5F] group-hover:underline truncate">• {c.description || c.category}</span>
                    <span className="text-[13px] font-semibold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</span>
                  </button>
                ))}
              </div>
              <div className="text-[13px] font-semibold text-slate-700 mt-2">Total billed: {fmtUSD(sumAmt(g.claims), 2)}</div>
            </div>
          ))}
          <div className={SUMMARY}>{groups.length} unbundling instance{groups.length !== 1 ? 's' : ''} · {fmtUSD(sumAmt(claims))} total</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'UNBUNDLING', label: 'Unbundling' })} className={VIEWALL}>View all unbundled claims →</button></div>
        </div>
      )
    }

    // GEOGRAPHIC ANOMALY — practice line + max 4 patient rows
    if (rule === 'geographic_anomaly') {
      const sorted = [...claims].sort((a, b) => milesOf(b.why) - milesOf(a.why))
      const furthest = milesOf(sorted[0]?.why)
      return (
        <div className="mt-4">
          <div className="rounded-lg bg-[#F9FAFB] border border-slate-200 px-4 py-2.5 text-sm text-slate-600 mb-3">
            Practice: <span className="font-semibold text-slate-800">{practice?.city || '—'}, {practice?.state || '—'}</span>
          </div>
          <div className="text-[13px] text-slate-500 mb-2">{claims.length} patients located far from practice{furthest >= 0 ? ` · furthest: ${furthest.toLocaleString()} miles` : ''}</div>
          <div className="divide-y divide-[#F3F4F6]">
            {sorted.slice(0, 4).map((c) => (
              <div key={c.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-800 truncate">{c.patient}{milesOf(c.why) >= 0 && <span className="text-amber-600 font-normal"> · {milesOf(c.why).toLocaleString()} miles</span>}</span>
                  <span className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</span>
                </div>
                <div className="text-[13px] text-slate-500 mt-0.5">{fmtDate(c.date)} · <SupplierLink name={c.supplier} onOpenSupplier={onOpenSupplier} /></div>
              </div>
            ))}
          </div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'GEO_ANOMALY', label: 'Geographic anomaly' })} className={VIEWALL}>View all distant patients →</button></div>
        </div>
      )
    }

    // DUPLICATE BILLING — paired cards (max 3)
    if (rule === 'duplicate_billing') {
      const pairs = duplicatePairs(claims)
      return (
        <div className="mt-4">
          {pairs.slice(0, 3).map((p, i) => (
            <div key={i} className="rounded-lg px-4 py-3 mb-2" style={RED_CARD}>
              <div className="text-sm font-semibold text-slate-800">{p.patient}</div>
              <div className="text-[13px] text-slate-500 mt-0.5">Supplier: <SupplierLink name={p.c1.supplier} onOpenSupplier={onOpenSupplier} /></div>
              <button type="button" onClick={() => onHighlightClaim?.(p.c1.id)} className="block w-full text-left mt-2 text-[13px] text-slate-600 hover:text-[#1E3A5F] hover:underline">Claim 1: {fmtDate(p.c1.date)} · {p.c1.description || p.c1.category} · {fmtUSD(p.c1.amount, 2)}</button>
              <button type="button" onClick={() => onHighlightClaim?.(p.c2.id)} className="block w-full text-left mt-0.5 text-[13px] text-slate-600 hover:text-[#1E3A5F] hover:underline">Claim 2: {fmtDate(p.c2.date)} · {p.c2.description || p.c2.category} · {fmtUSD(p.c2.amount, 2)}</button>
              <div className="text-[13px] font-medium text-slate-600 mt-1.5">{p.days} day{p.days !== 1 ? 's' : ''} apart</div>
            </div>
          ))}
          <div className={SUMMARY}>{pairs.length} duplicate pair{pairs.length !== 1 ? 's' : ''} · {fmtUSD(sumAmt(claims))} total</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'DUPLICATE', label: 'Duplicate billing' })} className={VIEWALL}>View all duplicate claims →</button></div>
        </div>
      )
    }

    // UPCODING — top claims above the category median
    if (rule === 'upcoding') {
      const multOf = (w) => { const m = /([\d.]+)x the median/i.exec(w || ''); return m ? parseFloat(m[1]) : null }
      const sorted = [...claims].sort((a, b) => (b.amount || 0) - (a.amount || 0))
      return (
        <div className="mt-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Upcoded claims</div>
          <div className="divide-y divide-[#F3F4F6]">
            {sorted.slice(0, 5).map((c) => (
              <button key={c.id} type="button" onClick={() => onHighlightClaim?.(c.id)} className="block w-full text-left py-2.5 group">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-800 truncate group-hover:underline">{c.patient}</span>
                  <span className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</span>
                </div>
                <div className="text-[13px] text-slate-500 mt-0.5">{c.category}{multOf(c.why) ? <span className="text-amber-600"> · {multOf(c.why)}× above median</span> : null}</div>
              </button>
            ))}
          </div>
          <div className={SUMMARY}>{claims.length} claim{claims.length !== 1 ? 's' : ''} flagged · {fmtUSD(sumAmt(claims))} total</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'UPCODING', label: 'Upcoding' })} className={VIEWALL}>View all upcoded claims →</button></div>
        </div>
      )
    }

    // DECEASED PATIENT — patients reappearing after a long gap
    if (rule === 'deceased_patient') {
      const parse = (w) => { const m = /for (\d+) days \(last seen ([\d-]+)/.exec(w || ''); return m ? { gap: +m[1], last: m[2] } : {} }
      const seen = new Set(); const uniq = []
      for (const c of [...claims].sort((a, b) => (parse(b.why).gap || 0) - (parse(a.why).gap || 0))) {
        if (!seen.has(c.patient)) { seen.add(c.patient); uniq.push(c) }
      }
      const gaps = claims.map((c) => parse(c.why).gap).filter(Boolean)
      const avg = gaps.length ? Math.round(gaps.reduce((s, x) => s + x, 0) / gaps.length) : 0
      return (
        <div className="mt-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Patients reappearing after long gaps</div>
          <div className="divide-y divide-[#F3F4F6]">
            {uniq.slice(0, 5).map((c) => { const x = parse(c.why); return (
              <button key={c.id} type="button" onClick={() => onHighlightClaim?.(c.id)} className="block w-full text-left py-2.5 hover:underline">
                <div className="text-sm font-semibold text-slate-800 truncate">{c.patient}</div>
                <div className="text-[13px] text-slate-500 mt-0.5">Last seen: {x.last ? fmtDate(x.last) : '—'} · This claim: {fmtDate(c.date)} · <span className="text-amber-600">Gap: {x.gap || '—'} days</span></div>
              </button>
            ) })}
          </div>
          <div className={SUMMARY}>{uniq.length} patient{uniq.length !== 1 ? 's' : ''} · avg gap {avg} days</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'DECEASED', label: 'Deceased patient' })} className={VIEWALL}>View all affected claims →</button></div>
        </div>
      )
    }

    // IMPOSSIBLE DAY — days with implausible claim counts
    if (rule === 'impossible_day') {
      const byDay = {}; claims.forEach((c) => { byDay[c.date] = (byDay[c.date] || 0) + 1 })
      const days = Object.entries(byDay).sort((a, b) => b[1] - a[1])
      return (
        <div className="mt-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Impossible days</div>
          <div className="space-y-2">
            {days.slice(0, 5).map(([d, n]) => (
              <div key={d} className="rounded-lg px-4 py-2.5" style={RED_CARD}>
                <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">{fmtDate(d)}</span><span className="text-[13px] font-bold text-slate-800 tabular-nums">{n} claims</span></div>
                <div className="text-[11px] text-slate-500 mt-1 font-mono">{'█'.repeat(Math.min(22, Math.round(n / 3)))} <span className="text-slate-400">vs normal ~12/day</span></div>
              </div>
            ))}
          </div>
          <div className={SUMMARY}>{days.length} impossible day{days.length !== 1 ? 's' : ''} detected</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'IMPOSSIBLE_DAY', label: 'Impossible day' })} className={VIEWALL}>View all flagged claims →</button></div>
        </div>
      )
    }

    // MODIFIER ABUSE — near-identical service pairs
    if (rule === 'modifier_abuse') {
      const groups = {}; claims.forEach((c) => { const k = c.patient + '|' + c.date; (groups[k] = groups[k] || []).push(c) })
      const pairs = []
      Object.values(groups).forEach((g) => { for (let i = 0; i + 1 < g.length; i += 2) pairs.push([g[i], g[i + 1]]) })
      return (
        <div className="mt-4">
          {pairs.slice(0, 4).map(([a, b], i) => (
            <div key={i} className="rounded-lg px-4 py-3 mb-2" style={RED_CARD}>
              <div className="text-sm font-semibold text-slate-800">{a.patient} <span className="font-normal text-slate-500">· {fmtDate(a.date)}</span></div>
              <button type="button" onClick={() => onHighlightClaim?.(a.id)} className="block w-full text-left mt-1.5 text-[13px] text-slate-600 hover:text-[#1E3A5F] hover:underline">{a.description || a.category} · {fmtUSD(a.amount, 2)}</button>
              <button type="button" onClick={() => onHighlightClaim?.(b.id)} className="block w-full text-left mt-0.5 text-[13px] text-slate-600 hover:text-[#1E3A5F] hover:underline">{b.description || b.category} · {fmtUSD(b.amount, 2)}</button>
            </div>
          ))}
          <div className={SUMMARY}>{pairs.length} pair{pairs.length !== 1 ? 's' : ''} flagged</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'MODIFIER_ABUSE', label: 'Modifier abuse' })} className={VIEWALL}>View all flagged claims →</button></div>
        </div>
      )
    }

    // RAPID CYCLING — high distinct-patient days
    if (rule === 'rapid_cycling') {
      const byDay = {}; claims.forEach((c) => { const e = byDay[c.date] = byDay[c.date] || { n: 0, pts: new Set() }; e.n++; e.pts.add(c.patient) })
      const days = Object.entries(byDay).sort((a, b) => b[1].pts.size - a[1].pts.size)
      return (
        <div className="mt-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">High-turnover days</div>
          <div className="divide-y divide-[#F3F4F6]">
            {days.slice(0, 5).map(([d, e]) => (
              <div key={d} className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800">{fmtDate(d)}</span>
                <span className="text-[13px] text-slate-500">{e.pts.size} distinct patients · {e.n} claims</span>
              </div>
            ))}
          </div>
          <div className={SUMMARY}>{days.length} day{days.length !== 1 ? 's' : ''} flagged</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'RAPID_CYCLING', label: 'Rapid cycling' })} className={VIEWALL}>View all flagged claims →</button></div>
        </div>
      )
    }

    // SUPPLIER CONCENTRATION — dominant supplier share + text bar
    if (rule === 'supplier_concentration') {
      const w = claims[0]?.why || ''
      const m = /(\d+)% of NPI.+?'([^']+)' \((\d+) of (\d+)\)/.exec(w)
      const pct = m ? +m[1] : null, sname = m ? m[2] : (claims[0]?.supplier || '—')
      const dom = m ? +m[3] : 0, tot = m ? +m[4] : 0, opct = pct != null ? 100 - pct : null
      const bar = (p) => '█'.repeat(Math.round((p || 0) / 7)) + '░'.repeat(Math.max(0, 14 - Math.round((p || 0) / 7)))
      return (
        <div className="mt-4">
          <div className="rounded-lg px-4 py-3" style={RED_CARD}>
            <div className="flex items-center justify-between gap-3">
              <SupplierLink name={sname} onOpenSupplier={onOpenSupplier} />
              <span className="text-[13px] font-bold text-slate-800">{pct != null ? `${pct}%` : ''}</span>
            </div>
            <div className="text-[13px] text-slate-500 mt-0.5">{dom} of {tot} claims</div>
          </div>
          <div className="mt-3 font-mono text-[12px] space-y-1">
            <div><span className="text-[#1E3A5F]">{bar(pct)}</span> <span className="text-slate-600">{sname.slice(0, 22)} {pct != null ? `${pct}%` : ''}</span></div>
            <div><span className="text-slate-300">{bar(opct)}</span> <span className="text-slate-500">Others {opct != null ? `${opct}%` : ''}</span></div>
          </div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ flag: 'SUPPLIER_CONCENTRATION', label: 'Supplier concentration' })} className={VIEWALL}>View all claims →</button></div>
        </div>
      )
    }

    // NEW HIGH VALUE SUPPLIER — earliest claims from the brand-new supplier
    if (rule === 'new_high_value_supplier') {
      const sorted = [...claims].sort((a, b) => new Date(a.date) - new Date(b.date))   // oldest first
      const first = sorted[0]
      const sname = first?.supplier || claims[0]?.supplier
      return (
        <div className="mt-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Evidence — first claims from this supplier</div>
          <div className="divide-y divide-[#F3F4F6]">
            {sorted.slice(0, 5).map((c) => (
              <div key={c.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-800 truncate">{c.patient}</span>
                  <span className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</span>
                </div>
                <div className="text-[13px] text-slate-500 mt-0.5">{fmtDate(c.date)} · {c.category} · <SupplierLink name={c.supplier} onOpenSupplier={onOpenSupplier} /></div>
              </div>
            ))}
          </div>
          {claims.length > 5 && <div className="text-xs text-slate-400 pt-2">+ {claims.length - 5} more claims</div>}
          <div className={SUMMARY}>{claims.length} claims · {fmtUSD(sumAmt(claims))} · first seen {first ? fmtDate(first.date) : '—'}</div>
          <div className="text-center mt-3"><button type="button" onClick={() => onViewClaims?.({ supplier: sname, label: sname })} className={VIEWALL}>View all claims from this supplier →</button></div>
        </div>
      )
    }

    // CROSS-NPI — physicians billing this supplier (names clickable)
    if (rule === 'cross_npi_supplier') {
      return (
        <div className="mt-4">
          <EvidencePanel variant="crossnpi" evidence={claims} physicians={physicians} cap={8} onOpenNpi={onOpenNpi} />
        </div>
      )
    }

    // Fallback (identity reuse / upcoding / hospice) — plain two-line list
    return (
      <div className="mt-4">
        {focusClaim && (
          <div className="mb-4 rounded-lg px-4 py-3" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-800 truncate">{focusClaim.patient}</div>
              <div className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(focusClaim.amount, 2)}</div>
            </div>
            <div className="text-[13px] text-slate-500 mt-0.5">{fmtDate(focusClaim.date)} · {focusClaim.category} · {focusClaim.supplier}</div>
          </div>
        )}
        <EvidencePanel variant="generic" evidence={claims} practice={practice} cap={focusClaim ? 5 : 8} />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[560px] max-h-[80vh] overflow-y-auto p-6"
           style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }} onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center flex-shrink-0"><Icon name="alertTri" size={18} /></div>
            <div className="min-w-0">
              <h3 className="text-[18px] font-bold text-slate-900 leading-tight">{label}</h3>
              <p className="text-xs text-slate-400 mt-0.5">Why this fired · NPI {npi}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex-shrink-0 text-slate-400 hover:text-slate-700"><Icon name="x" size={18} /></button>
        </div>

        {error && <div className="mt-4 text-sm text-rose-600">{error}</div>}
        {!ready && !error && <div className="mt-5 h-32 rounded-xl bg-slate-100 animate-pulse" />}

        {ready && (
          <div key={rule} className="animate-fade-in-up mt-4">
            <div className="rounded-lg bg-[#F9FAFB] px-4 py-3.5 text-sm text-slate-700 leading-relaxed">{why}</div>
            {renderContent()}
          </div>
        )}
      </div>
    </div>
  )
}
