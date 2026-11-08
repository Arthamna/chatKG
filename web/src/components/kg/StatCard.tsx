import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
}

export default function StatCard({ label, value, sub, icon: Icon }: StatCardProps) {
  return (
    <div className="bg-card grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-3 min-[480px]:block min-[480px]:py-4 sm:px-6">
      <dt className="text-body-text col-start-1 row-start-1 flex items-center gap-2 text-sm leading-5 font-medium">
        <Icon aria-hidden="true" className="border-divider bg-muted size-7 shrink-0 rounded-sm border p-1.5" />
        {label}
      </dt>
      <dd className="col-start-2 row-span-2 row-start-1 text-[28px] leading-8 font-bold tabular-nums min-[480px]:mt-2 ">{value}</dd>
      {sub && (
        <dd className="text-muted-foreground col-start-1 row-start-2 line-clamp-2 pl-9 text-[13px] leading-[1.5] min-[480px]:mt-1 min-[480px]:pl-0" title={sub}>
          {sub}
        </dd>
      )}
    </div>
  )
}
