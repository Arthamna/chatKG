import { ArrowRight, X } from 'lucide-react'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

interface RelationTypeRowProps {
  source: string
  relation: string
  target: string
  onRemove?: () => void
}

export default function RelationTypeRow({ source, relation, target, onRemove }: RelationTypeRowProps) {
  return (
    <li className="flex items-center gap-2.5 rounded-md px-2 py-1">
      <Badge variant="outline">{source}</Badge>
      <ArrowRight className="text-muted-foreground size-4" />
      <span className="text-violet text-xs font-semibold">{relation}</span>
      <ArrowRight className="text-muted-foreground size-4" />
      <Badge variant="outline">{target}</Badge>
      {onRemove && (
        <Button variant="ghost" size="icon" className="ml-auto" tooltip="Hapus relasi" onClick={onRemove}>
          <X className="text-muted-foreground" />
        </Button>
      )}
    </li>
  )
}
