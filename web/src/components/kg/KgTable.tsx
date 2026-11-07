import { Link } from 'react-router-dom'
import { MessageSquare, Network, Trash2 } from 'lucide-react'

import Button from '@/components/ui/Button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { fmt } from '@/lib/utils'
import { since } from '@/lib/time'
import type { KnowledgeGraph } from '@/lib/api'

function VersionBadges({ kg }: { kg: KnowledgeGraph }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] leading-[1.5] font-medium">
      {kg.latest ? (
        <span className="border-divider bg-muted rounded-full border px-2 tabular-nums">v{kg.latest} · terkini</span>
      ) : (
        <span className="text-muted-foreground">Belum ada versi</span>
      )}
      {kg.has_draft && (
        <span className="bg-secondary text-body-text rounded-full px-2 py-px text-xs leading-4 font-semibold uppercase">Draft</span>
      )}
    </div>
  )
}

function Actions({ kg, onOpen, onDelete }: { kg: KnowledgeGraph; onOpen: (id: string) => void; onDelete: (kg: KnowledgeGraph) => void }) {
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" className="rounded-md px-3 font-bold" asChild>
        <Link to={`/kg/${kg.id}/graph`} onClick={() => onOpen(kg.id)}>
          <Network /> Editor
        </Link>
      </Button>
      
      <Button variant="ghost" className="rounded-md px-3 font-bold" asChild>
        <Link to={`/ask?kg=${kg.id}`} onClick={() => onOpen(kg.id)}>
          <MessageSquare /> Ask
        </Link>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="text-destructive rounded-md"
        tooltip={`Hapus ${kg.name}`}
        onClick={() => onDelete(kg)}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

export default function KgTable({ items, onOpen, onDelete }: { items: KnowledgeGraph[]; onOpen: (id: string) => void; onDelete: (kg: KnowledgeGraph) => void }) {
  return (
    <>
      <div className="hidden md:block">
        <Table aria-label="Daftar knowledge graph">
          <TableHeader className="bg-muted [&_th]:text-body-text [&_th]:text-xs [&_th]:leading-4 [&_th]:font-bold [&_th]:uppercase">
            <TableRow className="border-divider hover:bg-transparent">
              <TableHead scope="col" className="w-[32%] pl-6">Nama</TableHead>
              <TableHead scope="col" className='text-center'>Versi</TableHead>
              <TableHead scope="col" className="text-center">Entitas</TableHead>
              <TableHead scope="col" className="text-center">Fakta</TableHead>
              <TableHead scope="col" className="text-center">Episode</TableHead>
              <TableHead scope="col">Dibuat</TableHead>
              <TableHead scope="col" className="pr-6 text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((kg) => (
              <TableRow key={kg.id} className="border-divider hover:bg-muted">
                <TableCell className="py-3 pl-6">
                  <p className="leading-6 font-semibold wrap-anywhere">{kg.name}</p>
                  <p className="text-muted-foreground text-[13px] leading-[1.5] wrap-anywhere">{kg.description || kg.id}</p>
                </TableCell>
                <TableCell>
                  <div className='flex justify-center'>
                    <VersionBadges kg={kg} />
                  </div>
                </TableCell>
                <TableCell className="text-center tabular-nums">{fmt(kg.stats.nodes)}</TableCell>
                <TableCell className="text-center tabular-nums">{fmt(kg.stats.edges)}</TableCell>
                <TableCell className="text-center tabular-nums">{fmt(kg.stats.episodes)}</TableCell>
                <TableCell className="text-muted-foreground text-[13px] leading-[1.5] whitespace-nowrap">{since(kg.created_at)}</TableCell>
                <TableCell className="pr-3">
                  <Actions kg={kg} onOpen={onOpen} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-divider divide-y md:hidden">
        {items.map((kg) => (
          <li key={kg.id} className="space-y-2 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="leading-6 font-semibold wrap-anywhere">{kg.name}</p>
                <p className="text-muted-foreground text-[13px] leading-[1.5] wrap-anywhere">{kg.description || kg.id}</p>
              </div>
              <VersionBadges kg={kg} />
            </div>
            <p className="text-muted-foreground text-[13px] leading-[1.5] tabular-nums">
              {fmt(kg.stats.nodes)} entitas · {fmt(kg.stats.edges)} fakta · {fmt(kg.stats.episodes)} episode · dibuat {since(kg.created_at)}
            </p>
            <Actions kg={kg} onOpen={onOpen} onDelete={onDelete} />
          </li>
        ))}
      </ul>
    </>
  )
}
