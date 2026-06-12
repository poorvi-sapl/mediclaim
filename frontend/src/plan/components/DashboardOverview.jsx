import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Label, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { API_BASE } from '../../api'

const bandColor = (band) => {
  if (band === 'high') return '#ef4444'
  if (band === 'mid') return '#f59e0b'
  return '#10b981'
}
const PIE_COLORS = ['#ef4444', '#3b82f6', '#1B3A5C', '#f59e0b']

const RULE_ABBR = {
  'Cross-NPI Supplier': 'CNS', 'OIG LEIE Hit': 'OLH', 'Volume Spike': 'VS',
  'Impossible Day': 'ID', 'Rapid Cycling': 'RC', 'Modifier Abuse': 'MA',
  'Unbundling': 'UB', 'New High-Value Supplier': 'NHVS', 'Geographic Anomaly': 'GA',
  'Upcoding': 'UC', 'Deceased Patient': 'DP', 'Duplicate Billing': 'DB',
}

function PillTick({ x, y, payload }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-22} y={5} width={44} height={17} rx={8.5} fill="#EEF2F7" />
      <text x={0} y={14} textAnchor="middle" dominantBaseline="middle"
        fontSize={8} fontWeight={700} fill="#1B3A5C">
        {payload.value}
      </text>
    </g>
  )
}

function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 ${className}`}>
      <div className="mb-4">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-2/5 mb-1" />
      <div className="h-3 bg-gray-100 rounded w-1/3 mb-5" />
      <div className="h-56 bg-gray-100 rounded-xl" />
    </div>
  )
}

export default function DashboardOverview() {
  const [risk, setRisk] = useState(null)
  const [npis, setNpis] = useState(null)
  const [trend, setTrend] = useState(null)
  const [rules, setRules] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_BASE}/analytics/overview/risk-distribution`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API_BASE}/analytics/overview/top-npis`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API_BASE}/analytics/overview/claims-trend`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API_BASE}/analytics/overview/rule-breakdown`, { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([riskData, npiData, trendData, rulesData]) => {
        if (!cancelled) {
          setRisk(riskData)
          setNpis(npiData)
          setTrend(trendData)
          setRules(rulesData)
          setLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Dashboard Overview</h2>
        <p className="text-xs text-gray-400 mb-5">Live snapshot of your claims portfolio</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      </section>
    )
  }

  const total = (risk?.high || 0) + (risk?.mid || 0) + (risk?.low || 0)
  const riskPie = [
    { name: 'High Risk', value: risk?.high || 0 },
    { name: 'Mid Risk', value: risk?.mid || 0 },
    { name: 'Low Risk', value: risk?.low || 0 },
  ]

  // Reverse so highest-risk NPI appears at the top of the horizontal bar chart
  const npiData = (npis?.npis || []).slice().reverse().map(n => ({
    name: n.name.length > 20 ? n.name.slice(0, 19) + '…' : n.name,
    fullName: n.name,
    score: n.risk_score,
    claims: n.total_claims,
    band: n.risk_band,
  }))

  const trendData = (trend?.months || []).map((m, i) => ({
    month: m,
    total: trend.total?.[i] || 0,
    flagged: trend.flagged?.[i] || 0,
  }))

  const ruleData = (rules?.rules || []).map(r => ({
    ...r,
    abbr: RULE_ABBR[r.label] || r.label.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4),
  }))

  return (
    <section className="mb-8">
      <div className="flex flex-col gap-5">
      <div className="grid grid-cols-5 gap-5">

        {/* Chart 1 — Fraud Rule Breakdown (vertical bar) — 60% */}
        <ChartCard title="Fraud Rule Firing Frequency" subtitle="Hover a bar for full rule name" className="col-span-3">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ruleData} margin={{ top: 5, right: 16, left: 0, bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="abbr"
                tick={<PillTick />}
                axisLine={false}
                tickLine={false}
                height={32}
                interval={0}
              />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} domain={[0, 'auto']} />
              <Tooltip
                labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ''}
                formatter={(value) => [value, 'Flags']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={28}>
                {ruleData.map((entry, i) => {
                  const maxCount = ruleData[0]?.count || 1
                  return <Cell key={i} fill="#1B3A5C" fillOpacity={Math.max(0.12, entry.count / maxCount)} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Chart 2 — Top 10 NPIs by Risk Score (list) — 40% */}
        <ChartCard title="Top 10 NPIs by Risk Score" subtitle="Ranked by risk score · color = risk band" className="col-span-2">
          <div className="space-y-0.5 max-h-[260px] overflow-y-auto">
            {npiData.map((n, i) => {
              const bs = n.band === 'high'
                ? { badge: 'bg-red-50 text-red-600 ring-red-200/60',           label: 'High Risk' }
                : n.band === 'mid'
                ? { badge: 'bg-amber-50 text-amber-700 ring-amber-200/60',     label: 'Mid Risk'  }
                : { badge: 'bg-[#EEF2F7] text-[#1B3A5C] ring-[#1B3A5C]/10',  label: 'Low Risk'  }
              return (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-gray-900 truncate">{n.fullName}</p>
                    <p className="text-[10px] text-gray-400">{n.claims} claims</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ring-1 flex-shrink-0 whitespace-nowrap ${bs.badge}`}>
                    Score {n.score}
                  </span>
                </div>
              )
            })}
          </div>
        </ChartCard>

      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Chart 3 — Claims Trend (dual line) */}
        <ChartCard title="Claims Trend — Last 6 Months" subtitle="Total vs Fraud Rules Hit">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendData} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={38} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              <Line type="monotone" dataKey="total" name="Total Claims" stroke="#0d1f35" strokeWidth={2}
                dot={{ r: 3, fill: '#0d1f35', strokeWidth: 0 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="flagged" name="Fraud Rules Hit" stroke="#ef4444" strokeWidth={2}
                strokeDasharray="5 4" dot={{ r: 3, fill: '#ef4444', strokeWidth: 0 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Chart 4 — NPI Risk Distribution (donut) */}
        <ChartCard title="NPI Risk Distribution" subtitle={`${total} total NPIs monitored`}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={riskPie}
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={105}
                dataKey="value"
                paddingAngle={2}
              >
                {riskPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox) return null
                    const { cx, cy } = viewBox
                    return (
                      <g>
                        <text x={cx} y={cy - 7} textAnchor="middle" dominantBaseline="middle"
                          style={{ fontSize: 24, fontWeight: 700, fill: '#111827' }}>{total}</text>
                        <text x={cx} y={cy + 13} textAnchor="middle" dominantBaseline="middle"
                          style={{ fontSize: 11, fill: '#6b7280' }}>NPIs</text>
                      </g>
                    )
                  }}
                />
              </Pie>
              <Tooltip formatter={(v, name) => [v, name]} />
              <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

      </div>
      </div>
    </section>
  )
}
