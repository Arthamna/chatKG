import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import { Field } from '@/components/common/Field'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import type { GraphData, GraphEdgeData } from '@/lib/graph'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  edge: GraphEdgeData
  graph: GraphData
  busy?: boolean
  onSave: (name: string, fact: string) => void
}

export default function EditRelationDialog({ open, onOpenChange, edge, graph, busy, onSave }: Props) {
  const [name, setName] = useState(edge.label)
  const [fact, setFact] = useState(edge.fact ?? '')

  useEffect(() => {
    if (!open) return
    setName(edge.label)
    setFact(edge.fact ?? '')
  }, [open, edge])

  const source = graph.nodes.find((node) => node.id === edge.source)?.label ?? edge.source
  const target = graph.nodes.find((node) => node.id === edge.target)?.label ?? edge.target
  const unchanged = name.trim() === edge.label && fact.trim() === (edge.fact ?? '')

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit relasi"
      description={`${source} → ${target}. Perubahan hanya masuk ke draft.`}
      confirmLabel={busy ? 'Menyimpan…' : 'Simpan relasi'}
      confirmIcon={<Check />}
      confirmDisabled={busy || !name.trim() || !fact.trim() || unchanged}
      onConfirm={() => onSave(name.trim(), fact.trim())}
    >
      <Field label="Nama relasi">
        <Input value={name} onChange={(event) => setName(event.target.value)} className="w-full" />
      </Field>
      <Field label="Fakta">
        <Textarea value={fact} onChange={(event) => setFact(event.target.value)} rows={4} />
      </Field>
    </ConfirmDialog>
  )
}
