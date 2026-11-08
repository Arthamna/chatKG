import { useState } from 'react'
import { ArrowRight, Database } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'

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
  onCreate: (kg: { id: string; name: string; description: string }) => void
}

/** A2 — "Buat knowledge graph": name, description, group_id preview. */
export default function NewKgDialog({ open, onOpenChange, busy, onCreate }: NewKgDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buat knowledge graph"
      description="KG baru dimulai kosong. Data pertama masuk lewat Upload chat ke draft, lalu di-commit sebagai v1."
      confirmLabel={busy ? 'Membuat…' : 'Buat & upload chat'}
      confirmIcon={<ArrowRight />}
      confirmDisabled={busy || !name.trim()}
      onConfirm={() => onCreate({ id: slug(name), name: name.trim(), description })}
    >
      <label className="block space-y-2">
        <span className="text-sm font-medium">Nama</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Tugas Kuliah" className="w-full" />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Deskripsi</span>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opsional" rows={3} />
      </label>
    </ConfirmDialog>
  )
}
