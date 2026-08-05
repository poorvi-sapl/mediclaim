import { useEffect, useState, Fragment } from 'react'
import { useJsApiLoader, GoogleMap, MarkerF, PolylineF } from '@react-google-maps/api'
import { getSupplierRuleEvidence } from '../../api'
import { Icon, fmtUSD, fmtDate } from '../../components/ui'

// ── helpers ──────────────────────────────────────────────────────────────
function getSeverity(points) {
  if (points >= 35) return { label: 'CRITICAL', badgeBg: '#A6453F', badgeTx: '#fff' }
  if (points >= 25) return { label: 'HIGH',     badgeBg: '#FCE4E1', badgeTx: '#8A423D' }
  if (points >= 15) return { label: 'MEDIUM',   badgeBg: '#FBF3E4', badgeTx: '#8A6A34' }
  return               { label: 'LOW',      badgeBg: '#E9F3ED', badgeTx: '#2E6B4F' }
}

const RED_CARD = { background: '#F7EBEA', border: '1px solid #EBD3D1' }
const sumAmt = (cs) => cs.reduce((s, c) => s + (c.amount || 0), 0)
const milesOf = (why) => { const m = /([\d,]+)\s*miles/i.exec(why || ''); return m ? parseInt(m[1].replace(/,/g, ''), 10) : -1 }
const upMultOf = (why) => { const m = /([\d.]+)x the median/i.exec(why || ''); return m ? parseFloat(m[1]) : null }
const deceasedOf = (why) => { const m = /for (\d+) days \(last seen ([\d-]+)/.exec(why || ''); return m ? { gap: +m[1], last: m[2] } : {} }
const concOf = (why) => { const m = /(\d+)% of NPI.+?\((\d+) of (\d+)\)/.exec(why || ''); return m ? { pct: +m[1], dom: +m[2], tot: +m[3] } : {} }

// Only rules that need a filtered/no-claims layout live here; everything else
// is handled by an explicit per-rule branch or the default view.
const RULE_VIEW = {
  oig_leie_hit: { mode: 'oig' },
}

// ── small shared pieces ──────────────────────────────────────────────────
function SectionLabel({ children }) {
  return <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{children}</div>
}
function Empty({ children }) {
  return <p className="text-xs text-slate-400 py-3 leading-relaxed">{children}</p>
}
function ExPill() {
  return <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-[#A6453F] text-white">OIG excluded</span>
}
function ClaimCard({ c }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-800 truncate">{c.patient}</span>
        <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">{fmtUSD(c.amount, 2)}</span>
      </div>
      <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">
        {fmtDate(c.date)} · {c.category}{c.description ? ` · ${c.description}` : ''}
      </div>
      <div className="text-[11px] text-slate-400 mt-0.5 truncate">{c.physician} · NPI {c.npi}</div>
    </div>
  )
}
// A clickable, physician-centric card (name + subline + chevron → open NPI).
function PhysicianCard({ physician, npi, sub, badge, onOpenNpi }) {
  return (
    <button type="button" onClick={() => onOpenNpi?.(npi, physician)}
            className="group w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-100 hover:bg-[#F7EBEA]/40 hover:border-[#EBD3D1] hover:-translate-y-px hover:shadow-sm transition-all duration-150">
      <div className="w-2 h-2 rounded-full bg-[#A6453F] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-slate-800 group-hover:text-[var(--color-primary)] flex items-center gap-2">
          <span className="truncate">{physician}</span>{badge}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">{sub}</div>
      </div>
      <Icon name="chevronRight" size={13} stroke={2.2}
            className="text-slate-300 group-hover:text-[var(--color-primary)] group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
    </button>
  )
}
function DayCard({ d, n, unit, pct, normal, times }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-800">{fmtDate(d.date)}</span>
        <span className="shrink-0 text-[11px] font-bold text-[#8A423D] bg-[#F7EBEA] border border-[#EBD3D1] px-2 py-0.5 rounded-md tabular-nums">{n} {unit}</span>
      </div>
      <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">{d.physician} · NPI {d.npi}</div>
      <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden mt-2">
        <div className="h-full rounded-full bg-[#A6453F]" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-slate-400">typical ~{normal} {unit}/day</span>
        <span className="text-[10px] font-semibold text-[#A6453F]">{times}× a normal day</span>
      </div>
    </div>
  )
}
function ClaimsReveal({ open, onToggle, claims, count, shown, capped, verb = 'flagged' }) {
  return (
    <>
      <div className="text-center mt-4">
        <button type="button" onClick={onToggle}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 shadow-sm transition-all hover:border-[var(--color-primary)]/25 hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-primary)]">
          {open ? 'Hide claims' : `View all ${count} ${verb} claims`}
          <Icon name="chevronDown" size={14} stroke={2.2} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="space-y-2 mt-3">
          {claims.map((c) => <ClaimCard key={c.id} c={c} />)}
          {capped && <p className="text-[11px] text-slate-400 text-center pt-1">showing {shown} of {count}</p>}
        </div>
      )}
    </>
  )
}

