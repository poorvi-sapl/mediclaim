// Shimmer placeholder for table screens while data is fetching.
const Bar = ({ w = 'w-32', h = 'h-4', extra = '' }) =>
  <div className={`${w} ${h} rounded bg-slate-200/70 animate-pulse ${extra}`} />

export default function TableSkeleton({ rows = 8 }) {
  return (
    <div className="mc-card overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-4">
        <Bar w="w-24" h="h-3" />
        <Bar w="w-24" h="h-3" />
        <Bar w="w-32" h="h-3" extra="ml-auto" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-6 py-4 flex items-center gap-4">
            <Bar w="w-20" h="h-3.5" />
            <Bar w="w-40" h="h-3.5" />
            <Bar w="w-28" h="h-3.5" extra="hidden md:block" />
            <Bar w="w-16" h="h-3.5" extra="ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}
