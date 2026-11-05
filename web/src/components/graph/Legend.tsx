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
    <div className={cn('bg-card max-h-[50%] max-w-[calc(100%-1rem)] space-y-1.5 overflow-y-auto rounded-md border p-3 text-xs wrap-anywhere', className)}>
      <p className="font-bold">Legend</p>
      {types.map((t) => (
        <div key={t} className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: typeColor(t) }} />
          {t}
        </div>
      ))}
      {showDraft && (
        <div className="flex items-center gap-1.5">
          <span className="border-warning size-2.5 shrink-0 rounded-full border border-dashed" />
          Berubah di draft
        </div>
      )}
    </div>
  )
}
