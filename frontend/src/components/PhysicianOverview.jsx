import { useEffect, useState } from 'react'
import {
  Area, AreaChart,
  CartesianGrid, Cell,
  Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { API_BASE } from '../api'

const PIE_COLORS = ['#1B3A5C', '#ef4444', '#3b82f6']

const SUPPLIER_COLORS = {
  '1941 BELSAY ROAD OPERATING COMPANY, LLC': { fill: '#f97316', text: '#f97316' },
  'ACCURATE HEALTHCARE SERVICES, INC.':      { fill: '#f97316', text: '#f97316' },
  'ACCURATE HOSPICE':                        { fill: '#f97316', text: '#f97316' },
  'PlantDup-A 094':                          { fill: '#f97316', text: '#111827' },
  'PlantDup-B 094':                          { fill: '#a855f7', text: '#111827' },
}
const supplierFill = (name, idx) => SUPPLIER_COLORS[name]?.fill ?? PIE_COLORS[idx % PIE_COLORS.length]

function SupplierLegendList({ pieData }) {
  return (
    <ul className="w-full mt-3 space-y-1.5 px-0.5">
      {pieData.map((entry, i) => {
        const custom = SUPPLIER_COLORS[entry.name]
        return (
          <li key={i} className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: supplierFill(entry.name, i) }} />
            <span className="text-[11px] leading-tight truncate"
                  title={entry.name}
                  style={{ color: custom?.text ?? '#374151', fontWeight: custom ? 600 : 400 }}>
              {entry.name}
            </span>
            <span className="ml-auto text-[10px] text-gray-400 tabular-nums flex-shrink-0 pl-1">
              {entry.value}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function VennChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height: 260 }}>
        <span className="text-sm text-gray-400">No data</span>
      </div>
    )
  }
  const items = data.slice(0, 4)
  const total = data.reduce((s, d) => s + d.count, 0)
  const COLORS = ['#1B3A5C', '#ef4444', '#f59e0b', '#3b82f6']
  const R = 68, OFF = 50
  const circles = [
    { cx: 0,    cy: -OFF },
    { cx: OFF,  cy: 0    },
    { cx: 0,    cy: OFF  },
    { cx: -OFF, cy: 0    },
  ]
  const lbls = [
    { x: 0,    y: -150, anchor: 'middle' },
    { x: 130,  y: 0,    anchor: 'start'  },
    { x: 0,    y: 144,  anchor: 'middle' },
    { x: -130, y: 0,    anchor: 'end'    },
  ]
  return (
    <svg width="100%" height="290" viewBox="-200 -172 400 348" style={{ display: 'block' }}>
      {items.map((item, i) => (
        <circle key={item.category} cx={circles[i].cx} cy={circles[i].cy} r={R}
          fill={COLORS[i]} fillOpacity={0.75} style={{ mixBlendMode: 'multiply' }} />
      ))}
      {items.map((item, i) => {
        const pct = total > 0 ? Math.round(item.count / total * 100) : 0
        const { x, y, anchor } = lbls[i]
        return (
          <g key={`l${i}`}>
            <text x={x} y={y - 8}  textAnchor={anchor} fontSize={9}  fontWeight={800} letterSpacing="0.08em" fill="#374151">
              {item.label.toUpperCase()}
            </text>
            <text x={x} y={y + 7}  textAnchor={anchor} fontSize={15} fontWeight={700} fill="#111827">
              {item.count.toLocaleString()}
            </text>
            <text x={x} y={y + 22} textAnchor={anchor} fontSize={11} fill="#9ca3af">
              {pct}% of total
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function ChartCard({ title, children, className = '', stretch = false }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5 ${stretch ? 'flex flex-col' : ''} ${className}`}>
      <p className={`text-sm font-semibold text-gray-700 mb-3 sm:mb-4 ${stretch ? 'flex-shrink-0' : ''}`}>{title}</p>
      {stretch ? <div className="flex-1 min-h-[220px]">{children}</div> : children}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="mb-8">
      <div className="h-7 bg-gray-200 rounded w-56 mb-1 animate-pulse" />
      <div className="h-4 bg-gray-100 rounded w-52 mb-6 animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-2/5 mb-5" />
          <div className="h-52 bg-gray-100 rounded-xl" />
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/5 mb-5" />
          <div className="h-52 bg-gray-100 rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {[0, 1].map(i => (
          <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-2/5 mb-5" />
            <div className="h-56 bg-gray-100 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PhysicianOverview({ npi }) {
  const [trend, setTrend] = useState(null)
  const [suppliers, setSuppliers] = useState(null)
  const [fvc, setFvc] = useState(null)
  const [categories, setCategories] = useState(null)
  const [flagTl, setFlagTl] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!npi) return
    let cancelled = false
    const q = `?npi=${encodeURIComponent(npi)}`
    Promise.all([
      fetch(`${API_BASE}/analytics/physician/claims-trend${q}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API_BASE}/analytics/physician/claims-by-supplier${q}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API_BASE}/analytics/physician/flagged-vs-clean${q}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API_BASE}/analytics/physician/claims-by-category${q}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API_BASE}/analytics/physician/flag-timeline${q}`, { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([t, s, f, cat, ft]) => {
        if (!cancelled) {
          setTrend(t); setSuppliers(s); setFvc(f); setCategories(cat); setFlagTl(ft)
          setLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [npi])

  if (loading) return <LoadingSkeleton />
  if (!trend) return null

  const trendData = (trend.months || []).map((m, i) => ({ month: m, count: trend.counts?.[i] || 0 }))
  const pieData = (suppliers?.suppliers || []).map(s => ({ name: s.supplier_name, value: s.claim_count, total_amount: s.total_amount }))
  const catData = categories?.categories || []
  const flagData = (flagTl?.months || []).map((m, i) => ({ month: m, flagged: flagTl.flagged_counts?.[i] || 0 }))
  const totalFlags = flagData.reduce((sum, d) => sum + d.flagged, 0)
  return (
    <div className="mb-6 sm:mb-8">
      {/* ── Row 1: claims trend (2/3) + supplier donut (1/3) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-5 mb-3 sm:mb-5">

        <ChartCard title="My Claims — Last 6 Months" className="lg:col-span-2" stretch>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 10, right: 28, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
              <Area
                type="monotone"
                dataKey="count"
                name="Claims"
                stroke="#1B3A5C"
                fill="#bfdbfe"
                fillOpacity={0.6}
                strokeWidth={2}
                dot={{ r: 3, fill: '#1B3A5C', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Claims by Supplier">
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={75}
                dataKey="value"
                paddingAngle={2}
              >
                {pieData.map((entry, i) => <Cell key={i} fill={supplierFill(entry.name, i)} />)}
              </Pie>
              <Tooltip
                formatter={(value, name, props) => [
                  `${value} claims · $${props.payload.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                  props.payload.name,
                ]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <SupplierLegendList pieData={pieData} />
        </ChartCard>

      </div>

      {/* ── Row 2: top suppliers by amount + flag timeline ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-5">

        <ChartCard title="Claims by Service Category">
          <VennChart data={catData} />
        </ChartCard>

        <ChartCard title="Monthly Flags Raised">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={flagData} margin={{ top: 44, right: 16, left: 0, bottom: 10 }}>
              <defs>
                <linearGradient id="flagStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="#3b82f6" />
                  <stop offset="50%"  stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#ef4444" />
                </linearGradient>
                <linearGradient id="flagArea" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="50%"  stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.25} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={v => v.split(' ')[0]}
                interval={0}
                height={24}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                width={28}
                domain={[0, 'auto']}
              />
              <Tooltip
                formatter={(value) => [value, 'Flags']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Area
                type="monotone"
                dataKey="flagged"
                name="Flags"
                stroke="url(#flagStroke)"
                fill="url(#flagArea)"
                strokeWidth={2.5}
                dot={(dotProps) => {
                  const { cx, cy, payload, index } = dotProps
                  if (!payload.flagged) return <g key={`e-${index}`} />
                  const pct = totalFlags > 0 ? Math.round((payload.flagged / totalFlags) * 100) : 0
                  return (
                    <g key={`fd-${index}`}>
                      <line x1={cx} y1={cy} x2={cx} y2={cy - 28} stroke="#9ca3af" strokeWidth={1} strokeDasharray="2 2" />
                      <circle cx={cx} cy={cy - 28} r={4.5} fill="#374151" />
                      <text x={cx} y={cy - 36} textAnchor="middle" fontSize={10} fontWeight={700} fill="#374151">{pct}%</text>
                    </g>
                  )
                }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

      </div>
    </div>
  )
}
