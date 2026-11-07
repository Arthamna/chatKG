import { History } from 'lucide-react'

import { Field, SelectField } from '@/components/common/Field'
import Input from '@/components/ui/Input'
import { groupIdFor, type KnowledgeGraph, type Version } from '@/lib/api'

export interface AskSettings {
  kg: string
  version: string
  topK: string
  pointInTime: string // datetime-local value
  model: string
}

interface QuerySettingsProps {
  value: AskSettings
  onChange: (v: AskSettings) => void
  kgs: KnowledgeGraph[]
  versions: Version[]
  hasDraft: boolean
  models: string[]
}

export default function QuerySettings({ value, onChange, kgs, versions, hasDraft, models }: QuerySettingsProps) {
  const set = <K extends keyof AskSettings>(k: K, v: AskSettings[K]) => onChange({ ...value, [k]: v })
  const versionOptions = [
    { value: 'latest', label: versions[0] ? `latest (v${versions[0].n})` : 'latest' },
    ...(hasDraft ? [{ value: 'draft', label: 'draft (belum di-commit)' }] : []),
    ...versions.map((v) => ({ value: `v${v.n}`, label: `v${v.n} · ${v.message.slice(0, 28)}` }))
  ]
  const resolved = value.version === 'latest' ? (versions[0] ? `v${versions[0].n}` : 'draft') : value.version
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="space-y-1">
        <h2 className="text-lg leading-7 font-semibold">Parameter</h2>
        <p className="text-body-text text-sm">Sumber & cara retrieval</p>
      </div>
      <SelectField label="Knowledge graph" value={value.kg} onChange={(v) => onChange({ ...value, kg: v, version: 'latest' })} options={kgs.map((k) => ({ value: k.id, label: k.name }))} />
      <SelectField label="Versi" value={value.version} onChange={(v) => set('version', v)} options={versionOptions} />
      <SelectField label="Top-K fakta" value={value.topK} onChange={(v) => set('topK', v)} options={['5', '10', '20', '50'].map((v) => ({ value: v, label: v }))} />
      <SelectField label="Model jawaban" value={value.model} onChange={(v) => set('model', v)} options={models.map((m) => ({ value: m, label: m }))} />
      <Field label="Point-in-time (opsional)">
        <Input
          type="datetime-local"
          value={value.pointInTime}
          onChange={(e) => set('pointInTime', e.target.value)}
          aria-describedby="point-in-time-help"
          className="w-full"
        />
        <p id="point-in-time-help" className="text-muted-foreground text-xs leading-5">
          Kosongkan untuk kondisi terkini, atau pilih waktu agar jawaban hanya memakai fakta yang berlaku saat itu.
        </p>
      </Field>
      <SelectField label="Model jawaban" value={value.model} onChange={(v) => set('model', v)} options={models.map((m) => ({ value: m, label: m }))} />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={value.includeInvalid} onCheckedChange={(v) => set('includeInvalid', v === true)} /> Sertakan fakta yang sudah invalid
      </label>
    </div>
  )
}
