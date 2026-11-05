import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { since } from '@/lib/time'

export interface VersionRow {
  id: string // 'draft' | 'v3'
  title: string
  message: string
  kind: string
  created_at?: string
  size: string
}

const KIND_VARIANT: Record<string, 'warning' | 'default' | 'success' | 'outline' | 'info'> = {
  draft: 'warning',
  latest: 'default',
  ingest: 'success',
  edit: 'outline',
  restore: 'info'
}

interface VersionListItemProps {
  version: VersionRow
  latest?: boolean
  role?: 'base' | 'compare'
  onSelect: () => void
}

export default function VersionListItem({ version, latest, role, onSelect }: VersionListItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={!!role}
        className={cn(
          'focus-visible:ring-ring flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
          role ? 'border-muted-foreground bg-muted' : 'hover:bg-muted/50'
        )}
      >
        <span className="bg-background flex h-8 w-13 shrink-0 items-center justify-center rounded-md border text-xs font-semibold">{version.title}</span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-sm font-medium break-words">{version.message}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={KIND_VARIANT[version.kind] ?? 'outline'}>{version.kind}</Badge>
            {latest && <Badge variant="default">latest</Badge>}
            {version.created_at && <span className="text-muted-foreground text-xs">{since(version.created_at)}</span>}
          </span>
          <span className="text-muted-foreground block text-xs">{version.size}</span>
        </span>
        {role && <Badge variant="outline">{role === 'base' ? 'basis' : 'banding'}</Badge>}
      </button>
    </li>
  )
}
