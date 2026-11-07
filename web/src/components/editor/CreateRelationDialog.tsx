import { useEffect, useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import { Field, SelectField } from '@/components/common/Field'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import type { GraphData, GraphNodeData } from '@/lib/graph'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: GraphNodeData
  graph: GraphData
  busy?: boolean
  onCreate: (direction: 'out' | 'in', target: string, name: string, fact: string) => void
}

export default function CreateRelationDialog({ open, onOpenChange, node, graph, busy, onCreate }: Props) {
  const candidates = useMemo(() => graph.nodes.filter((item) => item.id !== node.id), [graph.nodes, node.id])
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [target, setTarget] = useState('')
  const [name, setName] = useState('RELATED_TO')
  const [fact, setFact] = useState('')

  useEffect(() => {
    if (!open) return
    setDirection('out')
    setTarget(candidates[0]?.id ?? '')
    setName('RELATED_TO')
    setFact('')
  }, [open, candidates])

  const targetNode = candidates.find((item) => item.id === target)
  const path = direction === 'out'
    ? `${node.label} → ${targetNode?.label ?? '…'}`
    : `${targetNode?.label ?? '…'} → ${node.label}`

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Hubungkan node"
      description="Relasi manual ditambahkan ke draft dan dapat ditinjau sebelum commit."
      confirmLabel={busy ? 'Menghubungkan…' : 'Tambah relasi'}
      confirmIcon={<Link2 />}
      confirmDisabled={busy || !targetNode || !name.trim() || !fact.trim()}
      onConfirm={() => onCreate(direction, target, name.trim(), fact.trim())}
    >
      <SelectField
        label="Arah"
        value={direction}
        onChange={(value) => setDirection(value as 'out' | 'in')}
        options={[
          { value: 'out', label: `${node.label} → node lain` },
          { value: 'in', label: `Node lain → ${node.label}` }
        ]}
      />
      <SelectField
        label="Node lain"
        value={target}
        onChange={setTarget}
        options={candidates.map((item) => ({ value: item.id, label: `${item.label} · ${item.type}` }))}
      />
      <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">{path}</p>
      <Field label="Nama relasi">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="MIS. RESPONSIBLE_FOR" className="w-full" />
      </Field>
      <Field label="Fakta">
        <Textarea value={fact} onChange={(event) => setFact(event.target.value)} rows={3} placeholder="Jelaskan hubungan kedua node." />
      </Field>
    </ConfirmDialog>
  )
}
