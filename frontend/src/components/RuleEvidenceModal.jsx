import { useState, useEffect } from 'react'
import { getRuleEvidence } from '../api'
import { Icon, fmtUSD, fmtDate } from './ui'

export default function RuleEvidenceModal({ npi, rule, label, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!npi || !rule) return
    setData(null); setError(null)
    getRuleEvidence(npi, rule).then(setData).catch((e) => setError(e.message))
  }, [npi, rule])

  if (!rule) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="mc-card w-full max-w-2xl p-6 animate-fade-in-up max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center"><Icon name="alertTri" size={18} /></div>
            <div>
              <h3 className="text-base font-bold text-slate-900">{label || data?.label || 'Fraud Pattern'}</h3>
              <p className="text-xs text-slate-400">Why this fired · NPI {npi}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><Icon name="x" size={18} /></button>
        </div>

        {error && <div className="mt-5 text-sm text-rose-600">{error}</div>}
        {!data && !error && <div className="mt-6 h-32 rounded-xl bg-slate-100 animate-pulse" />}

        {data && (
          <>
            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex-shrink-0">
              <p className="text-sm text-slate-700 leading-relaxed">{data.explanation}</p>
            </div>
            <div className="mt-4 mb-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0">
              Evidence — {data.count} claim{data.count !== 1 ? 's' : ''} triggered this
            </div>
            <div className="overflow-y-auto -mx-2 px-2">
              {data.claims.length === 0 ? (
                <p className="text-sm text-slate-400 py-4">No specific claims recorded.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.claims.slice(0, 50).map((c) => (
                    <div key={c.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-800">{c.patient}</div>
                        <div className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</div>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {fmtDate(c.date)} · {c.category} · {c.supplier}
                      </div>
                      {c.why && <div className="text-[11px] text-rose-600/90 mt-1 leading-snug">{c.why}</div>}
                    </div>
                  ))}
                  {data.claims.length > 50 && (
                    <div className="py-3 text-xs text-slate-400">+ {data.claims.length - 50} more claims…</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
