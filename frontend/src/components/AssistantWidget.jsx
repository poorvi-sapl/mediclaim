// Floating assistant for the payer portal.
//
// A navy bubble bottom-left; clicking it opens a resizable chat panel. Answers
// stream from POST /plan/assistant/stream: status lines appear while the agent
// reads data, then the answer replaces them and the trail collapses to a summary
// the payer can re-open — so every answer keeps a record of which data produced it.
//
// Mounted once by PlanPortal (not per screen) so the conversation survives
// navigating between Dashboard / Leaderboard / NPI detail.
//
// Native EventSource can't be used: it's GET-only and the question goes in a POST
// body. So this reads the response as a stream and parses `data:` lines itself.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../api'
import { Icon } from './ui'

const NAVY = 'var(--color-primary)'
const STORE_KEY = 'payer-assistant-panel'

const COMPACT = { w: 500, h: 540 }   // default size on first open
const MIN = { w: 340, h: 380 }

// Status icon names from the backend -> icons that exist in ui.jsx's ICONS.
const STATUS_ICON = {
  search: 'search', user: 'user', building: 'suppliers',
  chart: 'leaderboard', list: 'leaderboard', book: 'doc', docs: 'file',
}

function loadPanel() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    return {
      w: Number(saved.w) || COMPACT.w,
      h: Number(saved.h) || COMPACT.h,
    }
  } catch {
    return { ...COMPACT }
  }
}

// Never let a restored size exceed the current viewport — a panel sized on a big
// monitor must not hang off the screen on a laptop.
function clampToViewport({ w, h }) {
  const maxW = Math.max(MIN.w, window.innerWidth - 48)
  const maxH = Math.max(MIN.h, window.innerHeight - 120)
  return { w: Math.min(w, maxW), h: Math.min(h, maxH) }
}

function StatusLine({ status }) {
  return (
    <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--color-text-body)' }}>
      <span className="shrink-0" style={{ color: 'var(--color-primary-tint)' }}>
        <Icon name={STATUS_ICON[status.icon] || 'search'} size={13} />
      </span>
      <span className="truncate">{status.text}</span>
    </div>
  )
}

// The answer text with any entity the agent named turned into a link to its detail
// screen. Split on the longest labels first so "Dr. James Wilson" wins over "Wilson".
function AnswerText({ text, entities, onOpen }) {
  if (!entities?.length) return <span className="whitespace-pre-wrap">{text}</span>

  const sorted = [...entities].sort((a, b) => b.label.length - a.label.length)
  const pattern = sorted
    .map((e) => e.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const parts = text.split(new RegExp(`(${pattern})`, 'gi'))

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        const hit = sorted.find((e) => e.label.toLowerCase() === part.toLowerCase())
        if (!hit) return part
        return (
          <button key={i} onClick={() => onOpen(hit)} title={`Open ${hit.label}`}
                  className="font-semibold underline decoration-dotted underline-offset-2 hover:decoration-solid transition-all"
                  style={{ color: '#1F5FA8' }}>
            {part}
          </button>
        )
      })}
    </span>
  )
}

function Trail({ trail }) {
  const [open, setOpen] = useState(false)
  if (!trail?.length) return null
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium hover:underline"
              style={{ color: 'var(--color-text-muted)' }}>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={11} />
        {trail.length} step{trail.length !== 1 ? 's' : ''} · what this answer read
      </button>
      {open && (
        <div className="mt-1.5 pl-2 border-l-2 space-y-1" style={{ borderColor: 'var(--color-border)' }}>
          {trail.map((s, i) => <StatusLine key={i} status={s} />)}
        </div>
      )}
    </div>
  )
}

