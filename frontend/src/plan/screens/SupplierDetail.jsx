import { useState, useEffect, useRef } from 'react'
import { getSupplierPhysicians, getAlertsHistory } from '../../api'
import { Icon, RiskPill, fmtUSD, timeAgo } from '../../components/ui'

function KpiCard({ icon, label, value, accent = 'slate', onClick }) {
  const styles = {
    slate:  { icon: 'bg-slate-100 text-slate-500'    },
    rose:   { icon: 'bg-rose-50 text-rose-500'       },
    blue:   { icon: 'bg-blue-50 text-blue-500'       },
    amber:  { icon: 'bg-amber-50 text-amber-500'     },
    emerald:{ icon: 'bg-emerald-50 text-emerald-600' },
  }
  const s = styles[accent] || styles.slate
  const cls = `mc-card px-5 py-4 flex flex-col gap-3 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-6px_rgba(15,23,42,0.10)] hover:border-slate-200 transition-all duration-200 ${onClick ? 'cursor-pointer' : ''}`
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none pt-0.5">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${s.icon}`}>
          <Icon name={icon} size={15} />
        </div>
      </div>
      <div className="text-[1.6rem] font-bold tabular-nums leading-none tracking-tight text-slate-900">{value}</div>
    </>
  )
  if (onClick) return <button onClick={onClick} className={cls + ' text-left w-full'}>{inner}</button>
  return <div className={cls}>{inner}</div>
}

const ALERT_META = {
  flagged: { icon: 'flag', chip: 'bg-amber-50 text-amber-500', label: 'Flag Supplier' },
  unknownPatient: { icon: 'userx', chip: 'bg-rose-50 text-rose-500', label: 'Unknown Patient' },
  deniedOrder: { icon: 'ban', chip: 'bg-rose-50 text-rose-600', label: 'Did Not Order' },
}

// Physicians-billing table sort. All columns sortable; default = billed desc.
const PHYS_COLUMNS = [
  { key: 'name', label: 'Physician' },
  { key: 'claims', label: 'Claims', right: true },
  { key: 'billed', label: 'Billed', right: true, cls: 'hidden sm:table-cell' },
  { key: 'flags', label: 'Flags', right: true },
]
const PHYS_COMPARATORS = {
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  claims: (a, b) => (a.claimCount || 0) - (b.claimCount || 0),
  billed: (a, b) => (a.totalAmount || 0) - (b.totalAmount || 0),
  flags: (a, b) => (a.flagsOnThisSupplier || 0) - (b.flagsOnThisSupplier || 0),
}

