import { Icon, fmtUSD, fmtDate } from './ui'

function exportCSV(filename, headers, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename })
  a.click(); URL.revokeObjectURL(a.href)
}

function KpiTile({ icon, label, value, accent = 'slate' }) {
  const styles = {
    slate:  { wrap: 'bg-slate-100',         icon: 'text-slate-500'    },
    navy:   { wrap: 'bg-[#e8eef7]',         icon: 'text-[#1B3A5C]'   },
    rose:   { wrap: 'bg-rose-100',          icon: 'text-rose-500'     },
    amber:  { wrap: 'bg-amber-100',         icon: 'text-amber-500'    },
    blue:   { wrap: 'bg-blue-100',          icon: 'text-blue-500'     },
    emerald:{ wrap: 'bg-emerald-100',       icon: 'text-emerald-600'  },
  }
  const s = styles[accent] || styles.slate
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-center gap-4 group cursor-default transition-all duration-200 hover:-translate-y-1 hover:shadow-md hover:border-slate-200">
      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${s.wrap}`}>
        <Icon name={icon} size={18} className={s.icon} />
      </div>
      <div className="min-w-0">
        <div className="text-[1.45rem] font-bold tabular-nums leading-none tracking-tight text-slate-900">{value}</div>
        <div className="text-[11px] font-medium text-slate-400 mt-1 uppercase tracking-wider leading-none">{label}</div>
      </div>
    </div>
  )
}

export default function FlaggedSuppliers({ suppliers = [], onSelectSupplier }) {
  const total = suppliers.length
  const totalAmount = suppliers.reduce((acc, s) => acc + (s.totalAmount || 0), 0)
  const totalClaims = suppliers.reduce((acc, s) => acc + (s.claimsCount || 0), 0)
  const maxClaims = Math.max(1, ...suppliers.map((s) => s.claimsCount || 0))

  return (
    <div className="w-full px-7 py-7">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiTile icon="flag" label="Suppliers Flagged"   value={total}                        accent="navy" />
        <KpiTile icon="bolt" label="Total Billed"        value={fmtUSD(totalAmount)}           accent="rose" />
        <KpiTile icon="doc"  label="Claims Under My NPI" value={totalClaims.toLocaleString()}  accent="blue" />
      </div>

      {total === 0 ? (
        <div className="mc-card py-16 text-center">
          {/* Stacked rings + flag icon */}
          <div className="relative inline-flex items-center justify-center mb-5">
            <div className="absolute w-20 h-20 rounded-full bg-slate-100/80" />
            <div className="absolute w-14 h-14 rounded-full bg-slate-200/60" />
            <div className="relative w-10 h-10 rounded-2xl bg-white shadow-md border border-slate-200 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                <line x1="4" y1="22" x2="4" y2="15"/>
              </svg>
            </div>
          </div>
          <p className="text-[14px] font-semibold text-slate-600">No suppliers flagged yet</p>
          <p className="text-[12px] text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">Use the Claims table to flag suppliers you don't recognize.</p>
        </div>
      ) : (
        <div className="mc-card overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Flagged Suppliers</h2>
              <p className="text-xs text-slate-400 mt-0.5">{total} supplier{total !== 1 ? 's' : ''} flagged under your NPI</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => exportCSV('flagged-suppliers.csv',
                  ['Supplier Name', 'Claims Under NPI', 'Total Amount', 'Date Flagged'],
                  suppliers.map(s => [s.name, s.claimsCount, s.totalAmount, fmtDate(s.flaggedAt || s.firstFlagged)]))}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E3A5F]/20 bg-white text-[#1E3A5F] text-[12px] font-semibold hover:bg-[#EEF2F7] transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export
              </button>
              <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 ring-1 ring-rose-200/60 px-2.5 py-1 rounded-full">{total} flagged</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="th">Supplier Name</th>
                  <th className="th">Claims Under My NPI</th>
                  <th className="th text-right">Total Amount</th>
                  <th className="th hidden md:table-cell">Date Flagged</th>
                  <th className="th w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <tr key={s.id} onClick={() => onSelectSupplier?.(s.name)}
                      className="group hover:bg-slate-50/80 transition-colors cursor-pointer"
                      title="View all claims under this supplier">
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-500 ring-1 ring-rose-100 flex items-center justify-center flex-shrink-0 group-hover:bg-rose-100 transition-colors">
                          <Icon name="flag" size={13} />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[13px] font-semibold text-slate-800 group-hover:text-[#1B3A5C] transition-colors">{s.name}</span>
                        </div>
                      </div>
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-3 min-w-[160px]">
                        <span className="text-[13px] tabular-nums font-medium text-slate-600 whitespace-nowrap w-20 text-right flex-shrink-0">{s.claimsCount} claims</span>
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden min-w-[60px]">
                          <div className="h-full rounded-full bg-[#1B3A5C]/60 transition-all duration-300" style={{ width: `${Math.round((s.claimsCount / maxClaims) * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="td text-right">
                      <span className="text-[14px] font-bold text-slate-800 tabular-nums">{fmtUSD(s.totalAmount)}</span>
                    </td>
                    <td className="td hidden md:table-cell">
                      <span className="text-[12px] text-slate-400 tabular-nums">{fmtDate(s.flaggedAt || s.firstFlagged)}</span>
                    </td>
                    <td className="td">
                      <span className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"><Icon name="chevronRight" size={14} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info banner */}
      <div className="mt-5 mc-card px-5 py-4 flex items-start gap-3.5 border-[#1B3A5C]/10">
        <div className="w-8 h-8 rounded-xl bg-[#EEF2F7] text-[#1B3A5C] flex items-center justify-center flex-shrink-0 mt-0.5">
          <Icon name="shield" size={15} stroke={2} />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-slate-800">How flagging helps</div>
          <div className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">Flagging a supplier adds it to the plan's fraud watchlist and raises that supplier's risk score — helping the plan detect coordinated fraud across physicians.</div>
        </div>
      </div>
    </div>
  )
}
