import { cn } from '@/lib/utils'
import { typeColor } from '@/lib/graph'

interface LegendProps {
  types: string[]
  className?: string
  showDraft?: boolean
}

/** Types present in the current graph, colored like the nodes. */
export default function Legend({ types, className, showDraft = true }: LegendProps) {
  return (
    <div className={cn('bg-background/60 space-y-1.5 rounded-lg border-2 p-2.5 text-xs backdrop-blur-lg', className)}>
      <p className="font-semibold">Legend</p>
      {types.map((t) => (
        <div key={t} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: typeColor(t) }} />
          {t}
        </div>
      ))}
      {showDraft && (
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-[1.5px] border-dashed border-amber-600" />
          Berubah di draft
        </div>
      )}
    </div>
  )
}
