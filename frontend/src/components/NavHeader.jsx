import { useRef, useState } from 'react'
import { motion } from 'framer-motion'

// Animated pill nav — a white capsule with a navy cursor that slides between
// tabs on hover. Themed to the landing page palette (#1a3d7c brand navy on the
// #0d1f35 navbar): the hovered tab is tracked explicitly and its text flipped
// to white, replacing the original black/white mix-blend-difference trick
// (which only works with pure black and white).
export default function NavHeader({ items, onNavigate }) {
  const [position, setPosition] = useState({ left: 0, width: 0, opacity: 0 })
  const [hovered, setHovered] = useState(null)

  return (
    <ul
      className="relative mx-auto flex w-fit rounded-full border border-white/25 bg-white p-1 shadow-lg shadow-black/20"
      onMouseLeave={() => { setPosition((pv) => ({ ...pv, opacity: 0 })); setHovered(null) }}
    >
      {items.map(({ href, label }) => (
        <Tab key={href} href={href} active={hovered === href} onNavigate={onNavigate}
             onHover={(pos) => { setPosition(pos); setHovered(href) }}>
          {label}
        </Tab>
      ))}
      <Cursor position={position} />
    </ul>
  )
}

function Tab({ children, href, active, onHover, onNavigate }) {
  const ref = useRef(null)
  return (
    <li
      ref={ref}
      onMouseEnter={() => {
        if (!ref.current) return
        const { width } = ref.current.getBoundingClientRect()
        onHover({ width, opacity: 1, left: ref.current.offsetLeft })
      }}
      className={`relative z-10 block cursor-pointer px-3 py-1.5 text-xs font-semibold uppercase transition-colors duration-150 md:px-4 md:py-2 md:text-xs ${active ? 'text-white' : 'text-[#1a3d7c]'}`}
    >
      <a href={href} onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate(href) } }}>
        {children}
      </a>
    </li>
  )
}

function Cursor({ position }) {
  return (
    <motion.li
      animate={position}
      className="absolute z-0 h-7 rounded-full bg-[#1a3d7c] md:h-8"
    />
  )
}
