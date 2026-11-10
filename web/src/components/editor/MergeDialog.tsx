import { useEffect, useMemo, useState } from 'react'
import { GitMerge } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import { Field, SelectField } from '@/components/common/Field'
import Badge from '@/components/ui/Badge'
import Input from '@/components/ui/Input'
import { typeColor, type GraphData, type GraphNodeData } from '@/lib/graph'

interface MergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: GraphNodeData
  graph: GraphData
  busy?: boolean
  onMerge: (targetId: string, name: string, summaryMode: string) => void
}

const degree = (g: GraphData, id: string) => g.edges.filter((e) => e.source === id || e.target === id).length

export default function MergeDialog({ open, onOpenChange, source, graph, busy, onMerge }: MergeDialogProps) {
  const candidates = useMemo(() => {
    const others = graph.nodes.filter((n) => n.id !== source.id)
    // Same type first, then the rest.
    return [...others.filter((n) => n.type === source.type), ...others.filter((n) => n.type !== source.type)]
  }, [graph, source])
  const [target, setTarget] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState('concat')

  useEffect(() => {
    if (!open) return
    setTarget(candidates[0]?.id ?? '')
    setName(candidates[0]?.label ?? '')
  }, [open, candidates])

  const moved = degree(graph, source.id)
  const targetNode = candidates.find((c) => c.id === target)

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Gabungkan entitas"
      description="Relasi dari entitas sumber dipindahkan ke target; sumber dihapus dari draft."
      confirmLabel={busy ? 'Menggabungkan…' : 'Gabungkan'}
      confirmIcon={<GitMerge />}
      confirmDisabled={busy || !targetNode || !name.trim()}
      onConfirm={() => onMerge(target, name.trim(), mode)}
    >
      <Field label="Sumber">
        <div className="flex items-center gap-2.5 rounded-md border p-3">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: typeColor(source.type) }} />
          <span className="text-sm font-medium">{source.label}</span>
          <Badge variant="secondary" className="ml-auto">
            {moved} relasi
          </Badge>
        </div>
      </Field>
      {candidates.length ? (
        <SelectField
          label="Target"
          value={target}
          onChange={(v) => {
            setTarget(v)
            setName(candidates.find((c) => c.id === v)?.label ?? '')
          }}
          options={candidates.map((c) => ({ value: c.id, label: `${c.label} · ${c.type} (${degree(graph, c.id)} relasi)` }))}
        />
      ) : (
        <p className="text-muted-foreground text-sm">Tidak ada entitas lain di graph ini.</p>
      )}
      <Field label="Nama hasil">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
      </Field>
      <SelectField
        label="Ringkasan"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'concat', label: 'Gabungkan kedua ringkasan' },
          { value: 'target', label: 'Pakai ringkasan target' }
        ]}
      />
      {targetNode && (
        <p className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md p-3 text-sm">
          <GitMerge className="size-4" /> {moved} relasi dipindah · 1 node dihapus
          {targetNode.type !== source.type && ` · tipe berbeda (${source.type} → ${targetNode.type})`}
        </p>
      )}
    </ConfirmDialog>
  )
}
