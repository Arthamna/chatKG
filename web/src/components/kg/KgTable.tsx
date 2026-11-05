import { Link } from 'react-router-dom'
import { MessageSquare, Network } from 'lucide-react'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { fmt } from '@/lib/utils'
import { since } from '@/lib/time'
import type { KnowledgeGraph } from '@/lib/api'

function VersionBadges({ kg }: { kg: KnowledgeGraph }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {kg.latest ? <Badge variant="outline">v{kg.latest} · latest</Badge> : <Badge variant="secondary">belum ada versi</Badge>}
      {kg.has_draft && <Badge variant="warning">draft</Badge>}
    </div>
  )
}

function Actions({ kg, onOpen }: { kg: KnowledgeGraph; onOpen: (id: string) => void }) {
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <Link to={`/kg/${kg.id}/graph`} onClick={() => onOpen(kg.id)}>
          <Network /> Editor
        </Link>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <Link to={`/ask?kg=${kg.id}`} onClick={() => onOpen(kg.id)}>
          <MessageSquare /> Ask
        </Link>
      </Button>
    </div>
  )
}

/** Table on md+, stacked cards below md (spec § Responsive). */
export default function KgTable({ items, onOpen }: { items: KnowledgeGraph[]; onOpen: (id: string) => void }) {
  if (!items.length) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-1 rounded-lg border border-dashed py-12 text-sm">
        <p className="text-foreground font-medium">Belum ada knowledge graph</p>
        <p>Buat KG baru, lalu upload chat untuk mengisinya.</p>
      </div>
    )
  }
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Versi</TableHead>
              <TableHead>Entitas</TableHead>
              <TableHead>Fakta</TableHead>
              <TableHead className="hidden xl:table-cell">Episode</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((kg) => (
              <TableRow key={kg.id}>
                <TableCell className="py-3">
                  <p className="font-semibold">{kg.name}</p>
                  <p className="text-muted-foreground text-xs">{kg.description || kg.id}</p>
                </TableCell>
                <TableCell>
                  <VersionBadges kg={kg} />
                </TableCell>
                <TableCell>{fmt(kg.stats.nodes)}</TableCell>
                <TableCell>{fmt(kg.stats.edges)}</TableCell>
                <TableCell className="hidden xl:table-cell">{fmt(kg.stats.episodes)}</TableCell>
                <TableCell>{since(kg.created_at)}</TableCell>
                <TableCell>
                  <Actions kg={kg} onOpen={onOpen} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {items.map((kg) => (
          <li key={kg.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{kg.name}</p>
                <p className="text-muted-foreground text-xs">{kg.description || kg.id}</p>
              </div>
              <VersionBadges kg={kg} />
            </div>
            <p className="text-muted-foreground text-xs">
              {fmt(kg.stats.nodes)} entitas · {fmt(kg.stats.edges)} fakta · dibuat {since(kg.created_at)}
            </p>
            <Actions kg={kg} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </>
  )
}
