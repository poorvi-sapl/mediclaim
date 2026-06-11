import { useState, useEffect } from 'react'

function exportCSV(filename, headers, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename })
  a.click(); URL.revokeObjectURL(a.href)
}
import { getSuppliers, getSupplierPhysicians, getAlertsHistory } from '../../api'
import { Icon, fmtUSD, fmtDate, timeAgo } from '../../components/ui'

const ALERT_META = {
  flagged: { icon: 'flag', chip: 'bg-amber-50 text-amber-500', label: 'Flag Supplier' },
  unknownPatient: { icon: 'userx', chip: 'bg-rose-50 text-rose-500', label: 'Unknown Patient' },
  deniedOrder: { icon: 'ban', chip: 'bg-rose-50 text-rose-600', label: 'Did Not Order' },
}

const PHYS_COLUMNS = [
  { key: 'name', label: 'Physician' },
  { key: 'claims', label: 'Claims', right: true },
  { key: 'billed', label: 'Billed', right: true },
  { key: 'flags', label: 'Flags', right: true },
]
const PHYS_COMPARATORS = {
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  claims: (a, b) => (a.claimCount || 0) - (b.claimCount || 0),
  billed: (a, b) => (a.totalAmount || 0) - (b.totalAmount || 0),
  flags: (a, b) => (a.flagsOnThisSupplier || 0) - (b.flagsOnThisSupplier || 0),
}

function StatBox({ label, value, danger }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <div className={`text-xl font-bold tabular-nums ${danger ? 'text-rose-600' : 'text-slate-900'}`}>{value}</div>
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-1">{label}</div>
    </div>
  )
}

