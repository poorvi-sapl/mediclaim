import { useState, useEffect, useRef } from 'react'
import { getSupplierPhysicians, getAlertsHistory } from '../../api'
import { Icon, RiskPill, fmtUSD, timeAgo } from '../../components/ui'
import { KpiCard } from '../../components/ui/kpi-card'

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
  { key: 'flags',  label: 'Flags',   right: true },
]
const PHYS_COMPARATORS = {
  name:   (a, b) => (a.name || '').localeCompare(b.name || ''),
  claims: (a, b) => (a.claimCount || 0) - (b.claimCount || 0),
  billed: (a, b) => (a.totalAmount || 0) - (b.totalAmount || 0),
  flags:  (a, b) => (a.flagsOnThisSupplier || 0) - (b.flagsOnThisSupplier || 0),
}

export default function SupplierDetail({ supplier, onBack, onSelectPhysician }) {
  const [data, setData]       = useState(null)
  const [flags, setFlags]     = useState([])
  const [error, setError]     = useState(null)
  const [physSort, setPhysSort] = useState({ key: null, dir: null })
  const physiciansRef = useRef(null)
  const flagsRef      = useRef(null)
  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  useEffect(() => {
    if (!supplier?.id) return
    let cancelled = false
    setPhysSort({ key: null, dir: null })
    Promise.all([getSupplierPhysicians(supplier.id), getAlertsHistory(50, 0, supplier.id)])
      .then(([d, a]) => { if (!cancelled) { setData(d); setFlags(a.items) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [supplier])

  function onPhysSort(key) {
    setPhysSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }

  if (!supplier) return <div className="w-full px-4 sm:px-7 py-5 sm:py-7 text-slate-500">No vendor selected.</div>

  const physicians = data?.physicians || []
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
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#F7EBEA] text-[#A6453F] ring-1 ring-[#EBD3D1] flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
          <Icon name="suppliers" size={16} />
        </div>
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

      {/* ── KPI grid — shared moodboard KpiCard (glow circle, icon badge,
           colored progress track), same recipe as the physician dashboard ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <KpiCard tone="default" label="Distinct NPIs" value={supplier.distinctNPIs}
                 sub="Physicians billing this vendor"
                 icon={<Icon name="users" size={16} />}
                 onClick={() => scrollTo(physiciansRef)} />
        <KpiCard tone={supplier.physicianFlags > 0 ? 'danger' : 'default'} label="Physician Flags" value={supplier.physicianFlags}
                 sub="Raised by physicians" pct={supplier.physicianFlags > 0 ? 100 : 0}
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
                      <span className="font-bold text-[#A6453F] tabular-nums">{p.flagsOnThisSupplier} flags</span>
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
                        <span className="inline-flex items-center gap-1 group-hover:text-[#0A1F3D] transition-colors">
                          {c.label}
                          {active
                            ? <span className="text-[#0A1F3D]">{physSort.dir === 'asc' ? '↑' : '↓'}</span>
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
                      className="group cursor-pointer transition-colors hover:bg-[#F7F9FC]">
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
            <h2 className="text-sm font-bold text-slate-900">Flags Raised ({flags.length})</h2>
          </div>
          <div className="divide-y divide-slate-100 max-h-[360px] sm:max-h-[420px] overflow-y-auto">
            {flags.length === 0 && (
              <div className="px-4 sm:px-5 py-8 text-center text-sm text-slate-400">
                No physician flags on this vendor.
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
    </div>
  )
}
