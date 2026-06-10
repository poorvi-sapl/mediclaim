import { Icon, StatCard, fmtUSD, fmtDate } from './ui'

export default function FlaggedSuppliers({ suppliers = [], onSelectSupplier }) {
  const total = suppliers.length
  const totalAmount = suppliers.reduce((acc, s) => acc + (s.totalAmount || 0), 0)
  const totalClaims = suppliers.reduce((acc, s) => acc + (s.claimsCount || 0), 0)
  const maxClaims = Math.max(1, ...suppliers.map((s) => s.claimsCount || 0))

  return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
        <StatCard icon="flag" label="Suppliers Flagged" value={total} accent="navy" spark={false} />
        <StatCard icon="bolt" label="Total Billed" value={fmtUSD(totalAmount)} accent="rose" spark={false} />
        <StatCard icon="doc" label="Claims Under My NPI" value={totalClaims.toLocaleString()} accent="blue" spark={false} />
      </div>

      {total === 0 ? (
        <div className="mc-card py-16 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center"><Icon name="check" size={24} /></div>
          <p className="text-sm font-semibold text-slate-700">No suppliers flagged yet</p>
          <p className="text-xs text-slate-400 mt-1.5">Use the Claims table to flag suppliers you don't recognize.</p>
        </div>
      ) : (
        <div className="mc-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="th">Supplier Name</th>
                  <th className="th">Claims Under My NPI</th>
                  <th className="th text-right">Total Amount</th>
                  <th className="th hidden md:table-cell">Date Flagged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <tr key={s.id} onClick={() => onSelectSupplier?.(s.name)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                      title="View all claims under this supplier">
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 ring-1 ring-rose-100 flex items-center justify-center flex-shrink-0"><Icon name="flag" size={14} /></div>
                        <span className="font-semibold text-[#1B3A5C] hover:underline">{s.name}</span>
                      </div>
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2.5 min-w-[140px]">
                        <span className="text-sm tabular-nums text-slate-600 w-16">{s.claimsCount} claims</span>
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-ink" style={{ width: `${Math.round((s.claimsCount / maxClaims) * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="td text-right font-bold text-slate-800 tabular-nums">{fmtUSD(s.totalAmount)}</td>
                    <td className="td hidden md:table-cell text-slate-500 tabular-nums text-xs">{fmtDate(s.flaggedAt || s.firstFlagged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-5 rounded-xl px-5 py-4 text-sm text-white flex items-start gap-3" style={{ backgroundColor: '#1B3A5C' }}>
        <Icon name="shield" size={18} stroke={2} />
        <span className="text-white/90">Flagging a supplier adds it to the plan's fraud watchlist and raises that supplier's risk score — helping the plan detect coordinated fraud across physicians.</span>
      </div>
    </div>
  )
}
