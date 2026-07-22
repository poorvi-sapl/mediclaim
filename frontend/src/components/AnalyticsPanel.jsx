import { useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import { API_BASE } from '../api'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6']

const PHYSICIAN_CHIPS = [
  'Claims by vendor this month',
  'My top 5 vendors by amount',
  'Flagged claims in the last 30 days',
  'Claim trend over last 6 months',
  'Which vendor had the most flags?',
]

const PLAN_CHIPS = [
  'Top 10 highest risk NPIs',
  'Claims by rule type this quarter',
  'Vendor volume comparison',
  'Flag trend over last 90 days',
  'Which NPI billed the most this month?',
]

function LoadingSkeleton() {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-w-full">
      <div className="h-4 bg-gray-200 animate-pulse rounded w-2/3 mb-3" />
      <div className="h-32 bg-gray-200 animate-pulse rounded" />
    </div>
  )
}

function StatDisplay({ data }) {
  return (
    <div className="flex flex-col items-center py-6">
      <div className="text-4xl font-bold text-indigo-600 tabular-nums">{data.value}</div>
      <div className="text-sm font-semibold text-gray-700 mt-2">{data.label}</div>
      {data.sublabel && <div className="text-xs text-gray-500 mt-1">{data.sublabel}</div>}
    </div>
  )
}

function TableDisplay({ data }) {
  const { columns = [], rows = [] } = data
  return (
    <div className="overflow-x-auto max-h-64">
      <table className="w-full text-xs">
        <thead className="sticky top-0">
          <tr className="bg-gray-100 border-b border-gray-200">
            {columns.map((col, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-gray-700">
                  {cell === null || cell === undefined ? '—' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartRenderer({ result }) {
  const { chart_type, data, x_label, y_label } = result

  if (!data) return null
  if (chart_type === 'stat') return <StatDisplay data={data} />
  if (chart_type === 'table') return <TableDisplay data={data} />

  if (chart_type === 'bar') {
    const chartData = (data.labels || []).map((l, i) => ({
      name: l.length > 16 ? l.slice(0, 14) + '…' : l,
      fullName: l,
      value: data.values?.[i] ?? 0,
    }))
    const maxVal = Math.max(...chartData.map(d => d.value), 1)
    const fmtAxis = v =>
      maxVal >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
      : maxVal >= 1_000   ? `${(v / 1_000).toFixed(0)}K`
      : String(v)
    return (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ top: 10, right: 16, left: 8, bottom: 72 }} barCategoryGap="28%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            angle={-40}
            textAnchor="end"
            interval={0}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickFormatter={fmtAxis}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            formatter={(val, _, props) => [Number(val).toLocaleString(), props.payload.fullName]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
            cursor={{ fill: 'rgba(99,102,241,0.05)' }}
          />
          <Bar dataKey="value" radius={[5, 5, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (chart_type === 'line') {
    const chartData = (data.labels || []).map((l, i) => ({ name: l, value: data.values?.[i] ?? 0 }))
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11 }}
            label={x_label ? { value: x_label, position: 'insideBottom', offset: -30, fontSize: 11 } : undefined}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            label={y_label ? { value: y_label, angle: -90, position: 'insideLeft', fontSize: 11 } : undefined}
          />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={{ fill: COLORS[0], r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (chart_type === 'pie') {
    const chartData = (data.labels || []).map((l, i) => ({ name: l, value: data.values?.[i] ?? 0 }))
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" outerRadius={100} dataKey="value">
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (chart_type === 'scatter') {
    const pts = (data.points || []).map(p => ({ x: p.x, y: p.y, label: p.label }))
    return (
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 5, right: 10, left: 10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="x"
            name={x_label || 'X'}
            tick={{ fontSize: 11 }}
            label={x_label ? { value: x_label, position: 'insideBottom', offset: -30, fontSize: 11 } : undefined}
          />
          <YAxis
            dataKey="y"
            name={y_label || 'Y'}
            tick={{ fontSize: 11 }}
            label={y_label ? { value: y_label, angle: -90, position: 'insideLeft', fontSize: 11 } : undefined}
          />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={pts} fill={COLORS[0]} />
        </ScatterChart>
      </ResponsiveContainer>
    )
  }

  return null
}

function AssistantCard({ message }) {
  const { result } = message
  if (!result) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-w-full text-sm text-gray-600">
        {message.content}
      </div>
    )
  }
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-w-full">
      {result.title && (
        <div className="text-sm font-semibold text-gray-800 mb-2">{result.title}</div>
      )}
      {result.insight && (
        <div className="bg-indigo-50 text-indigo-800 text-sm px-3 py-2 rounded-lg mb-3">
          {result.insight}
        </div>
      )}
      <ChartRenderer result={result} />
    </div>
  )
}

export default function AnalyticsPanel({ portal, npi }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [currentQuery, setCurrentQuery] = useState('')
  const [loading, setLoading] = useState(false)

  const chips = portal === 'physician' ? PHYSICIAN_CHIPS : PLAN_CHIPS

  async function submit(queryText) {
    const q = (queryText ?? input).trim()
    if (!q || loading) return
    setCurrentQuery(q)
    setInput('')

    const userMsg = { role: 'user', content: q, result: null }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const body = {
        query: q,
        conversation_history: history,
        portal,
        npi: npi || null,
        filters: null,
      }
      const res = await fetch(`${API_BASE}/analytics/query`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Request failed')
      const result = await res.json()
      setMessages([...nextMessages, { role: 'assistant', content: result.insight || '', result }])
    } catch {
      setMessages([...nextMessages, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        result: null,
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex gap-6 min-h-[340px]">

        {/* ── Left column: controls ── */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Analytics Assistant</h2>
              <p className="text-xs text-slate-400 mt-0.5">Ask questions in plain English</p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1 rounded hover:bg-slate-50 shrink-0"
              >
                Clear
              </button>
            )}
          </div>

          {/* Input + Analyze */}
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your claims data..."
              className="w-full text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent placeholder-gray-400"
            />
            <button
              onClick={() => submit()}
              disabled={!input.trim() || loading}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>

          {/* Suggested chips — single click auto-submits */}
          <div className="flex flex-wrap gap-1.5">
            {chips.map(chip => (
              <button
                key={chip}
                onClick={() => submit(chip)}
                disabled={loading}
                className="bg-gray-100 hover:bg-indigo-50 hover:text-indigo-700 text-gray-600 text-xs px-3 py-1.5 rounded-full cursor-pointer transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {chip}
              </button>
            ))}
          </div>

        </div>

        {/* ── Divider ── */}
        <div className="w-px bg-gray-100 self-stretch" />

        {/* ── Right column: result ── */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {/* Empty state */}
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full py-10 text-center">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-500">No query yet</p>
              <p className="text-xs text-slate-400 mt-1">Pick a suggestion or type a question on the left</p>
            </div>
          )}

          {/* Loading — show query label + skeleton */}
          {loading && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs text-indigo-600 font-medium">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Analyzing: <span className="text-slate-600 font-normal italic truncate max-w-xs">"{currentQuery}"</span>
              </div>
              <LoadingSkeleton />
            </div>
          )}

          {/* Latest result */}
          {!loading && messages.filter(m => m.role === 'assistant').slice(-1).map((msg, i) => (
            <AssistantCard key={i} message={msg} />
          ))}

        </div>

      </div>
    </div>
  )
}
