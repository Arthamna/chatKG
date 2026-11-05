import { Plus, Trash2 } from 'lucide-react'

import { Field, SelectField } from '@/components/common/Field'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import type { Ontology, SchemaAttribute } from '@/lib/api'

interface Props {
  value: Ontology
  baseline: Ontology
  onChange: (value: Ontology) => void
}
type Relation = { name: string; description: string; source: string; target: string }

function nextName(prefix: string, used: string[]) {
  let index = 1
  while (used.includes(`${prefix}${index}`)) index++
  return `${prefix}${index}`
}

export default function SchemaEditor({ value, baseline, onChange }: Props) {
  const setEntities = (entity_types: Ontology['entity_types']) => onChange({ ...value, entity_types })
  const relations: Relation[] = value.edge_type_map.flatMap((m) => m.relations.map((name) => ({
    name, source: m.source, target: m.target,
    description: value.edge_types.find((t) => t.name === name)?.description ?? ''
  })))
  const setRelations = (rows: Relation[]) => {
    const types = new Map<string, string>()
    const pairs = new Map<string, Ontology['edge_type_map'][number]>()
    for (const r of rows) {
      types.set(r.name, r.description)
      const key = JSON.stringify([r.source, r.target])
      const pair = pairs.get(key) ?? { source: r.source, target: r.target, relations: [] }
      if (!pair.relations.includes(r.name)) pair.relations.push(r.name)
      pairs.set(key, pair)
    }
    onChange({ ...value, edge_types: [...types].map(([name, description]) => ({ name, description })), edge_type_map: [...pairs.values()] })
  }
  const renameEntity = (index: number, name: string) => {
    if (value.entity_types.some((t, i) => i !== index && t.name === name)) return
    const old = value.entity_types[index].name
    onChange({ ...value,
      entity_types: value.entity_types.map((t, i) => i === index ? { ...t, name } : t),
      edge_type_map: value.edge_type_map.map((m) => ({ ...m, source: m.source === old ? name : m.source, target: m.target === old ? name : m.target }))
    })
  }
  const updateAttribute = (index: number, attribute: number, patch: Partial<SchemaAttribute>) => {
    if (patch.name && value.entity_types[index].attributes.some((a, j) => j !== attribute && a.name === patch.name)) return
    setEntities(value.entity_types.map((t, i) => i === index ? {
      ...t, attributes: t.attributes.map((a, j) => j === attribute ? { ...a, ...patch } : a)
    } : t))
  }
  const names = value.entity_types.filter((t) => t.name).map((t) => ({ value: t.name, label: t.name }))

  return <div className="space-y-5">
    <Card className="space-y-4 p-6">
      <CardTitle>Tipe entitas</CardTitle>
      <CardDescription>Koreksi hasil AI sebelum ekstraksi. Identitas tipe dan atribut lama dikunci agar data KG tetap konsisten.</CardDescription>
      {value.entity_types.map((t, index) => {
        const old = baseline.entity_types.find((e) => e.name === t.name)
        return <div key={index} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1"><Field label="Nama tipe"><Input aria-label={`Nama tipe ${index + 1}`} className="w-full" value={t.name} disabled={!!old} onChange={(e) => renameEntity(index, e.target.value)} /></Field></div>
            <Button variant="ghost" size="icon" tooltip="Hapus tipe" disabled={!!old} onClick={() => {
              const remaining = relations.filter((r) => r.source !== t.name && r.target !== t.name)
              const used = new Set(remaining.map((r) => r.name))
              onChange({ ...value, entity_types: value.entity_types.filter((_, i) => i !== index),
                edge_types: value.edge_types.filter((r) => used.has(r.name)),
                edge_type_map: value.edge_type_map.filter((m) => m.source !== t.name && m.target !== t.name)
              })
            }}><Trash2 /></Button>
          </div>
          <Field label="Deskripsi"><Input aria-label={`Deskripsi ${t.name}`} className="w-full" value={t.description} onChange={(e) => setEntities(value.entity_types.map((x, i) => i === index ? { ...x, description: e.target.value } : x))} /></Field>
          {t.attributes.map((a, j) => {
            const locked = old?.attributes.some((x) => x.name === a.name)
            return <div key={j} className="grid items-end gap-2 sm:grid-cols-[1fr_140px_2fr_auto]">
              <Field label="Atribut"><Input aria-label={`Atribut ${j + 1} ${t.name}`} className="w-full" disabled={locked} value={a.name} onChange={(e) => updateAttribute(index, j, { name: e.target.value })} /></Field>
              {locked ? <Field label="Tipe"><Input className="w-full" disabled value={a.type} /></Field> : <SelectField label="Tipe atribut" value={a.type} onChange={(type) => updateAttribute(index, j, { type: type as SchemaAttribute['type'] })} options={['string', 'integer', 'number', 'boolean', 'datetime'].map((type) => ({ value: type, label: type }))} />}
              <Field label="Deskripsi atribut"><Input aria-label={`Deskripsi atribut ${a.name}`} className="w-full" value={a.description} onChange={(e) => updateAttribute(index, j, { description: e.target.value })} /></Field>
              <Button variant="ghost" size="icon" tooltip="Hapus atribut" disabled={locked} onClick={() => setEntities(value.entity_types.map((x, i) => i === index ? { ...x, attributes: x.attributes.filter((_, k) => k !== j) } : x))}><Trash2 /></Button>
            </div>
          })}
          <Button variant="outline" size="sm" onClick={() => setEntities(value.entity_types.map((x, i) => i === index ? { ...x, attributes: [...x.attributes, { name: nextName('attribute_', x.attributes.map((a) => a.name)), type: 'string', description: '' }] } : x))}><Plus /> Atribut</Button>
        </div>
      })}
      <Button variant="outline" size="sm" onClick={() => setEntities([...value.entity_types, { name: nextName('NewType', value.entity_types.map((t) => t.name)), description: '', attributes: [] }])}><Plus /> Tambah tipe</Button>
    </Card>

    <Card className="space-y-4 p-6">
      <CardTitle>Tipe relasi</CardTitle>
      <CardDescription>Tentukan arah hubungan dan tipe entitas yang boleh dihubungkan.</CardDescription>
      {relations.map((r, index) => {
        const lockedName = baseline.edge_types.some((e) => e.name === r.name)
        const lockedPair = baseline.edge_type_map.some((m) => m.source === r.source && m.target === r.target && m.relations.includes(r.name))
        const update = (patch: Partial<Relation>) => setRelations(relations.map((x, i) => {
          if (i === index) return { ...x, ...patch }
          return x.name === r.name ? { ...x, ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.description === undefined ? {} : { description: patch.description }) } : x
        }))
        return <div key={index} className="space-y-3 rounded-lg border p-4">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            {lockedPair ? <Field label="Sumber"><Input className="w-full" disabled value={r.source} /></Field> : <SelectField label="Sumber" value={r.source} options={names} onChange={(source) => update({ source })} />}
            <Field label="Relasi"><Input className="w-full" aria-label={`Relasi ${index + 1}`} disabled={lockedName} value={r.name} onChange={(e) => update({ name: e.target.value })} /></Field>
            {lockedPair ? <Field label="Target"><Input className="w-full" disabled value={r.target} /></Field> : <SelectField label="Target" value={r.target} options={names} onChange={(target) => update({ target })} />}
            <Button variant="ghost" size="icon" tooltip="Hapus pasangan relasi" disabled={lockedPair} onClick={() => setRelations(relations.filter((_, i) => i !== index))}><Trash2 /></Button>
          </div>
          <Field label="Deskripsi relasi"><Input className="w-full" value={r.description} onChange={(e) => update({ description: e.target.value })} /></Field>
          <Button variant="ghost" size="sm" onClick={() => setRelations([...relations, { ...r, source: names[0]?.value ?? '', target: names.find((n) => n.value !== r.target)?.value ?? r.target }])}><Plus /> Pasangan lain</Button>
        </div>
      })}
      <Button variant="outline" size="sm" disabled={!names.length} onClick={() => setRelations([...relations, { name: nextName('RELATION_', value.edge_types.map((r) => r.name)), description: '', source: names[0]?.value ?? '', target: names[1]?.value ?? names[0]?.value ?? '' }])}><Plus /> Tambah relasi</Button>
    </Card>

    <Card className="space-y-3 p-6">
      <CardTitle>Kamus singkatan</CardTitle>
      {Object.entries(value.glossary).map(([key, description], index) => <div key={index} className="flex gap-2">
        <Input aria-label="Singkatan" value={key} onChange={(e) => onChange({ ...value, glossary: Object.fromEntries(Object.entries(value.glossary).map(([k, v], i) => [i === index ? e.target.value : k, v])) })} />
        <Input aria-label={`Arti ${key}`} className="min-w-0 flex-1" value={description} onChange={(e) => onChange({ ...value, glossary: { ...value.glossary, [key]: e.target.value } })} />
        <Button variant="ghost" size="icon" tooltip="Hapus singkatan" onClick={() => onChange({ ...value, glossary: Object.fromEntries(Object.entries(value.glossary).filter(([k]) => k !== key)) })}><Trash2 /></Button>
      </div>)}
      <Button variant="outline" size="sm" onClick={() => onChange({ ...value, glossary: { ...value.glossary, [nextName('singkatan_', Object.keys(value.glossary))]: '' } })}><Plus /> Singkatan</Button>
    </Card>
  </div>
}
