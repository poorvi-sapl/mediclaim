// Shimmer placeholder while the physician summary data is fetching.
const Bar = ({ w = 'w-32', h = 'h-4', extra = '' }) =>
  <div className={`${w} ${h} rounded bg-slate-200/70 animate-pulse ${extra}`} />

export default function SummaryCardSkeleton() {
  return (
    <div className="max-w-screen-xl mx-auto px-7 py-7">
      <div className="rounded-2xl p-6 mb-6 flex items-center gap-4" style={{ backgroundColor: '#1B3A5C' }}>
        <div className="w-14 h-14 rounded-2xl bg-white/15 animate-pulse" />
        <div className="space-y-2">
          <div className="w-48 h-6 rounded bg-white/15 animate-pulse" />
          <div className="w-64 h-3.5 rounded bg-white/10 animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mc-card p-5">
            <div className="w-10 h-10 rounded-xl bg-slate-200/70 animate-pulse" />
            <Bar w="w-24" h="h-3" extra="mt-4" />
            <Bar w="w-20" h="h-8" extra="mt-2" />
          </div>
        ))}
      </div>
      <div className="mc-card h-16 mb-6 animate-pulse" />
      <div className="mc-card h-40 animate-pulse" />
    </div>
  )
}
