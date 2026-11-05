import { useState } from 'react'
import { ArrowRight, Database } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'

const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'kg-baru'

interface NewKgDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  onCreate: (kg: { id: string; name: string; description: string; template: string }) => void
}

/** A2 — "Buat knowledge graph": name, description, modeling template, group_id preview. */
export default function NewKgDialog({ open, onOpenChange, busy, onCreate }: NewKgDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState('meeting')

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buat knowledge graph"
      description="KG baru dimulai kosong. Data pertama masuk lewat Upload chat ke draft, lalu di-commit sebagai v1."
      confirmLabel={busy ? 'Membuat…' : 'Buat & upload chat'}
      confirmIcon={<ArrowRight />}
      confirmDisabled={busy || !name.trim()}
      onConfirm={() => onCreate({ id: slug(name), name: name.trim(), description, template })}
    >
      <label className="block space-y-2">
        <span className="text-sm font-medium">Nama</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Tugas Kuliah" className="w-full" />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Deskripsi</span>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opsional" rows={3} />
      </label>
      <div className="space-y-2">
        <span className="text-sm font-medium">Template modeling</span>
        <Select value={template} onValueChange={setTemplate}>
          <SelectTrigger aria-label="Template modeling">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="meeting">Chat kuliah / tim (ontologi bawaan)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md p-3 text-xs font-medium">
        <Database className="size-4" /> id: {slug(name)} · group_id draft: kg_{slug(name)}__draft
      </div>
    </ConfirmDialog>
  )
}
