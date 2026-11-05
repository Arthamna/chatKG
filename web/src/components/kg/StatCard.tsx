import type { LucideIcon } from 'lucide-react'

import { Card } from '@/components/ui/Card'

interface StatCardProps {
  label: string
  value: string
  sub: string
  icon: LucideIcon
}

export default function StatCard({ label, value, sub, icon: Icon }: StatCardProps) {
  return (
    <Card className="space-y-1 p-5">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <Icon className="text-muted-foreground size-4" />
      </div>
      <p className="text-2xl font-bold tracking-[-0.015em]">{value}</p>
      <p className="text-muted-foreground text-xs">{sub}</p>
    </Card>
  )
}
