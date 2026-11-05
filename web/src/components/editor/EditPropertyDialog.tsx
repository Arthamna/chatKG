import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import Textarea from '@/components/ui/Textarea'

interface EditPropertyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entity: string
  entityType: string
  propKey: string
  current: string
  busy?: boolean
  onSave: (value: string) => void
}

/** B2 — edit one property of a draft entity (LightRAG PropertyEditDialog). */
export default function EditPropertyDialog({ open, onOpenChange, entity, entityType, propKey, current, busy, onSave }: EditPropertyDialogProps) {
  const [value, setValue] = useState(current)

  useEffect(() => {
    if (open) setValue(current)
  }, [open, current])

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit properti · ${propKey}`}
      description={`Entitas: ${entity} (${entityType}). Perubahan masuk ke draft.`}
      confirmLabel={busy ? 'Menyimpan…' : 'Simpan ke draft'}
      confirmIcon={<Check />}
      confirmDisabled={busy || !value.trim() || value === current}
      onConfirm={() => onSave(value.trim())}
      className="sm:max-w-[480px]"
    >
      <div className="space-y-2">
        <p className="text-sm font-medium">Nilai saat ini</p>
        <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm break-words">{current || '—'}</p>
      </div>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Nilai baru</span>
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={propKey === 'summary' ? 4 : 2} />
      </label>
      {propKey === 'name' && <p className="text-muted-foreground text-xs">Mengganti nama juga menghitung ulang embedding nama di CPU.</p>}
    </ConfirmDialog>
  )
}