export default function SupplierDetail({ supplier, onBack, onSelectPhysician }) {
  const [data, setData] = useState(null)
  const [flags, setFlags] = useState([])
  const [error, setError] = useState(null)
  const [physSort, setPhysSort] = useState({ key: null, dir: null })   // null = default (billed desc)
  const physiciansRef = useRef(null)
  const flagsRef = useRef(null)
  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  useEffect(() => {
    if (!supplier?.id) return
    let cancelled = false
    setPhysSort({ key: null, dir: null })   // reset sort when a different supplier loads
    Promise.all([getSupplierPhysicians(supplier.id), getAlertsHistory(50, 0, supplier.id)])
      .then(([d, a]) => { if (!cancelled) { setData(d); setFlags(a.items) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [supplier])

  function onPhysSort(key) {
    setPhysSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }

  if (!supplier) return <div className="w-full px-4 sm:px-7 py-5 sm:py-7 text-slate-500">No supplier selected.</div>

  const physicians = data?.physicians || []
  const sortedPhysicians = (() => {
    const arr = [...physicians]
    if (physSort.key && PHYS_COMPARATORS[physSort.key]) {
      arr.sort(PHYS_COMPARATORS[physSort.key])
      if (physSort.dir === 'desc') arr.reverse()
    } else {
      arr.sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0))   // default: highest billing first
    }
    return arr
  })()

  return (
    <div className="w-full px-4 sm:px-7 py-5 sm:py-7">

      {/* Header */}
      <div className="mc-card px-6 py-4 mb-6 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 ring-1 ring-rose-100 flex items-center justify-center shrink-0">
          <Icon name="suppliers" size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Supplier Case</span>
          <h1 className="text-display text-[17px] font-bold text-slate-900 leading-tight truncate">{supplier.name}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <RiskPill band={supplier.risk} />
          {supplier.oig && <span className="pill pill-critical whitespace-nowrap"><Icon name="alertTri" size={11} stroke={2.5} />OIG FLAGGED</span>}
        </div>
      </div>

      {/* Signals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard icon="users" label="Distinct NPIs"    value={supplier.distinctNPIs}       accent="slate"   onClick={() => scrollTo(physiciansRef)} />
        <KpiCard icon="flag"  label="Physician Flags"  value={supplier.physicianFlags}      accent="rose"    onClick={() => scrollTo(flagsRef)} />
        <KpiCard icon="bolt"  label="Total Billed"     value={fmtUSD(supplier.totalAmount)} accent="blue" />
        <KpiCard icon="ban"   label="Denials"          value={data?.totalDenials ?? 0}      accent="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Physicians billing this supplier */}
        <div ref={physiciansRef} className="mc-card overflow-hidden scroll-mt-20">
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="text-sm font-bold text-slate-900">Physicians Billing This Supplier ({physicians.length})</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                {PHYS_COLUMNS.map((c) => {
                  const active = physSort.key === c.key
                  return (
                    <th key={c.key} onClick={() => onPhysSort(c.key)}
                        className={`th cursor-pointer select-none group ${c.right ? 'text-right' : ''} ${c.cls || ''}`}>
                      <span className="inline-flex items-center gap-1 group-hover:text-[#1E3A5F] transition-colors">
                        {c.label}
                        {active
                          ? <span className="text-[#1E3A5F]">{physSort.dir === 'asc' ? '↑' : '↓'}</span>
                          : <span className="text-slate-300 group-hover:text-slate-500 transition-colors">↕</span>}
                      </span>
                    </th>
                  )
                })}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {error && <tr><td colSpan={4} className="td text-rose-600 text-sm">{error}</td></tr>}
                {!error && physicians.length === 0 && <tr><td colSpan={4} className="td text-slate-400 text-sm">Loading…</td></tr>}
                {sortedPhysicians.map((p) => (
                  <tr key={p.npi} onClick={() => onSelectPhysician?.({ npi: p.npi, name: p.name })}
                      title={`Open NPI detail for ${p.name}`}
                      className="group cursor-pointer transition-colors hover:bg-[#F9FAFB]">
                    <td className="td">
                      <div className="font-semibold text-slate-800 text-sm">{p.name}</div>
                      <div className="text-[11px] text-slate-400 tabular-nums">{p.npi} · {p.city}{p.state ? `, ${p.state}` : ''}</div>
                    </td>
                    <td className="td text-right tabular-nums">{p.claimCount}</td>
                    <td className="td text-right tabular-nums font-semibold text-slate-800 hidden sm:table-cell">{fmtUSD(p.totalAmount)}</td>
                    <td className="td text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-2">
                        <span>
                          {p.flagsOnThisSupplier > 0 ? <span className="font-bold text-rose-500">{p.flagsOnThisSupplier}</span> : <span className="text-slate-300">—</span>}
                          {p.hasDenied && <span className="ml-1 pill pill-critical">DENIED</span>}
                        </span>
                        <span className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"><Icon name="chevronRight" size={14} /></span>
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
          <div className="px-5 py-4 border-b border-slate-100"><h2 className="text-sm font-bold text-slate-900">Flags Raised ({flags.length})</h2></div>
          <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
            {flags.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">No physician flags on this supplier.</div>}
            {flags.map((a) => {
              const m = ALERT_META[a.action] || ALERT_META.flagged
              return (
                <div key={a.id} className="px-5 py-3.5 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${m.chip}`}><Icon name={m.icon} size={16} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-800 truncate">{a.physicianName}</div>
                    <div className="text-[11px] text-slate-400">{m.label} · {fmtUSD(a.amount, 2)} · {timeAgo(a.ts)}</div>
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
