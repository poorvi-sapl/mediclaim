import { useState, useEffect, useRef, Fragment } from 'react'
import { useJsApiLoader, GoogleMap, MarkerF, PolylineF } from '@react-google-maps/api'
import { getRuleEvidence, getSuppliers, getSupplierPhysicians } from '../../api'
import { Icon, fmtUSD, fmtDate } from '../../components/ui'
import EvidencePanel, { volumeStats } from './EvidencePanel'

// Embedded Google Map for the geographic_anomaly modal: physician (red) at center with a
// polyline arrow out to each distant patient (blue → yellow when focused). Only mounted
// for that rule, so the Google Maps script never loads for any other modal.
const RED_PIN = 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
const BLUE_PIN = 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
const YELLOW_PIN = 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png'

function GeoMap({ center, physicianLabel, patients, onMapLoad, focusedName }) {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  })
  const localMap = useRef(null)
  const [mapType, setMapType] = useState('satellite')
  if (!isLoaded) {
    return <div className="h-full w-full bg-slate-100 animate-pulse" />
  }
  const switchType = (id) => { setMapType(id); localMap.current?.setMapTypeId(id) }
  return (
    <div className="relative w-full h-full">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 bg-white rounded-xl shadow-md ring-1 ring-black/5 p-1">
        {[['roadmap', 'Map'], ['satellite', 'Satellite']].map(([id, lbl]) => (
          <button key={id} type="button" onClick={() => switchType(id)}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${mapType === id ? 'bg-[#1E3A5F] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
            {lbl}
          </button>
        ))}
      </div>
      <GoogleMap mapContainerStyle={{ height: '100%', width: '100%' }}
                 center={{ lat: Number(center.lat), lng: Number(center.lng) }} zoom={4}
                 mapTypeId="satellite"
                 options={{ mapTypeControl: false }}
                 onLoad={(map) => { localMap.current = map; onMapLoad?.(map) }}>
        <MarkerF position={{ lat: Number(center.lat), lng: Number(center.lng) }} title={physicianLabel} icon={RED_PIN} />
        {patients.map((p, i) => (
          <Fragment key={i}>
            <MarkerF position={{ lat: Number(p.lat), lng: Number(p.lng) }} title={`${p.name}${p.miles >= 0 ? ` · ${p.miles.toLocaleString()} miles` : ''}`} icon={focusedName === p.name ? YELLOW_PIN : BLUE_PIN} />
            <PolylineF path={[{ lat: Number(center.lat), lng: Number(center.lng) }, { lat: Number(p.lat), lng: Number(p.lng) }]}
                       options={{ strokeColor: '#F87171', strokeWeight: 2, strokeOpacity: 0.75, geodesic: true }} />
          </Fragment>
        ))}
      </GoogleMap>
    </div>
  )
}

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
const SUMMARY = 'text-[12px] text-slate-400 text-center mt-4 leading-relaxed'
const VIEWALL = 'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 shadow-sm transition-all duration-150 hover:border-[#1E3A5F]/25 hover:bg-[#EEF2FF] hover:text-[#1E3A5F]'
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
  const [focusedPatient, setFocusedPatient] = useState(null)  // patient NAME the geo map is flown to
  const mapRef = useRef(null)                                 // GoogleMap instance for panTo/setZoom

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

  // geographic_anomaly map data — physician center + distant patients with valid coords
  const isGeo = rule === 'geographic_anomaly'
  const geoPatients = isGeo
    ? claims
        .filter((c) => c.patientLat != null && c.patientLng != null)
        .map((c) => ({ lat: c.patientLat, lng: c.patientLng, name: c.patient, miles: milesOf(c.why) }))
    : []
  const practiceCoords = (() => {
    if (!isGeo) return null
    const c = claims.find((x) => x.practiceLat != null && x.practiceLng != null)
    return c ? { lat: c.practiceLat, lng: c.practiceLng } : null
  })()
  const showMap = isGeo && !!practiceCoords && geoPatients.length > 0

  function renderContent() {
    // OIG — excluded suppliers grouped
    if (rule === 'oig_leie_hit') {
      const groups = groupBySupplier(claims)
      return (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">OIG Excluded Suppliers</span>
            <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md tabular-nums">
              {groups.length} supplier{groups.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {groups.map((g) => (
              <button key={g.supplier} type="button" onClick={() => onOpenSupplier?.(g.supplier)}
                      className="group w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-100 hover:bg-rose-50/40 hover:border-rose-200/70 hover:-translate-y-px hover:shadow-sm transition-all duration-150">
                <div className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-slate-800 truncate group-hover:text-[#1E3A5F]">{g.supplier}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">{g.count} claim{g.count !== 1 ? 's' : ''} · {fmtUSD(g.total)} total</div>
                </div>
                <Icon name="chevronRight" size={13} stroke={2.2}
                      className="text-slate-300 group-hover:text-[#1E3A5F] group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
              </button>
            ))}
          </div>
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

    // UNBUNDLING — grouped cards (max 3) + view-all button
    if (rule === 'unbundling') {
      const groups = groupUnbundling(claims)
      return (
        <div className="mt-4">
          {groups.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unbundled Claim Groups</span>
                <span className="text-[11px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md tabular-nums">
                  {groups.length} instance{groups.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-2">
                {groups.slice(0, 3).map((g) => (
                  <div key={g.key} className="rounded-xl border border-slate-100 bg-slate-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-slate-800 truncate">{g.patient}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{fmtDate(g.date)}</div>
                      </div>
                      <button type="button" onClick={() => onOpenSupplier?.(g.supplier)}
                              className="text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg hover:bg-slate-100 truncate max-w-[148px] shrink-0 transition-colors">
                        {g.supplier}
                      </button>
                    </div>
                    <div className="px-4 py-2.5 space-y-1.5">
                      {g.claims.map((c) => (
                        <button key={c.id} type="button" onClick={() => onHighlightClaim?.(c.id)}
                                className="group w-full flex items-center justify-between gap-3 text-left">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-300 shrink-0" />
                            <span className="text-[12px] text-slate-600 group-hover:text-slate-900 truncate">{c.description || c.category}</span>
                          </div>
                          <span className="text-[12px] font-semibold text-slate-700 tabular-nums shrink-0">{fmtUSD(c.amount, 2)}</span>
                        </button>
                      ))}
                    </div>
                    <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-400">Total billed</span>
                      <span className="text-[13px] font-bold text-slate-800 tabular-nums">{fmtUSD(sumAmt(g.claims), 2)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {groups.length > 3 && (
                <div className="text-[11px] text-slate-400 text-center mt-2">+ {groups.length - 3} more groups</div>
              )}
            </>
          )}
          <div className="text-center mt-4">
            <button type="button" onClick={() => onViewClaims?.({ flag: 'UNBUNDLING', label: 'Unbundling' })} className={VIEWALL}>
              View all unbundled claims →
            </button>
          </div>
        </div>
      )
    }

    // GEOGRAPHIC ANOMALY — practice line + max 4 patient rows
    if (rule === 'geographic_anomaly') {
      const sorted = [...claims].sort((a, b) => milesOf(b.why) - milesOf(a.why))
      const furthest = milesOf(sorted[0]?.why)
      return (
        <div className="mt-4">
          <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 mb-3">
            <span className="w-7 h-7 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center flex-shrink-0"><Icon name="shield" size={15} /></span>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Practice Location</div>
              <div className="text-sm font-semibold text-slate-800 truncate">{practice?.city || '—'}, {practice?.state || '—'}</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Distant Patients</span>
            {furthest >= 0 && <span className="text-[11px] font-semibold text-amber-600 tabular-nums">furthest {furthest.toLocaleString()} mi</span>}
          </div>
          <div className="space-y-2">
            {sorted.slice(0, 4).map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 transition-all duration-150 hover:border-[#1E3A5F]/30 hover:bg-slate-50/70 hover:shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setFocusedPatient(c.patient)
                      if (mapRef.current && c.patientLat != null && c.patientLng != null) {
                        mapRef.current.panTo({ lat: Number(c.patientLat), lng: Number(c.patientLng) })
                        mapRef.current.setZoom(7)
                      }
                    }}
                    className="text-sm font-semibold text-slate-800 truncate hover:text-[#1E3A5F] hover:underline transition-colors cursor-pointer"
                  >{c.patient}</button>
                  <span className="text-sm font-bold text-slate-900 tabular-nums flex-shrink-0">{fmtUSD(c.amount, 2)}</span>
                </div>
                {milesOf(c.why) >= 0 && (
                  <div className="mt-1.5">
                    <span className="inline-flex items-center text-[11px] font-semibold text-blue-700 tabular-nums">{milesOf(c.why).toLocaleString()} mi from practice</span>
                  </div>
                )}
                <div className="relative group/sup mt-1 max-w-full">
                  <button type="button" onClick={() => onOpenSupplier?.(c.supplier)}
                          className="block max-w-full truncate text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer">{c.supplier}</button>
                  {/* hover popup — shows the full (untruncated) supplier name + a click hint */}
                  <div className="pointer-events-none absolute left-0 bottom-full mb-2 z-30 w-max max-w-[260px] rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-snug text-white shadow-xl opacity-0 translate-y-1 transition-all duration-150 group-hover/sup:opacity-100 group-hover/sup:translate-y-0">
                    <div className="font-semibold">{c.supplier}</div>
                    <div className="mt-0.5 text-slate-300">Billing supplier · click to open the supplier case →</div>
                    <span className="absolute left-4 top-full h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-slate-900" aria-hidden />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-4"><button type="button" onClick={() => onViewClaims?.({ flag: 'GEO_ANOMALY', label: 'Geographic anomaly' })} className={VIEWALL}>View all distant patients →</button></div>
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
      const maxN = days[0]?.[1] || 1
      const NORMAL = 12
      return (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Impossible Days</span>
            <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md tabular-nums">
              {days.length} day{days.length !== 1 ? 's' : ''} detected
            </span>
          </div>
          <div className="space-y-2">
            {days.slice(0, 5).map(([d, n]) => {
              const pct = Math.round((n / maxN) * 100)
              return (
                <div key={d} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[13px] font-semibold text-slate-800">{fmtDate(d)}</span>
                    <span className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md tabular-nums">
                      {n} claims
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-rose-400 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] text-slate-400">normal ~{NORMAL}/day</span>
                    <span className="text-[10px] font-semibold text-rose-500">{Math.round(n / NORMAL)}× above normal</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="text-center mt-4">
            <button type="button" onClick={() => onViewClaims?.({ flag: 'IMPOSSIBLE_DAY', label: 'Impossible day' })} className={VIEWALL}>
              View all flagged claims →
            </button>
          </div>
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
      const maxPts = days[0]?.[1].pts.size || 1
      return (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">High-Turnover Days</span>
            <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md tabular-nums">
              {days.length} day{days.length !== 1 ? 's' : ''} flagged
            </span>
          </div>
          <div className="space-y-2">
            {days.slice(0, 5).map(([d, e]) => {
              const pct = Math.round((e.pts.size / maxPts) * 100)
              return (
                <div key={d} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[13px] font-semibold text-slate-800">{fmtDate(d)}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-400 tabular-nums">{e.n} claims</span>
                      <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md tabular-nums">
                        {e.pts.size} patients
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="text-center mt-4">
            <button type="button" onClick={() => onViewClaims?.({ flag: 'RAPID_CYCLING', label: 'Rapid cycling' })} className={VIEWALL}>
              View all flagged claims →
            </button>
          </div>
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

  const body = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-500 ring-1 ring-rose-100 flex items-center justify-center shrink-0">
            <Icon name="alertTri" size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-slate-900 leading-tight">{label}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Why this fired · NPI {npi}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close"
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-all duration-150">
          <Icon name="x" size={14} stroke={2.5} />
        </button>
      </div>

      {error && <div className="mt-4 text-sm text-rose-600">{error}</div>}
      {!ready && !error && <div className="mt-4 h-24 rounded-xl bg-slate-100 animate-pulse" />}

      {ready && (
        <div key={rule} className="animate-fade-in-up mt-4">
          <p className="text-[13px] text-slate-600 leading-relaxed bg-slate-50 rounded-lg px-3.5 py-3 border border-slate-100">{why}</p>
          {renderContent()}
        </div>
      )}
    </>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
         style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
         onClick={onClose}>
      {showMap ? (
        <div className="bg-white rounded-2xl w-full max-w-[1360px] overflow-hidden flex"
             style={{ height: '86vh', boxShadow: '0 32px 80px -12px rgba(15,23,42,0.30), 0 0 0 1px rgba(15,23,42,0.06)' }}
             onClick={(e) => e.stopPropagation()}>
          <div className="w-[320px] shrink-0 overflow-y-auto p-5 border-r border-slate-100">{body}</div>
          <div className="flex-1 h-full overflow-hidden">
            <GeoMap
              center={practiceCoords}
              physicianLabel={`${evidence?.physicianName || 'Physician'}${practice?.city ? ` · ${practice.city}` : ''}`}
              patients={geoPatients}
              onMapLoad={(map) => { mapRef.current = map }}
              focusedName={focusedPatient}
            />
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl w-full max-w-[480px] max-h-[80vh] overflow-y-auto p-5"
             style={{ boxShadow: '0 24px 64px -12px rgba(15,23,42,0.22)' }}
             onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      )}
    </div>
  )
}