export default function AssistantWidget() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState(loadPanel)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [live, setLive] = useState(null)          // {statuses: []} while streaming
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
  const busy = live !== null

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(panel))
    } catch { /* private mode — size just won't persist */ }
  }, [panel])

  // Keep the newest message in view as statuses and answers arrive.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, live])

  useEffect(() => {
    if (open && !isMobile) inputRef.current?.focus()
  }, [open, isMobile])

  // Esc closes the panel; a stream in flight is aborted with it.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && open) {
        abortRef.current?.abort()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    function onResize() { setPanel((p) => ({ ...p, ...clampToViewport(p) })) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  // ── free resize by dragging the top / right edges or the corner (the panel
  //    is anchored bottom-left, so those are the edges that can move) ────────
  const resizeFrom = useCallback((axis) => (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const start = { ...panel }

    function onMove(ev) {
      // Dragging away from the bottom-left anchor grows the panel.
      setPanel(clampToViewport({
        w: axis.x ? Math.max(MIN.w, start.w + (ev.clientX - startX)) : start.w,
        h: axis.y ? Math.max(MIN.h, start.h - (ev.clientY - startY)) : start.h,
      }))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [panel])

  function startNew() {
    abortRef.current?.abort()
    setLive(null)
    setMessages([])
    inputRef.current?.focus()
  }

  function openEntity(entity) {
    // Panel deliberately stays open — the payer is following a reference, not
    // leaving the conversation.
    if (entity.type === 'physician') navigate(`/payer/npi/${entity.id}`)
    else if (entity.type === 'vendor') navigate(`/payer/vendor/${entity.id}`)
  }

  async function send(text) {
    const question = (text ?? input).trim()
    if (!question || busy) return
    setInput('')

    const history = messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.answer))
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.role === 'user' ? m.text : m.answer }))

    setMessages((prev) => [...prev, { role: 'user', text: question }])
    setLive({ statuses: [] })

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/plan/assistant/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false

      while (!done) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })

        // SSE frames are separated by a blank line; keep any partial tail.
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''

        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          let event
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === 'status') {
            setLive((l) => ({ statuses: [...(l?.statuses || []), event] }))
          } else if (event.type === 'answer') {
            setLive((l) => {
              const trail = l?.statuses || []
              setMessages((prev) => [...prev, {
                role: 'assistant', answer: event.answer,
                entities: event.entities || [], trail,
              }])
              return null
            })
            done = true
          } else if (event.type === 'error') {
            setLive((l) => {
              const trail = l?.statuses || []
              setMessages((prev) => [...prev, {
                role: 'assistant', answer: event.message || 'Something went wrong.',
                entities: [], trail, failed: true,
              }])
              return null
            })
            done = true
          }
        }
      }
      // Stream ended without a terminal event (connection dropped mid-answer).
      setLive((l) => {
        if (!l) return null
        setMessages((prev) => [...prev, {
          role: 'assistant', answer: 'The connection dropped before the answer finished. Try again.',
          entities: [], trail: l.statuses, failed: true,
        }])
        return null
      })
    } catch (err) {
      if (err.name === 'AbortError') { setLive(null); return }
      setLive(null)
      setMessages((prev) => [...prev, {
        role: 'assistant', failed: true, entities: [], trail: [],
        answer: "Couldn't reach the assistant. Check your connection and try again.",
      }])
    } finally {
      abortRef.current = null
    }
  }

  // ── the bubble ───────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} aria-label="Open assistant" title="Ask anything about your plan"
              className="fixed bottom-6 left-6 z-40 flex items-center justify-center rounded-full text-white transition-transform duration-200 hover:scale-105 active:scale-95"
              style={{ width: 56, height: 56, background: NAVY, boxShadow: 'var(--shadow-button)' }}>
        <Icon name="bot" size={26} stroke={1.8} />
        {/* Decorative dots rising off the bubble's shoulder (design mock) */}
        <span aria-hidden className="absolute rounded-full" style={{ width: 5, height: 5, top: -3, right: 1, background: NAVY, opacity: .8 }} />
        <span aria-hidden className="absolute rounded-full" style={{ width: 4, height: 4, top: -10, right: -5, background: NAVY, opacity: .5 }} />
        <span aria-hidden className="absolute rounded-full" style={{ width: 3, height: 3, top: -17, right: -11, background: NAVY, opacity: .3 }} />
      </button>
    )
  }

  const frameStyle = isMobile
    ? { inset: 0, borderRadius: 0 }
    : { bottom: 24, left: 24, width: panel.w, height: panel.h, borderRadius: 18 }

  // Whether the empty state has room for its full layout (icon at full size,
  // descriptive line under the heading). Recomputed live during a resize drag.
  const roomy = isMobile || panel.h >= 500

  return (
    <div className="fixed z-40 flex flex-col overflow-hidden bg-white"
         style={{ ...frameStyle, boxShadow: '0 20px 50px rgba(10,31,61,.28)', border: '1px solid var(--color-border)' }}>

      {/* Resize handles — grab the top or right edge (or the corner) and drag
          to stretch the panel freely; it stays anchored bottom-left. */}
      {!isMobile && (
        <>
          <div onMouseDown={resizeFrom({ y: true })} title="Drag to resize"
               className="absolute top-0 left-0 right-0 z-10"
               style={{ height: 6, cursor: 'ns-resize' }} />
          <div onMouseDown={resizeFrom({ x: true })} title="Drag to resize"
               className="absolute top-0 right-0 bottom-0 z-10"
               style={{ width: 6, cursor: 'ew-resize' }} />
          <div onMouseDown={resizeFrom({ x: true, y: true })} title="Drag to resize"
               className="absolute top-0 right-0 z-20"
               style={{ width: 24, height: 24, cursor: 'nesw-resize' }} />
          {/* Tiny two-headed diagonal arrow — the visible hint that the panel
              stretches in and out from this corner */}
          <svg width="16" height="16" viewBox="0 0 12 12" aria-hidden
               className="absolute pointer-events-none z-20"
               style={{ top: 5, right: 5, color: 'rgba(255,255,255,.7)' }}
               fill="none" stroke="currentColor" strokeWidth="1.3"
               strokeLinecap="round" strokeLinejoin="round">
            <line x1="3.5" y1="8.5" x2="8.5" y2="3.5"/>
            <polyline points="5.2 3.5 8.5 3.5 8.5 6.8"/>
            <polyline points="6.8 8.5 3.5 8.5 3.5 5.2"/>
          </svg>
        </>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ background: NAVY }}>
        <div className="flex items-center justify-center rounded-full shrink-0"
             style={{ width: 30, height: 30, background: 'rgba(255,255,255,.12)' }}>
          <Icon name="bot" size={17} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold text-white truncate">Ask anything about your plan</div>
        </div>
        <button onClick={startNew} title="Start a new conversation"
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold text-white/90 hover:text-white hover:bg-white/10 transition-colors"
                style={{ border: '1px solid rgba(255,255,255,.35)' }}>
          <Icon name="plus" size={12} stroke={2.6} /> New
        </button>
        <button onClick={() => { abortRef.current?.abort(); setOpen(false) }} aria-label="Close assistant"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
          <Icon name="x" size={15} stroke={2.4} />
        </button>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 bg-white">
        {messages.length === 0 && !busy && (
          // min-h-full (not h-full): if the panel is resized shorter than the
          // content, the box grows and scrolls instead of clipping the top.
          <div className="min-h-full flex flex-col items-center justify-center text-center px-3">
            <div className={`flex items-center justify-center rounded-full shrink-0 ${roomy ? 'mb-3' : 'mb-2'}`}
                 style={{ width: roomy ? 52 : 40, height: roomy ? 52 : 40, background: 'var(--color-bg-soft)', color: NAVY }}>
              <Icon name="bot" size={roomy ? 26 : 20} stroke={1.7} />
            </div>
            <div className="text-[14px] font-bold" style={{ color: 'var(--color-text-dark)' }}>
              How can I help you today?
            </div>
            {/* The descriptive line only when there's room for it — on a small
                panel it's the first thing to go so the chips still fit. */}
            {roomy && (
              <p className="mt-1 text-[12.5px] leading-relaxed max-w-[260px]" style={{ color: 'var(--color-text-muted)' }}>
                Ask about a physician, a vendor, a fraud pattern you spotted, or how the product works.
              </p>
            )}
            <div className={`${roomy ? 'mt-4' : 'mt-3'} flex flex-col items-stretch gap-2 w-full max-w-[280px]`}>
              {[
                'Who are the highest-risk physicians?',
                'Which vendors look suspicious?',
                'How is the risk score calculated?',
              ].map((q) => (
                <button key={q} onClick={() => send(q)}
                        className="px-3.5 py-2 rounded-xl text-[12.5px] font-medium text-center transition-colors"
                        style={{ border: '1px solid var(--color-border)', color: NAVY, background: 'white' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = NAVY; e.currentTarget.style.borderColor = NAVY; e.currentTarget.style.color = 'white' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = NAVY }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-md text-[13px] text-white"
                   style={{ background: NAVY }}>
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] px-3.5 py-3 rounded-2xl rounded-bl-md bg-white text-[13px] leading-relaxed"
                   style={{ border: `1px solid ${m.failed ? '#EBD3D1' : 'var(--color-border)'}`, color: m.failed ? '#8A423D' : 'var(--color-text-dark)' }}>
                <AnswerText text={m.answer} entities={m.entities} onOpen={openEntity} />
                <Trail trail={m.trail} />
              </div>
            </div>
          )
        ))}

        {/* Live status lines while the agent works */}
        {busy && (
          <div className="flex justify-start">
            <div className="max-w-[92%] px-3.5 py-3 rounded-2xl rounded-bl-md bg-white space-y-1.5"
                 style={{ border: '1px solid var(--color-border)' }}>
              {live.statuses.length === 0 && (
                <div className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>Thinking…</div>
              )}
              {live.statuses.map((s, i) => (
                <div key={i} style={{ opacity: i === live.statuses.length - 1 ? 1 : 0.55 }}>
                  <StatusLine status={s} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-3 pt-3 pb-2.5 bg-white" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder="Ask a question…"
            className="flex-1 resize-none text-[13px] px-4 py-2.5 outline-none transition-colors"
            style={{ border: `1.5px solid ${NAVY}`, borderRadius: 22, color: 'var(--color-text-dark)', maxHeight: 110 }}
          />
          <button onClick={() => send()} disabled={!input.trim() || busy}
                  className="shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-colors"
                  style={{ background: input.trim() && !busy ? 'var(--gradient-button)' : '#9AA7B8' }}>
            {busy ? '…' : 'Send'}
          </button>
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-center" style={{ color: 'var(--color-text-muted)' }}>
          Answers are grounded in your plan's live claims data.
        </p>
      </div>
    </div>
  )
}