// group-by helpers (vendor is fixed, so we key by physician/npi instead of supplier)
function groupUnbundling(claims) {
  const m = {}
  claims.forEach((c) => {
    const k = `${c.patient}|${c.date}|${c.npi}`
    if (!m[k]) m[k] = { key: k, patient: c.patient, date: c.date, physician: c.physician, npi: c.npi, claims: [] }
    m[k].claims.push(c)
  })
  return Object.values(m).filter((g) => g.claims.length >= 2).sort((a, b) => sumAmt(b.claims) - sumAmt(a.claims))
}
function duplicatePairs(claims) {
  const byPatient = {}
  claims.forEach((c) => { (byPatient[c.patient] = byPatient[c.patient] || []).push(c) })
  const pairs = []
  Object.values(byPatient).forEach((list) => {
    const ord = [...list].sort((a, b) => new Date(a.date) - new Date(b.date))
    for (let i = 0; i < ord.length - 1; i++) {
      const days = Math.round((new Date(ord[i + 1].date) - new Date(ord[i].date)) / 86400000)
      if (days >= 0 && days <= 30) pairs.push({ patient: ord[i].patient, physician: ord[i].physician, npi: ord[i].npi, c1: ord[i], c2: ord[i + 1], days })
    }
  })
  return pairs
}
function modifierPairs(claims) {
  const groups = {}
  claims.forEach((c) => { const k = `${c.patient}|${c.date}|${c.npi}`; (groups[k] = groups[k] || []).push(c) })
  const pairs = []
  Object.values(groups).forEach((g) => { for (let i = 0; i + 1 < g.length; i += 2) pairs.push([g[i], g[i + 1]]) })
  return pairs
}

// Geographic-anomaly map — a vendor spans many physicians, so we plot every
// physician practice (red) + each distant patient (blue) with a line between
// them. Cooperative gestures so scrolling the modal doesn't hijack the map.
const RED_PIN = 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
const BLUE_PIN = 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
function VendorGeoMap({ claims }) {
  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY })
  const practices = {}
  claims.forEach((c) => {
    if (c.practiceLat != null && c.practiceLng != null && !practices[c.npi]) {
      practices[c.npi] = { lat: c.practiceLat, lng: c.practiceLng, name: c.physician }
    }
  })
  const pracList = Object.entries(practices).map(([npi, p]) => ({ npi, ...p }))
  const patients = claims
    .filter((c) => c.patientLat != null && c.patientLng != null)
    .map((c) => ({ lat: c.patientLat, lng: c.patientLng, name: c.patient, npi: c.npi }))
  if (!pracList.length && !patients.length) return null
  if (!isLoaded) return <div className="h-[240px] w-full bg-slate-100 animate-pulse rounded-xl" />
  const onLoad = (map) => {
    const b = new window.google.maps.LatLngBounds()
    pracList.forEach((p) => b.extend({ lat: Number(p.lat), lng: Number(p.lng) }))
    patients.forEach((p) => b.extend({ lat: Number(p.lat), lng: Number(p.lng) }))
    if (!b.isEmpty()) map.fitBounds(b, 40)
  }
  return (
    <div className="h-[240px] w-full rounded-xl overflow-hidden border border-slate-200">
      <GoogleMap mapContainerStyle={{ height: '100%', width: '100%' }} onLoad={onLoad}
                 options={{ mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: 'cooperative' }}>
        {pracList.map((p) => (
          <MarkerF key={p.npi} position={{ lat: Number(p.lat), lng: Number(p.lng) }} title={`${p.name} — practice`} icon={RED_PIN} />
        ))}
        {patients.map((p, i) => {
          const prac = practices[p.npi]
          return (
            <Fragment key={i}>
              <MarkerF position={{ lat: Number(p.lat), lng: Number(p.lng) }} title={p.name} icon={BLUE_PIN} />
              {prac && <PolylineF path={[{ lat: Number(prac.lat), lng: Number(prac.lng) }, { lat: Number(p.lat), lng: Number(p.lng) }]}
                                  options={{ strokeColor: '#A6453F', strokeWeight: 1.5, strokeOpacity: 0.6, geodesic: true }} />}
            </Fragment>
          )
        })}
      </GoogleMap>
    </div>
  )
}

