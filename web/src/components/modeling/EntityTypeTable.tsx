import Badge from '@/components/ui/Badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { typeColor } from '@/lib/graph'
import type { Schema } from '@/lib/api'

/** Entity types of the ontology (Graphiti entity_types), read-only. */
export default function EntityTypeTable({ items }: { items: Schema['entity_types'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-40">Tipe</TableHead>
          <TableHead>Deskripsi</TableHead>
          <TableHead className="hidden md:table-cell">Atribut</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((t) => (
          <TableRow key={t.name}>
            <TableCell>
              <span className="flex items-center gap-2 font-semibold">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: typeColor(t.name) }} />
                {t.name}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{t.description}</TableCell>
            <TableCell className="hidden md:table-cell">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(t.attributes).map(([a, desc]) => (
                  <Badge key={a} variant="secondary" title={desc}>
                    {a}
                  </Badge>
                ))}
                {!Object.keys(t.attributes).length && <span className="text-muted-foreground text-xs">—</span>}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
