// The frontend's single risk classification. Mirrors backend/schemas.py
// (CRITICAL_MIN / HIGH_MIN / MEDIUM_MIN and RISK_BAND_BOUNDS) — change both together.
//
//   critical 81-100    high 61-80    medium 31-60    low 0-30
//
// Every pill, badge, ring, chart segment, filter and sort reads from here. Before
// this existed the product classified the same score seven different ways (cuts at
// 80/65/60, a rival 3-band high/mid/low scheme, and a 'Clean' label covering
// everything under 65), so two screens could disagree about one physician.

export const RISK_BANDS = [
  {
    id: 'critical', label: 'Critical', min: 81, max: 100, rank: 4,
    color: '#A6453F', soft: '#F7EBEA', text: '#8A423D', pill: 'pill-solid-critical',
    badge: { background: 'linear-gradient(180deg,#B95951,#9A3F39)', color: '#fff', border: '1px solid #8A3B35' },
  },
  {
    id: 'high', label: 'High', min: 61, max: 80, rank: 3,
    color: '#D1A85C', soft: '#FBF3E4', text: '#8A6A34', pill: 'pill-high',
    badge: { background: 'linear-gradient(180deg,#FDF6E9,#FBF3E4)', color: '#8A6A34', border: '1px solid #F0E0BE' },
  },
  {
    id: 'medium', label: 'Medium', min: 31, max: 60, rank: 2,
    color: '#5A9BC9', soft: '#EAF2F8', text: '#35607D', pill: 'pill-medium',
    badge: { background: 'linear-gradient(180deg,#F2F8FC,#EAF2F8)', color: '#35607D', border: '1px solid #CFE2EF' },
  },
  {
    id: 'low', label: 'Low', min: 0, max: 30, rank: 1,
    color: '#3A7D5C', soft: '#E9F3ED', text: '#2E6B4F', pill: 'pill-low',
    badge: { background: 'linear-gradient(180deg,#EEF6F1,#E9F3ED)', color: '#2E6B4F', border: '1px solid #D5E9DD' },
  },
]

const BY_KEY = RISK_BANDS.reduce((acc, b) => {
  acc[b.id] = b
  acc[b.label.toLowerCase()] = b
  return acc
}, {})

// score -> band object. The frontend twin of get_risk_band() in schemas.py.
// RISK_BANDS is ordered high-to-low, so the first band whose floor the score
// clears is the right one.
export function riskBand(score) {
  const s = Number(score) || 0
  return RISK_BANDS.find((b) => s >= b.min) || BY_KEY.low
}

export const riskLabel = (score) => riskBand(score).label
export const riskColor = (score) => riskBand(score).color

// Look a band up by id ('critical') or label ('Critical') — for rows that carry
// a band string from the API instead of a score.
export const bandByName = (name) => BY_KEY[String(name ?? '').toLowerCase()] || BY_KEY.low
export const bandRank = (name) => bandByName(name).rank

// Dropdown options for the risk column filters. `all` first, then worst to best.
export const RISK_FILTER_OPTIONS = [
  { id: '', label: 'All' },
  ...RISK_BANDS.map((b) => ({ id: b.label, label: b.label })),
]
