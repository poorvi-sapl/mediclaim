import { useState, useEffect } from 'react'
import { getRules } from '../../api'
import { Icon } from '../../components/ui'

const SEV = {
  critical: { label: 'Critical', text: '#B91C3C', bg: '#FDECEF', border: '#F3C0CB' },
  high:     { label: 'High',     text: '#B45309', bg: '#FFF5E1', border: '#F5D99A' },
  medium:   { label: 'Medium',   text: '#047857', bg: '#E6F4EE', border: '#B9DFCC' },
}
// Card accent per severity — white cards with a border in the severity color.
const CARD_TINT = {
  critical: '205,92,92',   // indianred
  high:     '209,168,92',  // amber
  medium:   '58,125,92',   // green
}
const CATEGORY_ORDER = [
  'Provider-identity & network fraud',
  'Volume & behavioral anomalies',
  'Coding & billing manipulation',
  'Clinical & eligibility integrity',
]
const fmtN = (n) => (n ?? 0).toLocaleString()

function Stat({ n, label, crit }) {
  return (
    <div className="bg-white rounded-2xl px-5 py-4 border border-slate-100 shadow-sm">
      <div className={`text-[24px] sm:text-[26px] font-mono font-semibold ${crit ? 'text-[#B91C3C]' : 'text-[#0A1F3D]'}`}>{n ?? '—'}</div>
      <div className="text-[12px] text-slate-400 mt-0.5 font-medium">{label}</div>
    </div>
  )
}
function Metric({ n, l }) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl py-3 text-center">
      <div className="font-mono font-bold text-[16px] text-[#0A1F3D] tabular-nums">{n}</div>
      <div className="text-[10.5px] text-slate-400 mt-0.5">{l}</div>
    </div>
  )
}

// Centered popup with the rule's full detail.
function RuleModal({ r, onClose }) {
  const s = SEV[r.severity] || SEV.medium
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
         style={{ background: 'rgba(6,20,38,.5)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      <div className="bg-white w-full sm:rounded-2xl rounded-t-2xl sm:max-w-[600px] max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden"
           style={{ boxShadow: '0 24px 64px -12px rgba(6,20,38,.4)' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-5 text-white relative shrink-0" style={{ background: 'linear-gradient(135deg,#0d3d6e,#0A1F3D)' }}>
          <button onClick={onClose} aria-label="Close"
                  className="absolute top-5 right-5 w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors">
            <Icon name="x" size={15} stroke={2.5} />
          </button>
          <h3 className="text-[20px] font-bold leading-tight pr-10 text-white">{r.name}</h3>
          <span className="inline-block mt-2 text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
                style={{ color: s.text, background: s.bg, border: `1px solid ${s.border}` }}>{s.label}</span>
        </div>
        <div className="px-6 py-5 overflow-y-auto">
          <div className="mb-5">
            <h4 className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">What it detects</h4>
            <p className="text-[13.5px] text-slate-600 leading-relaxed">{r.description}</p>
          </div>
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            <Metric n={fmtN(r.flagCount)} l="Flags" />
            <Metric n={fmtN(r.distinctNpis)} l="Physicians" />
            <Metric n={fmtN(r.distinctVendors)} l="Vendors" />
          </div>
          <div>
            <h4 className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Sample triggering record</h4>
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 font-mono text-[12px] text-slate-700 leading-relaxed break-words">
              {r.sampleEvidence || 'No sample available.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RulesCatalog() {
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [active, setActive] = useState(null)

  useEffect(() => {
    let cancelled = false
    getRules().then((d) => { if (!cancelled) setData(d) }).catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setActive(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const rules = data?.rules || []
  const filtered = rules.filter((r) => filter === 'all' || r.severity === filter)
  const cats = CATEGORY_ORDER.filter((c) => filtered.some((r) => r.category === c))

  return (
    <div className="w-full">
      {/* Hero */}
      <div className="relative px-4 sm:px-7 pt-6 pb-16 text-white overflow-hidden"
           style={{ background: 'linear-gradient(135deg,#0d3d6e 0%,#0A1F3D 60%,#061a30 100%)' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-mono tracking-[0.14em] uppercase text-[#9fc3e6]">Detection engine · Rule catalog</div>
            <h1 className="text-[22px] sm:text-[28px] font-extrabold mt-2 leading-tight text-white">Fraud patterns we're watching</h1>
            <p className="text-[13px] text-[#b9cfe4] mt-2 max-w-[560px] leading-relaxed">
              16 deterministic rules across identity, volume, coding, and clinical eligibility — every flag ties back to the exact claims that triggered it.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-2 text-[12.5px] text-[#dce8f5] shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" /> Scanning live claims feed
          </div>
        </div>
      </div>

      {/* Stats (overlapping the hero) */}
      <div className="px-4 sm:px-7 -mt-10 relative z-10">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Stat n={data?.criticalRules} label="Critical rules" crit />
          <Stat n={data?.totalRules} label="Total active rules" />
          <Stat n={fmtN(data?.totalFlags)} label="Flags detected" />
          <Stat n={data?.categories} label="Coverage areas" />
        </div>
      </div>

      {/* Body */}
      <div className="px-4 sm:px-7 py-6">
        {error && <div className="text-[#A6453F] text-sm mb-4">{error}</div>}

        <div className="flex gap-2 flex-wrap mb-6">
          {['all', 'critical', 'high', 'medium'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
                    className={`text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full border transition-colors ${filter === f ? 'bg-[#0A1F3D] text-white border-[#0A1F3D]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {f === 'all' ? 'All rules' : SEV[f].label}
            </button>
          ))}
        </div>

        {!data && !error && <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />}

        {cats.map((cat) => {
          const items = filtered.filter((r) => r.category === cat)
          return (
            <div key={cat} className="mb-8">
              <div className="flex items-baseline gap-2.5 mb-3">
                <h2 className="text-[15px] font-bold text-[#0A1F3D]">{cat}</h2>
                <span className="text-[12px] font-mono text-slate-400">{items.length} fraud pattern{items.length !== 1 ? 's' : ''}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {items.map((r) => {
                  const s = SEV[r.severity] || SEV.medium
                  const tint = CARD_TINT[r.severity] || CARD_TINT.medium
                  return (
                    <button key={r.rule} onClick={() => setActive(r)}
                            className="text-left bg-white border-[1.5px] rounded-2xl p-4 flex flex-col gap-2.5 transition-all duration-200 hover:-translate-y-1.5 hover:shadow-xl hover:[background-image:var(--card-grad)]"
                            style={{ borderColor: `rgb(${tint})`,
                                     '--card-grad': `linear-gradient(135deg, rgba(${tint},0.04) 0%, rgba(${tint},0.10) 55%, rgba(${tint},0.20) 100%)` }}>
                      <div className="flex items-center justify-end">
                        <span className="text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
                              style={{ color: s.text, background: s.bg, border: `1px solid ${s.border}` }}>{s.label}</span>
                      </div>
                      <div className="text-center text-[17px] font-bold text-slate-900 leading-tight -mt-1">{r.name}</div>
                      <p className="text-center text-[12.5px] text-slate-600 leading-relaxed flex-1 mt-1.5">{r.description}</p>
                      <div className="flex items-center justify-between text-[11.5px] text-slate-400 border-t pt-2.5"
                           style={{ borderColor: `rgba(${tint},0.25)` }}>
                        <span className="tabular-nums">{fmtN(r.flagCount)} flagged</span>
                        <span className="font-semibold text-[#0A1F3D]">View →</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {active && <RuleModal r={active} onClose={() => setActive(null)} />}
    </div>
  )
}
