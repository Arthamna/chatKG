import { GitCommitHorizontal, History, Network, Pencil } from 'lucide-react'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import type { KnowledgeGraph, Version } from '@/lib/api'

interface DraftBarProps {
  kgs: KnowledgeGraph[]
  kg: string
  onKgChange: (v: string) => void
  versions: Version[]
  hasDraft: boolean
  version: string
  onVersionChange: (v: string) => void
  changes: number
  readOnly: boolean
  canEdit: boolean
  onStartEdit: () => void
  onDiscard: () => void
  onCommit: () => void
}

export default function DraftBar(p: DraftBarProps) {
  const isDraft = p.version === 'draft'
  return (
    <div className="bg-background flex flex-wrap items-center gap-2.5 border-b px-4 py-2">
      <Network className="text-muted-foreground hidden size-4 sm:block" />
      <Select value={p.kg} onValueChange={p.onKgChange}>
        <SelectTrigger className="w-40 md:w-48" aria-label="Knowledge graph">
          <SelectValue placeholder="Pilih KG" />
        </SelectTrigger>
        <SelectContent>
          {p.kgs.map((k) => (
            <SelectItem key={k.id} value={k.id}>
              {k.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <History className="text-muted-foreground hidden size-4 sm:block" />
      <Select value={p.version} onValueChange={p.onVersionChange}>
        <SelectTrigger className="w-44 md:w-56" aria-label="Versi">
          <SelectValue placeholder="Versi" />
        </SelectTrigger>
        <SelectContent>
          {p.hasDraft && <SelectItem value="draft">draft (bisa diedit)</SelectItem>}
          {p.versions.map((v, i) => (
            <SelectItem key={v.n} value={`v${v.n}`}>
              v{v.n}
              {i === 0 ? ' · latest' : ''} (read-only)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isDraft && <Badge variant={p.changes ? 'warning' : 'secondary'}>Draft · {p.changes} perubahan</Badge>}

      <div className="ml-auto flex gap-2">
        {isDraft && !p.readOnly ? (
          <>
            <Button variant="outline" size="sm" onClick={p.onDiscard}>
              Buang draft
            </Button>
            <Button size="sm" disabled={!p.changes} onClick={p.onCommit}>
              <GitCommitHorizontal /> Commit draft
            </Button>
          </>
        ) : (
          p.canEdit && (
            <Button variant="outline" size="sm" onClick={p.onStartEdit}>
              <Pencil /> {p.hasDraft ? 'Buka draft' : 'Edit (buat draft)'}
            </Button>
          )
        )}
      </div>
    </div>
  )
}