// ── component ────────────────────────────────────────────────────────────
export default function VendorEvidencePanel({ supplierId, rule, label, points, onClose, onOpenNpi }) {
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)
  const [showClaimsList, setShowClaimsList] = useState(false)
  const sev = getSeverity(points)

  useEffect(() => {
    let cancelled = false
    setData(null); setError(null); setShowClaimsList(false)
    getSupplierRuleEvidence(supplierId, rule)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [supplierId, rule])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const claims = data?.claims || []
  const breakdown = data?.npiBreakdown || []
  const excludedPhysicians = breakdown.filter((n) => n.oigExcluded)
  const dayBreakdown = data?.dayBreakdown || []
  const mode = RULE_VIEW[rule]?.mode
  const reveal = (verb) => (
    <ClaimsReveal open={showClaimsList} onToggle={() => setShowClaimsList((v) => !v)}
                  claims={claims} count={data?.count} shown={data?.shown} capped={data?.capped} verb={verb} />
  )

  // Scrollable body per pattern (everything except OIG, which has its own layout).
  function renderBody() {
    // ── day-based: impossible_day (claims/day) & rapid_cycling (patients/day) ──
    if (rule === 'impossible_day' || rule === 'rapid_cycling') {
      const isRapid = rule === 'rapid_cycling'
      const metric = (d) => (isRapid ? d.patientCount : d.claimCount)
      const unit = isRapid ? 'patients' : 'claims'
      const normal = isRapid ? 8 : 12
      const maxN = dayBreakdown.length ? Math.max(...dayBreakdown.map(metric)) : 1
      const heading = isRapid
        ? 'High-turnover days — too many distinct patients for one day'
        : 'Impossible days — more claims than one physician could bill'
      return (
        <>
          <SectionLabel>{heading} ({dayBreakdown.length})</SectionLabel>
          {dayBreakdown.length === 0 ? <Empty>No such days found for this vendor.</Empty> : (
            <>
              <div className="space-y-2 mt-2">
                {dayBreakdown.map((d) => {
                  const n = metric(d)
                  const pct = Math.max(6, Math.round((n / maxN) * 100))
                  const times = Math.max(1, Math.round(n / normal))
                  return <DayCard key={`${d.date}-${d.npi}`} d={d} n={n} unit={unit} pct={pct} normal={normal} times={times} />
                })}
              </div>
              {reveal('billed')}
            </>
          )}
        </>
      )
    }

    // ── cross-NPI: the physicians this vendor bills under ──
    if (rule === 'cross_npi_supplier') {
      return (
        <>
          <SectionLabel>Physicians this vendor bills under ({data.distinctNpis})</SectionLabel>
          <div className="space-y-2 mt-2">
            {breakdown.map((n) => (
              <PhysicianCard key={n.npi} physician={n.physician} npi={n.npi} onOpenNpi={onOpenNpi}
                             badge={n.oigExcluded ? <ExPill /> : null}
                             sub={`NPI ${n.npi} · ${n.claimCount} claim${n.claimCount !== 1 ? 's' : ''} · ${fmtUSD(n.claimAmount)} total`} />
            ))}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── vendor concentration: physicians who bill almost exclusively via this vendor ──
    if (rule === 'supplier_concentration') {
      const seen = new Set(); const rows = []
      claims.forEach((c) => { if (!seen.has(c.npi)) { seen.add(c.npi); rows.push({ ...c, ...concOf(c.why) }) } })
      rows.sort((a, b) => (b.pct || 0) - (a.pct || 0))
      return (
        <>
          <SectionLabel>Physicians who bill almost exclusively through this vendor ({rows.length})</SectionLabel>
          <div className="space-y-2 mt-2">
            {rows.map((r) => (
              <button key={r.npi} type="button" onClick={() => onOpenNpi?.(r.npi, r.physician)}
                      className="group w-full text-left px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-[#EBD3D1] hover:-translate-y-px hover:shadow-sm transition-all duration-150">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-semibold text-slate-800 truncate group-hover:text-[var(--color-primary)]">{r.physician}</span>
                  {r.pct != null && <span className="text-[13px] font-bold text-[#8A423D] shrink-0">{r.pct}%</span>}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">NPI {r.npi}{r.dom != null ? ` · ${r.dom} of ${r.tot} claims via this vendor` : ''}</div>
                {r.pct != null && (
                  <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden mt-2">
                    <div className="h-full rounded-full bg-[#A6453F]" style={{ width: `${r.pct}%` }} />
                  </div>
                )}
              </button>
            ))}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── unbundling: one service split into many codes (per patient/date/physician) ──
    if (rule === 'unbundling') {
      const groups = groupUnbundling(claims)
      return (
        <>
          <SectionLabel>Unbundled claim groups ({groups.length})</SectionLabel>
          <div className="space-y-2 mt-2">
            {groups.slice(0, 6).map((g) => (
              <div key={g.key} className="rounded-xl border border-slate-100 bg-slate-50 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800 truncate">{g.patient}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{fmtDate(g.date)} · {g.physician}</div>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-md shrink-0">{g.claims.length} codes</span>
                </div>
                <div className="px-4 py-2 space-y-1">
                  {g.claims.slice(0, 5).map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="text-slate-600 truncate">{c.description || c.category}</span>
                      <span className="font-semibold text-slate-700 tabular-nums shrink-0">{fmtUSD(c.amount, 2)}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Total billed</span>
                  <span className="text-[13px] font-bold text-slate-800 tabular-nums">{fmtUSD(sumAmt(g.claims), 2)}</span>
                </div>
              </div>
            ))}
            {groups.length > 6 && <p className="text-[11px] text-slate-400 text-center">+ {groups.length - 6} more groups</p>}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── duplicate billing: same service billed twice within 30 days ──
    if (rule === 'duplicate_billing') {
      const pairs = duplicatePairs(claims)
      return (
        <>
          <SectionLabel>Duplicate claim pairs ({pairs.length})</SectionLabel>
          <div className="space-y-2 mt-2">
            {pairs.slice(0, 6).map((p, i) => (
              <div key={i} className="rounded-xl px-4 py-3" style={RED_CARD}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-800 truncate">{p.patient}</span>
                  <span className="text-[11px] font-semibold text-[#8A423D] shrink-0">{p.days} day{p.days !== 1 ? 's' : ''} apart</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{p.physician} · NPI {p.npi}</div>
                <div className="mt-1.5 text-[12.5px] text-slate-600">1 · {fmtDate(p.c1.date)} · {p.c1.description || p.c1.category} · {fmtUSD(p.c1.amount, 2)}</div>
                <div className="text-[12.5px] text-slate-600">2 · {fmtDate(p.c2.date)} · {p.c2.description || p.c2.category} · {fmtUSD(p.c2.amount, 2)}</div>
              </div>
            ))}
            {pairs.length > 6 && <p className="text-[11px] text-slate-400 text-center">+ {pairs.length - 6} more pairs</p>}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── upcoding: claims far above the category median ──
    if (rule === 'upcoding') {
      const sorted = [...claims].sort((a, b) => (b.amount || 0) - (a.amount || 0))
      return (
        <>
          <SectionLabel>Claims billed far above the category norm ({claims.length})</SectionLabel>
          <div className="space-y-2 mt-2">
            {sorted.slice(0, 8).map((c) => {
              const mult = upMultOf(c.why)
              return (
                <div key={c.id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800 truncate">{c.patient}</span>
                    <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">{fmtUSD(c.amount, 2)}</span>
                  </div>
                  <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">
                    {c.category}{mult ? <span className="text-[#8A6A34] font-semibold"> · {mult}× the median</span> : ''} · {c.physician}
                  </div>
                </div>
              )
            })}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── deceased patient: patients resurfacing after a long gap ──
    if (rule === 'deceased_patient') {
      const seen = new Set(); const uniq = []
      for (const c of [...claims].sort((a, b) => (deceasedOf(b.why).gap || 0) - (deceasedOf(a.why).gap || 0))) {
        if (!seen.has(c.patient)) { seen.add(c.patient); uniq.push(c) }
      }
      return (
        <>
          <SectionLabel>Patients billed after a long inactivity gap ({uniq.length})</SectionLabel>
          <div className="space-y-2 mt-2">
            {uniq.slice(0, 8).map((c) => { const x = deceasedOf(c.why); return (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-800 truncate">{c.patient}</span>
                  {x.gap != null && <span className="text-[11px] font-bold text-[#8A423D] shrink-0">{x.gap}-day gap</span>}
                </div>
                <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">
                  Last seen {x.last ? fmtDate(x.last) : '—'} · this claim {fmtDate(c.date)} · {c.physician}
                </div>
              </div>
            ) })}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── modifier abuse: near-identical services billed separately ──
    if (rule === 'modifier_abuse') {
      const pairs = modifierPairs(claims)
      return (
        <>
          <SectionLabel>Near-identical service pairs ({pairs.length})</SectionLabel>
          <div className="space-y-2 mt-2">
            {pairs.slice(0, 6).map(([a, b], i) => (
              <div key={i} className="rounded-xl px-4 py-3" style={RED_CARD}>
                <div className="text-sm font-semibold text-slate-800 truncate">{a.patient} <span className="font-normal text-slate-500">· {fmtDate(a.date)}</span></div>
                <div className="text-[11px] text-slate-500 mt-0.5">{a.physician}</div>
                <div className="mt-1.5 text-[12.5px] text-slate-600 truncate">{a.description || a.category} · {fmtUSD(a.amount, 2)}</div>
                <div className="text-[12.5px] text-slate-600 truncate">{b.description || b.category} · {fmtUSD(b.amount, 2)}</div>
              </div>
            ))}
            {pairs.length > 6 && <p className="text-[11px] text-slate-400 text-center">+ {pairs.length - 6} more pairs</p>}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── geographic anomaly: patients far from the physician's practice ──
    if (rule === 'geographic_anomaly') {
      const sorted = [...claims].filter((c) => milesOf(c.why) >= 0).sort((a, b) => milesOf(b.why) - milesOf(a.why))
      const list = sorted.length ? sorted : claims
      return (
        <>
          <VendorGeoMap claims={list} />
          <div className="flex items-center gap-3 mt-2 mb-2 text-[10px] text-slate-400">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#A6453F]" /> physician practice</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#3B7DB3]" /> patient location</span>
          </div>
          <SectionLabel>Patients billed far from the physician's practice ({list.length})</SectionLabel>
          <div className="space-y-2 mt-2">
            {list.slice(0, 8).map((c) => { const mi = milesOf(c.why); return (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-800 truncate">{c.patient}</span>
                  {mi >= 0 && <span className="text-[11px] font-bold text-[#35607D] tabular-nums shrink-0">{mi.toLocaleString()} mi away</span>}
                </div>
                <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">{fmtDate(c.date)} · {c.category} · {c.physician}</div>
              </div>
            ) })}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── new high-value vendor: earliest high-dollar claims from this vendor ──
    if (rule === 'new_high_value_supplier') {
      const sorted = [...claims].sort((a, b) => new Date(a.date) - new Date(b.date))
      return (
        <>
          <SectionLabel>Earliest high-value claims from this new vendor ({claims.length})</SectionLabel>
          <div className="space-y-2 mt-2">
            {sorted.slice(0, 8).map((c) => <ClaimCard key={c.id} c={c} />)}
          </div>
          {reveal('flagged')}
        </>
      )
    }

    // ── default (ghost_billing, identity_reuse, hospice, volume_spike, …) ──
    return (
      <>
        {breakdown.length > 0 && (
          <>
            <SectionLabel>Physicians billed by this vendor ({data.distinctNpis})</SectionLabel>
            <div className="space-y-1 mt-2">
              {breakdown.slice(0, 6).map((n) => (
                <div key={n.npi} className="flex items-center justify-between gap-3 text-[12px] rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                  <span className="text-slate-700 font-medium truncate flex items-center gap-2">
                    {n.physician} <span className="text-slate-400 font-normal">· NPI {n.npi}</span>{n.oigExcluded ? <ExPill /> : null}
                  </span>
                  <span className="tabular-nums text-slate-500 shrink-0">{n.claimCount} claim{n.claimCount !== 1 ? 's' : ''}</span>
                </div>
              ))}
              {breakdown.length > 6 && <p className="text-[11px] text-slate-400">+ {breakdown.length - 6} more</p>}
            </div>
          </>
        )}
        <div className="mt-4"><SectionLabel>Claims that triggered this ({data.count})</SectionLabel></div>
        <div className="space-y-2 mt-2">
          {claims.length === 0 ? <Empty>No claim-level evidence available.</Empty> : claims.map((c) => <ClaimCard key={c.id} c={c} />)}
          {data.capped && <p className="text-[11px] text-slate-400 text-center pt-1">showing {data.shown} of {data.count}</p>}
        </div>
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
         style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
         onClick={onClose}>
      <div className="bg-white w-full sm:rounded-2xl sm:max-w-[560px] rounded-t-2xl flex flex-col max-h-[90vh] sm:max-h-[85vh]"
           style={{ boxShadow: '0 24px 64px -12px rgba(15,23,42,0.22)' }}
           onClick={(e) => e.stopPropagation()}>

        {/* ── Fixed header ── */}
        <div className="shrink-0 px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: sev.badgeBg, color: sev.badgeTx }}>
                <Icon name="alertTri" size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-slate-900 leading-tight">{label || data?.label}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Why this fired · {data ? `${data.count} claim${data.count !== 1 ? 's' : ''} on this vendor` : 'loading…'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide" style={{ background: sev.badgeBg, color: sev.badgeTx }}>{sev.label}</span>
              <button onClick={onClose} aria-label="Close"
                      className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-all duration-150">
                <Icon name="x" size={14} stroke={2.5} />
              </button>
            </div>
          </div>
        </div>

        {error && <div className="px-4 sm:px-5 py-4 text-sm text-[#A6453F]">{error}</div>}
        {!data && !error && <div className="px-4 sm:px-5 py-4"><div className="h-24 rounded-xl bg-slate-100 animate-pulse" /></div>}

        {data && !error && (
          <>
            {/* What this pattern means (fixed) */}
            <div className="shrink-0 px-4 sm:px-5 pt-4">
              <p className="text-[13px] text-slate-600 leading-relaxed bg-slate-50 rounded-lg px-3.5 py-3 border border-slate-100">
                {data.explanation}
              </p>
            </div>

            {mode === 'oig' ? (
              <>
                {/* OIG — vendor's own LEIE status + only the physicians also excluded */}
                <div className="shrink-0 px-4 sm:px-5 pt-3">
                  {data.vendorOigExcluded && (
                    <div className="mb-3 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[#F7EBEA] border border-[#EBD3D1]">
                      <span className="w-6 h-6 rounded-lg bg-[#A6453F] text-white flex items-center justify-center shrink-0 mt-0.5"><Icon name="shieldAlert" size={13} /></span>
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#A6453F]">Vendor is on the OIG exclusion list</div>
                        <div className="text-[13px] font-semibold text-[#8A423D] truncate mt-0.5">{data.vendorName}</div>
                        <div className="text-[11px] text-[#A6453F] tabular-nums">NPI {supplierId}{data.vendorExclusionType ? ` · ${data.vendorExclusionType}` : ''}</div>
                      </div>
                    </div>
                  )}
                  <SectionLabel>Physicians this vendor deals with who are also on the OIG list ({excludedPhysicians.length})</SectionLabel>
                </div>
                <div className="overflow-y-auto px-4 sm:px-5 pb-4 sm:pb-5 pt-2" style={{ maxHeight: '360px' }}>
                  {excludedPhysicians.length === 0 ? (
                    <Empty>None of the physicians billing this vendor are individually on the OIG exclusion list.</Empty>
                  ) : (
                    <div className="space-y-2">
                      {excludedPhysicians.map((n) => (
                        <PhysicianCard key={n.npi} physician={n.physician} npi={n.npi} onOpenNpi={onOpenNpi} badge={<ExPill />}
                                       sub={`${n.claimCount} claim${n.claimCount !== 1 ? 's' : ''} · ${fmtUSD(n.claimAmount)} total`} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="overflow-y-auto px-4 sm:px-5 pb-4 sm:pb-5 pt-3" style={{ maxHeight: '440px' }}>
                {renderBody()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
