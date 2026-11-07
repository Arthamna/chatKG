import { GitMerge, Pencil, Plus, Trash2 } from 'lucide-react'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { isStale, type GraphData, type GraphEdgeData, type GraphNodeData } from '@/lib/graph'

interface PropertiesViewProps {
  node: GraphNodeData
  graph: GraphData
  groupId: string
  readOnly?: boolean
  onEditProperty?: (key: string) => void
  onMerge?: () => void
  onDelete?: () => void
  onAddRelation?: () => void
  onEditRelation?: (edge: GraphEdgeData) => void
  className?: string
}

type Row = [label: string, value: string, editKey?: string]

function Rows({ rows, onEdit }: { rows: Row[]; onEdit?: (k: string) => void }) {
  return (
    <div className="bg-muted border-divider divide-divider divide-y rounded-md border">
      {rows.map(([k, v, editKey]) => (
        <div key={k + v} className="flex items-start gap-2 px-2 py-1.5 text-[13px]">
          <span className="text-body-text w-20 shrink-0 wrap-anywhere">{k}</span>
          <span className="min-w-0 flex-1 break-words">{v}</span>
          {editKey && onEdit && (
            <Button variant="ghost" size="icon" className="-my-1 size-6" tooltip={`Edit ${k}`} onClick={() => onEdit(editKey)}>
              <Pencil className="!size-3" />
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

const show = (v: unknown) => (typeof v === 'string' ? v : v == null ? '—' : JSON.stringify(v))

export default function PropertiesView({ node, graph, groupId, readOnly, onEditProperty, onMerge, onDelete, onAddRelation, onEditRelation, className }: PropertiesViewProps) {
  const edges = graph.edges.filter((e) => e.source === node.id || e.target === node.id)
  const edit = readOnly ? undefined : onEditProperty
  const props: Row[] = [
    ['name', node.label, 'name'],
    ['summary', node.summary || '—', 'summary'],
    ...Object.entries(node.props ?? {}).map(([k, v]) => [k, show(v), k] as Row)
  ]

  return (
    <div className={cn('flex flex-col gap-2 text-xs', className)}>
      <div className="flex items-center gap-1.5">
        <h3 className="pl-1 text-sm font-bold">Node</h3>
        {node.mark === 'add' && <Badge variant="success">baru</Badge>}
        {node.mark === 'mod' && <Badge variant="warning">diubah</Badge>}
        <div className="ml-auto flex gap-1.5">
          {!readOnly && (
            <>
              <Button variant="outline" size="icon" className="size-7" tooltip="Edit nama" side="bottom" onClick={() => onEditProperty?.('name')}>
                <Pencil />
              </Button>
              <Button variant="outline" size="icon" className="size-7" tooltip="Gabungkan entitas" side="bottom" onClick={onMerge}>
                <GitMerge />
              </Button>
              <Button variant="outline" size="icon" className="text-destructive size-7" tooltip="Hapus node" side="bottom" onClick={onDelete}>
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>
      <Rows
        rows={[
          ['id', node.id],
          ['labels', node.type],
          ['degree', String(edges.length)],
          ['group_id', groupId]
        ]}
      />
      <h3 className="pl-1 text-sm font-bold">Properties</h3>
      <Rows rows={props} onEdit={edit} />
      <div className="flex items-center gap-2 pl-1">
        <h3 className="text-sm font-bold">Relations</h3>
        {!readOnly && (
          <Button variant="outline" size="sm" className="ml-auto h-7" onClick={onAddRelation}>
            <Plus /> Hubungkan
          </Button>
        )}
      </div>
      {edges.length ? (
        <div className="bg-muted border-divider divide-divider divide-y rounded-md border">
          {edges.map((edge) => {
            const otherId = edge.source === node.id ? edge.target : edge.source
            const other = graph.nodes.find((item) => item.id === otherId)
            const direction = edge.source === node.id ? '→' : '←'
            return (
              <div key={edge.id} className="flex items-start gap-2 px-2 py-2 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{edge.label} {direction} {other?.label ?? otherId}{isStale(edge) ? ' (usang)' : ''}</p>
                  <p className="text-body-text mt-0.5 break-words">{edge.fact || '—'}</p>
                </div>
                {!readOnly && (
                  <Button variant="ghost" size="icon" className="-my-1 size-6" tooltip="Edit relasi" onClick={() => onEditRelation?.(edge)}>
                    <Pencil className="!size-3" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      ) : <p className="text-muted-foreground px-1">Tidak ada relasi.</p>}
      {edges.some((e) => e.source_quote) && (
        <>
          <h3 className="text-muted-foreground pl-1 text-sm font-bold tracking-wide">Sumber (episode)</h3>
          <div className="bg-code text-on-code max-h-40 overflow-y-auto rounded-md p-3 font-mono text-sm leading-5 whitespace-pre-wrap wrap-anywhere">
            {[...new Set(edges.map((e) => e.source_quote).filter(Boolean))].join('\n—\n')}
          </div>
        </>
      )}
    </div>
  )
}
