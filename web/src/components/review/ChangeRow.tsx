import { Check, Undo2 } from 'lucide-react'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import type { ChangeKind, ReviewItem } from '@/lib/api'

const KIND: Record<ChangeKind, { label: string; variant: 'success' | 'info' | 'warning' | 'destructive' | 'secondary' }> = {
  add: { label: 'Baru', variant: 'success' },
  modify: { label: 'Diubah', variant: 'info' },
  invalidate: { label: 'Invalidate', variant: 'warning' },
  remove: { label: 'Dihapus', variant: 'secondary' },
  conflict: { label: 'Konflik', variant: 'destructive' }
}

interface ChangeRowProps {
  change: ReviewItem
  busy?: boolean
  onReject: () => void
  onKeep?: () => void
}

/** One reviewed change. "Tolak" undoes it in the draft; conflicts can keep one side. */
export default function ChangeRow({ change, busy, onReject, onKeep }: ChangeRowProps) {
  const kind = KIND[change.kind]
  return (
    <li className="flex items-center gap-3 rounded-md border p-3">
      <Badge variant={kind.variant} className="shrink-0">
        {kind.label}
      </Badge>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-muted-foreground text-xs font-medium">
          {change.target === 'node' ? change.label : `Relasi · ${change.label}`}
        </p>
        <p className="text-sm font-medium break-words">{change.item}</p>
        {change.detail && <p className="text-sm break-words">{change.detail}</p>}
        {change.quote && <p className="text-muted-foreground font-mono text-xs break-words">“{change.quote}”</p>}
      </div>
      {change.kind === 'conflict' && onKeep && (
        <Button variant="outline" size="sm" disabled={busy} onClick={onKeep}>
          <Check /> <span className="hidden sm:inline">Pakai ini</span>
        </Button>
      )}
      {change.kind !== 'remove' && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={onReject}>
          <Undo2 /> <span className="hidden sm:inline">Tolak</span>
        </Button>
      )}
    </li>
  )
}
