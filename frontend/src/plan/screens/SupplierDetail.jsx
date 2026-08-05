import { useState, useEffect, useRef } from 'react'
import { getSupplierPhysicians, getAlertsHistory, getSupplierSummary, runSupplierFraudCheck } from '../../api'
import { Icon, RiskPill, fmtUSD, timeAgo } from '../../components/ui'
import { KpiCard } from '../../components/ui/kpi-card'
import VendorEvidencePanel from '../components/VendorEvidencePanel'

const ALERT_META = {
  flagged:         { icon: 'flag',     chip: 'bg-[#FBF3E4] text-[#D1A85C]',  label: 'Flag Vendor'      },
  unknownPatient:  { icon: 'userx',    chip: 'bg-[#F7EBEA] text-[#A6453F]',  label: 'Unknown Patient'  },
  deceasedPatient: { icon: 'heartOff', chip: 'bg-[#F2EEF7] text-[#7A6899]',  label: 'Deceased Patient' },
  deniedOrder:     { icon: 'ban',      chip: 'bg-[#F7EBEA] text-[#8A423D]',  label: 'Did Not Order'    },
}

const PHYS_COLUMNS = [
  { key: 'name',   label: 'Physician'  },
  { key: 'claims', label: 'Claims', right: true },
  { key: 'billed', label: 'Billed',  right: true, cls: 'hidden sm:table-cell' },
  { key: 'flags',  label: 'Fraud Pattern Hits',   right: true },
]
const PHYS_COMPARATORS = {
  name:   (a, b) => (a.name || '').localeCompare(b.name || ''),
  claims: (a, b) => (a.claimCount || 0) - (b.claimCount || 0),
  billed: (a, b) => (a.totalAmount || 0) - (b.totalAmount || 0),
  flags:  (a, b) => (a.flagsOnThisSupplier || 0) - (b.flagsOnThisSupplier || 0),
}

// Same severity tiers + icons the NPI investigation page uses for its fraud-pattern
// cards, so the vendor page reads identically.
function getSeverity(points) {
  if (points >= 35) return { label: 'CRITICAL', badgeBg: '#A6453F', badgeTx: '#fff' }
  if (points >= 25) return { label: 'HIGH',     badgeBg: '#FCE4E1', badgeTx: '#8A423D' }
  if (points >= 15) return { label: 'MEDIUM',   badgeBg: '#FBF3E4', badgeTx: '#8A6A34' }
  return               { label: 'LOW',      badgeBg: '#E9F3ED', badgeTx: '#2E6B4F' }
}
const RULE_ICON = {
  volume_spike: 'bolt', cross_npi_supplier: 'suppliers', geographic_anomaly: 'search',
  oig_leie_hit: 'shieldAlert', new_high_value_supplier: 'suppliers', identity_reuse: 'userx',
  abnormal_hospice_duration: 'clock', unbundling: 'doc', rapid_cycling: 'refresh',
  supplier_concentration: 'suppliers', duplicate_billing: 'doc', impossible_day: 'clock',
  ghost_billing: 'userx', upcoding: 'bolt', modifier_abuse: 'doc',
}
// Score-ring palette per risk band (matches RiskPill / the NPI investigation ring).
const RING = {
  Critical: { text: '#A6453F', ring: '#A6453F', bg: '#F7EBEA' },
  High:     { text: '#A6453F', ring: '#EBB6B1', bg: '#FCE4E1' },
  Medium:   { text: '#8A6A34', ring: '#F0E0BE', bg: '#FBF3E4' },
  Low:      { text: '#2E6B4F', ring: '#CDE7D8', bg: '#E9F3ED' },
}