export default function SupplierPanel({ supplierName, evidence = [], variant, onOpenNpi }) {
  const [supplier, setSupplier] = useState(null)
  const [data, setData] = useState(null)     // getSupplierPhysicians result
  const [flags, setFlags] = useState([])
  const [error, setError] = useState(null)
  const [sort, setSort] = useState({ key: null, dir: null })
  const [evLimit, setEvLimit] = useState(20)

  useEffect(() => {
    let cancelled = false
    setSupplier(null); setData(null); setFlags([]); setError(null); setSort({ key: null, dir: null })
    ;(async () => {
      try {
        const list = await getSuppliers()
        const row = list.find((s) => s.name === supplierName)
          || list.find((s) => (s.name || '').toLowerCase() === (supplierName || '').toLowerCase())
        if (cancelled) return
        setSupplier(row || { name: supplierName })
        if (row?.id) {
          const [p, a] = await Promise.all([getSupplierPhysicians(row.id), getAlertsHistory(50, 0, row.id)])
          if (!cancelled) { setData(p); setFlags(a.items) }
        }
      } catch (e) { if (!cancelled) setError(e.message) }
    })()
    return () => { cancelled = true }
  }, [supplierName])

  function onSort(key) {
    setSort((p) => p.key !== key ? { key, dir: 'asc' } : p.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: null })
  }

  const physicians = data?.physicians || []
  const sorted = (() => {
    const arr = [...physicians]
    if (sort.key && PHYS_COMPARATORS[sort.key]) {
      arr.sort(PHYS_COMPARATORS[sort.key]); if (sort.dir === 'desc') arr.reverse()
    } else { arr.sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0)) }
    return arr
  })()
  const oig = variant === 'oig' || supplier?.oig
  const ev = evidence.slice(0, evLimit)

  return (
    <div>
      {/* heading */}
      <div className="label-eyebrow">Supplier Investigation</div>
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        <h3 className="text-xl font-bold text-slate-900">{supplierName || supplier?.name || 'Supplier'}</h3>
        {oig && <span className="pill pill-critical"><Icon name="alertTri" size={11} stroke={2.5} />OIG EXCLUDED</span>}
      </div>

      {variant === 'new' && supplier && (
        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-700">
          First seen: <span className="font-semibold">{fmtDate(supplier.firstSeen)}</span> · High-value claims appeared immediately
        </div>
      )}

      {error && <div className="mt-4 text-sm text-rose-600">{error}</div>}

      {/* summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
        <StatBox label="Distinct NPIs" value={supplier?.distinctNPIs ?? data?.distinctNpis ?? '—'} />
        <StatBox label="Physician Flags" value={supplier?.physicianFlags ?? '—'} danger={(supplier?.physicianFlags || 0) > 0} />
        <StatBox label="Total Billed" value={supplier ? fmtUSD(supplier.totalAmount) : '—'} />
        <StatBox label="Denials" value={data?.totalDenials ?? 0} />
      </div>

      {/* cross-NPI explanation */}
      {variant === 'crossnpi' && (
        <div className="mt-5 rounded-xl bg-[#F0F4FF] border border-slate-200 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">Cross-NPI Pattern</div>
          <p className="text-xs text-slate-600 mt-1">
            This supplier is billing under {supplier?.distinctNPIs ?? data?.distinctNpis ?? physicians.length} distinct physician NPIs — a pattern consistent with coordinated fraud.
          </p>
        </div>
      )}

      {/* physicians billing this supplier */}
      <div className="mt-5 mc-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900">Physicians Billing This Supplier ({physicians.length})</h4>
          {physicians.length > 0 && (
            <button onClick={() => exportCSV('supplier-physicians.csv',
                ['Physician', 'NPI', 'City', 'State', 'Claims', 'Billed', 'Flags'],
                sorted.map(p => [p.name, p.npi, p.city, p.state, p.claimCount, p.totalAmount, p.flagsOnThisSupplier || 0]))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E3A5F]/20 bg-white text-[#1E3A5F] text-[12px] font-semibold hover:bg-[#EEF2F7] transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">
              {PHYS_COLUMNS.map((c) => {
                const active = sort.key === c.key
                return (
                  <th key={c.key} onClick={() => onSort(c.key)}
                      className={`th cursor-pointer select-none group ${c.right ? 'text-right' : ''}`}>
                    <span className="inline-flex items-center gap-1 group-hover:text-[#1E3A5F] transition-colors">
                      {c.label}
                      {active
                        ? <span className="text-[#1E3A5F]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                        : <span className="text-slate-300 group-hover:text-slate-500 transition-colors">↕</span>}
                    </span>
                  </th>
                )
              })}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!data && !error && <tr><td colSpan={4} className="td text-slate-400 text-sm">Loading…</td></tr>}
              {sorted.map((p) => (
                <tr key={p.npi} onClick={() => onOpenNpi?.({ npi: p.npi, name: p.name })}
                    title={`Open NPI detail for ${p.name}`}
                    className="group cursor-pointer transition-colors hover:bg-[#F9FAFB]">
                  <td className="td">
                    <div className="font-semibold text-slate-800 text-sm">{p.name}</div>
                    <div className="text-[11px] text-slate-400 tabular-nums">{p.npi} · {p.city}, {p.state}</div>
                  </td>
                  <td className="td text-right tabular-nums">{p.claimCount}</td>
                  <td className="td text-right tabular-nums font-semibold text-slate-800">{fmtUSD(p.totalAmount)}</td>
                  <td className="td text-right tabular-nums">
                    <span className="inline-flex items-center justify-end gap-2">
                      <span>{p.flagsOnThisSupplier > 0 ? <span className="font-bold text-rose-500">{p.flagsOnThisSupplier}</span> : <span className="text-slate-300">—</span>}</span>
                      <span className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"><Icon name="chevronRight" size={14} /></span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* flags raised */}
      <div className="mt-5 mc-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100"><h4 className="text-sm font-bold text-slate-900">Flags Raised ({flags.length})</h4></div>
        <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
          {flags.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-400">No physician flags on this supplier.</div>}
          {flags.map((a) => {
            const m = ALERT_META[a.action] || ALERT_META.flagged
            return (
              <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.chip}`}><Icon name={m.icon} size={15} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-800 truncate">{a.physicianName}</div>
                  <div className="text-[11px] text-slate-400">{m.label} · {fmtUSD(a.amount, 2)} · {timeAgo(a.ts)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* clean evidence list — two lines, no red text */}
      <div className="mt-5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
        Evidence — {evidence.length} claim{evidence.length !== 1 ? 's' : ''} triggered this
      </div>
      {evidence.length === 0 ? (
        <p className="text-sm text-slate-400 py-4">No specific claims recorded.</p>
      ) : (
        <div className="divide-y divide-slate-100 mt-1">
          {ev.map((c) => (
            <div key={c.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-800 truncate">{c.patient}</div>
                <div className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</div>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{fmtDate(c.date)} · {c.category} · {c.supplier}</div>
            </div>
          ))}
          {evidence.length > evLimit && (
            <button onClick={() => setEvLimit((n) => n + 20)} className="py-3 text-xs font-semibold text-[#1E3A5F] hover:underline">
              Show more ({evidence.length - evLimit} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