export default function SupplierDetail({ supplier, onBack, onSelectPhysician }) {
  const [data, setData]       = useState(null)
  const [flags, setFlags]     = useState([])
  const [error, setError]     = useState(null)
  const [physSort, setPhysSort] = useState({ key: null, dir: null })
  // AI strip state — mirrors the NPI investigation page.
  const [patternsOpen, setPatternsOpen] = useState(false)
  const [summary, setSummary]           = useState(null)
  const [sumSource, setSumSource]       = useState(null)
  const [sumLoading, setSumLoading]     = useState(false)
  const [fraudCheckResult, setFraudCheckResult]   = useState(null)
  const [fraudCheckLoading, setFraudCheckLoading] = useState(false)
  const [activePattern, setActivePattern]         = useState(null)  // fraud-pattern card clicked → evidence modal
  const physiciansRef = useRef(null)
  const flagsRef      = useRef(null)
  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  useEffect(() => {
    if (!supplier?.id) return
    let cancelled = false
    setPhysSort({ key: null, dir: null })
    setPatternsOpen(false)
    setSummary(null); setSumSource(null); setFraudCheckResult(null); setActivePattern(null)
    Promise.all([getSupplierPhysicians(supplier.id), getAlertsHistory(50, 0, supplier.id)])
      .then(([d, a]) => { if (!cancelled) { setData(d); setFlags(a.items) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [supplier])

  async function genSummary() {
    if (!supplier?.id) return
    setSumLoading(true)
    try {
      const d = await getSupplierSummary(supplier.id)
      setSummary(d.summary); setSumSource(d.source)
    } catch (e) {
      setSummary(`Summary unavailable: ${e.message}`); setSumSource('error')
    } finally {
      setSumLoading(false)
    }
  }

  async function runFraudCheck() {
    if (!supplier?.id) return
    setFraudCheckLoading(true)
    setFraudCheckResult(null)
    try {
      setFraudCheckResult(await runSupplierFraudCheck(supplier.id))
    } catch (e) {
      setFraudCheckResult({ error: e.message })
    } finally {
      setFraudCheckLoading(false)
    }
  }

  function onPhysSort(key) {
    setPhysSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }

  if (!supplier) return <div className="w-full px-4 sm:px-7 py-5 sm:py-7 text-slate-500">No vendor selected.</div>

  const physicians = data?.physicians || []
  const fraudPatterns = data?.fraudPatterns || []
  const sortedPhysicians = (() => {
    const arr = [...physicians]
    if (physSort.key && PHYS_COMPARATORS[physSort.key]) {
      arr.sort(PHYS_COMPARATORS[physSort.key])
      if (physSort.dir === 'desc') arr.reverse()
    } else {
      arr.sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0))
    }
    return arr
  })()

  return (
    <div className="w-full px-4 sm:px-7 py-4 sm:py-7">

      {/* ── Header ── */}
      <div className="mc-card px-4 sm:px-6 py-3 sm:py-4 mb-4 sm:mb-6 flex items-start sm:items-center gap-3 sm:gap-4">
        {(() => {
          const rc = RING[supplier.risk] || RING.Low
          return (
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex flex-col items-center justify-center shrink-0 mt-0.5 sm:mt-0"
                 style={{ background: rc.bg, boxShadow: `inset 0 0 0 2px ${rc.ring}`, color: rc.text }}
                 title={`Vendor risk score ${supplier.riskScore ?? 0} / 100`}>
              <span className="text-[16px] sm:text-[18px] font-extrabold leading-none tabular-nums">{supplier.riskScore ?? 0}</span>
              <span className="text-[7px] sm:text-[8px] font-bold uppercase tracking-wider mt-0.5">Risk</span>
            </div>
          )
        })()}
        <div className="min-w-0 flex-1">
          <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor Case</span>
          <h1 className="text-[15px] sm:text-[17px] font-bold text-slate-900 leading-tight truncate">{supplier.name}</h1>
          {/* Badges on mobile — below name */}
          <div className="flex items-center gap-2 mt-1.5 sm:hidden flex-wrap">
            <RiskPill band={supplier.risk} />
            {supplier.oig && (
              <span className="pill pill-critical whitespace-nowrap text-[10px]">
                <Icon name="alertTri" size={9} stroke={2.5} />OIG FLAGGED
              </span>
            )}
          </div>
        </div>
        {/* Badges on desktop — right side */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <RiskPill band={supplier.risk} />
          {supplier.oig && (
            <span className="pill pill-critical whitespace-nowrap">
              <Icon name="alertTri" size={11} stroke={2.5} />OIG FLAGGED
            </span>
          )}
        </div>
      </div>

      {/* ── AI risk strip (summary + fraud-patterns toggle + fraud check) ── */}
      <div className="rounded-2xl px-4 sm:px-5 py-3.5 mb-4 sm:mb-6 flex items-center gap-3.5 flex-wrap"
           style={{ background: 'linear-gradient(180deg, #EAF1F5, #fff 65%)' }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(180deg, #3E7FA6, #2E6B8F)' }}>
          <Icon name="sparkle" size={15} style={{ color: '#fff' }} />
        </div>
        <div className="flex-1 min-w-[220px] text-[13px]">
          {sumLoading ? (
            <span className="text-slate-400">Generating summary…</span>
          ) : summary ? (
            <>
              <span className="text-slate-700 leading-relaxed">{summary}</span>{' '}
              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                {sumSource === 'llm' ? '✦ Generated by AI' : sumSource === 'error' ? 'Summary unavailable' : 'Rule-based summary'}
              </span>
            </>
          ) : (
            <><b style={{ color: '#2E6B8F' }}>AI Risk Summary</b> — Plain-English explanation of this vendor's risk hasn't been generated yet.</>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setPatternsOpen((o) => !o)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-[12.5px] font-bold transition-colors whitespace-nowrap ${
                    patternsOpen ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]' : 'bg-white text-[var(--color-primary)] border-slate-200 hover:bg-slate-50'
                  }`}>
            <Icon name="alertTri" size={14} />
            Fraud patterns
            {fraudPatterns.length > 0 && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${patternsOpen ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {fraudPatterns.length}
              </span>
            )}
            <Icon name="chevronDown" size={13} stroke={2.5} className={`transition-transform duration-200 ${patternsOpen ? 'rotate-180' : ''}`} />
          </button>
          {!summary ? (
            <button onClick={genSummary} disabled={sumLoading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-[12.5px] text-white disabled:opacity-60 transition-shadow whitespace-nowrap"
                    style={{ background: 'linear-gradient(180deg, #3E7FA6, #2E6B8F)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25), 0 6px 14px rgba(46,107,143,.25)' }}>
              {sumLoading ? 'Generating…' : 'Generate AI Summary →'}
            </button>
          ) : (
            <button onClick={genSummary} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors whitespace-nowrap">
              Regenerate
            </button>
          )}
          <button onClick={runFraudCheck} disabled={fraudCheckLoading}
                  className="px-3.5 py-2 rounded-lg bg-[#A6453F] hover:bg-[#8A423D] disabled:opacity-60 text-white text-[12.5px] font-bold transition-colors whitespace-nowrap">
            {fraudCheckLoading ? 'Checking…' : 'Run Fraud Check'}
          </button>
        </div>
      </div>

      {fraudCheckResult && (
        <div className="mb-4 sm:mb-6 -mt-1 px-4 py-2.5 rounded-lg bg-[#F7EBEA] border border-[#EBD3D1] text-[12px] text-[#8A423D]">
          {fraudCheckResult.error ? `Check failed: ${fraudCheckResult.error}` :
            fraudCheckResult.ghost_count > 0
              ? `${fraudCheckResult.ghost_count} ghost billing claim${fraudCheckResult.ghost_count !== 1 ? 's' : ''} detected out of ${fraudCheckResult.checked_claims} checked`
              : `No ghost billing detected across ${fraudCheckResult.checked_claims} claims`}
        </div>
      )}

      {/* ── KPI grid — shared moodboard KpiCard (glow circle, icon badge,
           colored progress track), same recipe as the physician dashboard ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <KpiCard tone="default" label="Distinct NPIs" value={supplier.distinctNPIs}
                 sub="Physicians billing this vendor"
                 icon={<Icon name="users" size={16} />}
                 onClick={() => scrollTo(physiciansRef)} />
        <KpiCard tone={supplier.physicianFlags > 0 ? 'danger' : 'default'} label="Physician-Raised Flags" value={supplier.physicianFlags}
                 sub="Manual flags raised by physicians" pct={supplier.physicianFlags > 0 ? 100 : 0}
                 icon={<Icon name="flag" size={16} />}
                 onClick={() => scrollTo(flagsRef)} />
        <KpiCard tone="ai" label="Total Billed" value={fmtUSD(supplier.totalAmount)}
                 sub="Across all claims"
                 icon={<Icon name="bolt" size={16} />}
                 onClick={() => { setPhysSort({ key: 'billed', dir: 'desc' }); scrollTo(physiciansRef) }} />
        <KpiCard tone="warning" label="Denials" value={data?.totalDenials ?? 0}
                 sub="Claims denied to date" pct={(data?.totalDenials ?? 0) > 0 ? 100 : 0}
                 icon={<Icon name="ban" size={16} />} />
      </div>

      {/* ── Fraud patterns detected — toggled by the "Fraud patterns" button in
           the AI strip above (same behaviour as the NPI investigation page) ── */}
      {data && patternsOpen && (
        <div className="mc-card overflow-hidden mb-4 sm:mb-6">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[#F7EBEA] text-[#A6453F] flex items-center justify-center shrink-0">
                <Icon name="alertTri" size={14} />
              </span>
              <h2 className="text-sm font-bold text-slate-900">Fraud patterns detected</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {fraudPatterns.length > 0 && (
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md tabular-nums">
                  {fraudPatterns.length} {fraudPatterns.length === 1 ? 'pattern' : 'patterns'}
                </span>
              )}
              <button type="button" onClick={() => setPatternsOpen(false)} title="Close"
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-[var(--color-primary)] hover:bg-slate-100 transition-colors">
                <Icon name="x" size={15} stroke={2} />
              </button>
            </div>
          </div>
          <div className="p-4 sm:p-5">
            {fraudPatterns.length === 0 ? (
              <p className="text-xs text-slate-400">No automated fraud patterns detected on this vendor's claims.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {fraudPatterns.map((r) => {
                  const sev = getSeverity(r.points)
                  return (
                    <button key={r.rule} type="button" onClick={() => setActivePattern(r)}
                            title="See what this pattern means and the claims it fired on"
                            className="group text-left rounded-xl border border-slate-200 p-3.5 flex items-start gap-3 w-full transition-all duration-150 hover:bg-slate-50 hover:border-[var(--color-primary)]/25 hover:-translate-y-px hover:shadow-sm">
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: sev.badgeBg, color: sev.badgeTx }}>
                        <Icon name={RULE_ICON[r.rule] || 'alertTri'} size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[15px] font-semibold text-slate-900 leading-snug">{r.label}</div>
                          <Icon name="chevronRight" size={14} className="text-slate-300 group-hover:text-[var(--color-primary)] group-hover:translate-x-0.5 transition-all shrink-0" />
                        </div>
                        <span className="inline-block mt-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide" style={{ background: sev.badgeBg, color: sev.badgeTx }}>{sev.label}</span>
                        <div className="text-[12.5px] text-slate-600 mt-1.5">+{r.points} risk points · {r.claimCount} claim{r.claimCount !== 1 ? 's' : ''}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Two-column panels ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

        {/* Physicians billing this supplier */}
        <div ref={physiciansRef} className="mc-card overflow-hidden scroll-mt-20">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Physicians Billing This Vendor ({physicians.length})</h2>
          </div>

          {/* Mobile card view (< sm) */}
          <div className="sm:hidden divide-y divide-slate-100">
            {error && <div className="px-4 py-4 text-[#A6453F] text-sm">{error}</div>}
            {!error && physicians.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-400">Loading…</div>
            )}
            {sortedPhysicians.map((p) => (
              <div key={p.npi}
                   onClick={() => onSelectPhysician?.({ npi: p.npi, name: p.name })}
                   className="px-4 py-3 hover:bg-slate-50 active:bg-slate-100 cursor-pointer transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800 truncate">{p.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums truncate">
                      {p.npi}{p.city ? ` · ${p.city}` : ''}{p.state ? `, ${p.state}` : ''}
                    </div>
                  </div>
                  <Icon name="chevronRight" size={14} className="text-slate-300 shrink-0 mt-0.5" />
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[12px]">
                  <span className="text-slate-500 tabular-nums">
                    <span className="font-semibold text-slate-700">{p.claimCount}</span> claims
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold text-slate-700 tabular-nums">{fmtUSD(p.totalAmount)}</span>
                  {p.flagsOnThisSupplier > 0 && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="font-bold text-[#A6453F] tabular-nums">{p.flagsOnThisSupplier} pattern hits</span>
                    </>
                  )}
                  {p.hasDenied && <span className="pill pill-critical text-[10px]">DENIED</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table (sm+) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  {PHYS_COLUMNS.map((c) => {
                    const active = physSort.key === c.key
                    return (
                      <th key={c.key} onClick={() => onPhysSort(c.key)}
                          className={`th cursor-pointer select-none group ${c.right ? 'text-right' : ''} ${c.cls || ''}`}>
                        <span className="inline-flex items-center gap-1 group-hover:text-[var(--color-primary)] transition-colors">
                          {c.label}
                          {active
                            ? <span className="text-[var(--color-primary)]">{physSort.dir === 'asc' ? '↑' : '↓'}</span>
                            : <span className="text-slate-300 group-hover:text-slate-500 transition-colors">↕</span>}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {error && <tr><td colSpan={4} className="td text-[#A6453F] text-sm">{error}</td></tr>}
                {!error && physicians.length === 0 && (
                  <tr><td colSpan={4} className="td text-slate-400 text-sm">Loading…</td></tr>
                )}
                {sortedPhysicians.map((p) => (
                  <tr key={p.npi} onClick={() => onSelectPhysician?.({ npi: p.npi, name: p.name })}
                      title={`Open NPI detail for ${p.name}`}
                      className="group cursor-pointer transition-colors hover:bg-[var(--color-bg-soft)]">
                    <td className="td">
                      <div className="font-semibold text-slate-800 text-sm">{p.name}</div>
                      <div className="text-[11px] text-slate-400 tabular-nums">{p.npi} · {p.city}{p.state ? `, ${p.state}` : ''}</div>
                    </td>
                    <td className="td text-right tabular-nums">{p.claimCount}</td>
                    <td className="td text-right tabular-nums font-semibold text-slate-800 hidden sm:table-cell">{fmtUSD(p.totalAmount)}</td>
                    <td className="td text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-2">
                        <span>
                          {p.flagsOnThisSupplier > 0
                            ? <span className="font-bold text-[#A6453F]">{p.flagsOnThisSupplier}</span>
                            : <span className="text-slate-300">—</span>}
                          {p.hasDenied && <span className="ml-1 pill pill-critical">DENIED</span>}
                        </span>
                        <span className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Icon name="chevronRight" size={14} />
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Flags raised against this supplier */}
        <div ref={flagsRef} className="mc-card overflow-hidden scroll-mt-20">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Physician-Raised Flags ({flags.length})</h2>
          </div>
          <div className="divide-y divide-slate-100 max-h-[360px] sm:max-h-[420px] overflow-y-auto">
            {flags.length === 0 && (
              <div className="px-4 sm:px-5 py-8 text-center">
                <div className="text-sm text-slate-500">No manual physician flags yet.</div>
                {fraudPatterns.length > 0 && (
                  <div className="text-[12px] text-slate-400 mt-1">
                    {fraudPatterns.length} automated fraud pattern{fraudPatterns.length !== 1 ? 's' : ''} already detected above — this vendor is flagged by the rules engine, not by physicians.
                  </div>
                )}
              </div>
            )}
            {flags.map((a) => {
              const m = ALERT_META[a.action] || ALERT_META.flagged
              return (
                <div key={a.id} className="px-4 sm:px-5 py-3 sm:py-3.5 flex items-center gap-3">
                  <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${m.chip}`}>
                    <Icon name={m.icon} size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] sm:text-sm font-semibold text-slate-800 truncate">{a.physicianName}</div>
                    <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
                      {m.label} · {fmtUSD(a.amount, 2)} · {timeAgo(a.ts)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>

      {/* Fraud-pattern evidence modal — opens when a pattern card is clicked */}
      {activePattern && (
        <VendorEvidencePanel
          supplierId={supplier.id}
          rule={activePattern.rule}
          label={activePattern.label}
          points={activePattern.points}
          onClose={() => setActivePattern(null)}
          onOpenNpi={(npi, name) => { setActivePattern(null); onSelectPhysician?.({ npi, name }) }}
        />
      )}
    </div>
  )
}
