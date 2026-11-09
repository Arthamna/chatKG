import { Plus, Trash2 } from 'lucide-react'
import type { ComponentProps, RefObject } from 'react'

import { Field, SelectField } from '@/components/common/Field'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import type { Ontology, SchemaAttribute } from '@/lib/api'

interface Props {
  value: Ontology
  baseline: Ontology
  onChange: (value: Ontology) => void
  formRef: RefObject<HTMLFormElement | null>
}

type Relation = {
  name: string
  description: string
  source: string
  target: string
}

const ATTRIBUTE_TYPE_OPTIONS = ['string', 'integer', 'number', 'boolean', 'datetime'].map((type) => ({
  value: type,
  label: type,
}))

function RequiredInput(props: ComponentProps<typeof Input>) {
  return (
    <Input
      required
      maxLength={500}
      pattern={'.*\\S.*'}
      {...props}
      onInvalid={(event) => {
        const input = event.currentTarget
        input.setCustomValidity(
          input.validity.valueMissing
            ? 'Kolom ini wajib diisi.'
            : input.title || 'Isi kolom ini dengan teks, bukan hanya spasi.'
        )
      }}
      onInput={(event) => event.currentTarget.setCustomValidity('')}
    />
  )
}

function nextName(prefix: string, used: string[]) {
  let index = 1
  while (used.includes(`${prefix}${index}`)) index++
  return `${prefix}${index}`
}

export default function SchemaEditor({ value, baseline, onChange, formRef }: Props) {
  const relations: Relation[] = value.edge_type_map.flatMap((pair) =>
    pair.relations.map((name) => ({
      name,
      source: pair.source,
      target: pair.target,
      description: value.edge_types.find((type) => type.name === name)?.description ?? '',
    }))
  )
  const entityOptions = value.entity_types
    .filter((entity) => entity.name)
    .map((entity) => ({ value: entity.name, label: entity.name }))

  const addIfValid = (action: () => void) => {
    if (formRef.current?.reportValidity()) action()
  }

  const setEntities = (entities: Ontology['entity_types']) => {
    onChange({ ...value, entity_types: entities })
  }

  const addEntity = () => {
    addIfValid(() => setEntities([
      ...value.entity_types,
      {
        name: nextName('NewType', value.entity_types.map((entity) => entity.name)),
        description: '',
        attributes: [],
      },
    ]))
  }

  const renameEntity = (entityIndex: number, name: string) => {
    const nameExists = value.entity_types.some((entity, index) => index !== entityIndex && entity.name === name)
    if (nameExists) return

    const previousName = value.entity_types[entityIndex].name
    onChange({
      ...value,
      entity_types: value.entity_types.map((entity, index) =>
        index === entityIndex ? { ...entity, name } : entity
      ),
      edge_type_map: value.edge_type_map.map((pair) => ({
        ...pair,
        source: pair.source === previousName ? name : pair.source,
        target: pair.target === previousName ? name : pair.target,
      })),
    })
  }

  const updateEntityDescription = (entityIndex: number, description: string) => {
    setEntities(value.entity_types.map((entity, index) =>
      index === entityIndex ? { ...entity, description } : entity
    ))
  }

  const removeEntity = (entityIndex: number) => {
    const entityName = value.entity_types[entityIndex].name
    const remainingRelations = relations.filter((relation) =>
      relation.source !== entityName && relation.target !== entityName
    )
    const usedRelationNames = new Set(remainingRelations.map((relation) => relation.name))

    onChange({
      ...value,
      entity_types: value.entity_types.filter((_, index) => index !== entityIndex),
      edge_types: value.edge_types.filter((relation) => usedRelationNames.has(relation.name)),
      edge_type_map: value.edge_type_map.filter((pair) =>
        pair.source !== entityName && pair.target !== entityName
      ),
    })
  }

  const addAttribute = (entityIndex: number) => {
    addIfValid(() => setEntities(value.entity_types.map((entity, index) =>
      index === entityIndex ? {
        ...entity,
        attributes: [
          ...entity.attributes,
          {
            name: nextName('attribute_', entity.attributes.map((attribute) => attribute.name)),
            type: 'string',
            description: '',
          },
        ],
      } : entity
    )))
  }

  const updateAttribute = (
    entityIndex: number,
    attributeIndex: number,
    patch: Partial<SchemaAttribute>
  ) => {
    const nameExists = patch.name && value.entity_types[entityIndex].attributes.some((attribute, index) =>
      index !== attributeIndex && attribute.name === patch.name
    )
    if (nameExists) return

    setEntities(value.entity_types.map((entity, index) =>
      index === entityIndex ? {
        ...entity,
        attributes: entity.attributes.map((attribute, index) =>
          index === attributeIndex ? { ...attribute, ...patch } : attribute
        ),
      } : entity
    ))
  }

  const removeAttribute = (entityIndex: number, attributeIndex: number) => {
    setEntities(value.entity_types.map((entity, index) =>
      index === entityIndex ? {
        ...entity,
        attributes: entity.attributes.filter((_, index) => index !== attributeIndex),
      } : entity
    ))
  }

  const setRelations = (rows: Relation[]) => {
    const relationTypes = new Map<string, string>()
    const relationPairs = new Map<string, Ontology['edge_type_map'][number]>()

    for (const relation of rows) {
      relationTypes.set(relation.name, relation.description)
      const key = JSON.stringify([relation.source, relation.target])
      const pair = relationPairs.get(key) ?? {
        source: relation.source,
        target: relation.target,
        relations: [],
      }

      if (!pair.relations.includes(relation.name)) pair.relations.push(relation.name)
      relationPairs.set(key, pair)
    }

    onChange({
      ...value,
      edge_types: [...relationTypes].map(([name, description]) => ({ name, description })),
      edge_type_map: [...relationPairs.values()],
    })
  }

  const addRelation = () => {
    addIfValid(() => setRelations([
      ...relations,
      {
        name: nextName('RELATION_', value.edge_types.map((relation) => relation.name)),
        description: '',
        source: entityOptions[0]?.value ?? '',
        target: entityOptions[1]?.value ?? entityOptions[0]?.value ?? '',
      },
    ]))
  }

  const updateRelation = (relationIndex: number, patch: Partial<Relation>) => {
    const relationName = relations[relationIndex].name

    // A relation type shares its name and description across source/target pairs.
    setRelations(relations.map((relation, index) => {
      if (index === relationIndex) return { ...relation, ...patch }
      if (relation.name !== relationName) return relation

      return {
        ...relation,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
      }
    }))
  }

  const removeRelation = (relationIndex: number) => {
    setRelations(relations.filter((_, index) => index !== relationIndex))
  }

  const addRelationPair = (relationIndex: number) => {
    const relation = relations[relationIndex]

    addIfValid(() => setRelations([
      ...relations,
      {
        ...relation,
        source: entityOptions[0]?.value ?? '',
        target: entityOptions.find((option) => option.value !== relation.target)?.value ?? relation.target,
      },
    ]))
  }

  const addGlossaryEntry = () => {
    addIfValid(() => onChange({
      ...value,
      glossary: {
        ...value.glossary,
        [nextName('singkatan_', Object.keys(value.glossary))]: '',
      },
    }))
  }

  const renameGlossaryEntry = (entryIndex: number, name: string) => {
    onChange({
      ...value,
      glossary: Object.fromEntries(
        Object.entries(value.glossary).map(([key, description], index) => [
          index === entryIndex ? name : key,
          description,
        ])
      ),
    })
  }

  const updateGlossaryDescription = (key: string, description: string) => {
    onChange({ ...value, glossary: { ...value.glossary, [key]: description } })
  }

  const removeGlossaryEntry = (key: string) => {
    onChange({
      ...value,
      glossary: Object.fromEntries(
        Object.entries(value.glossary).filter(([entryKey]) => entryKey !== key)
      ),
    })
  }

  return (
    <form ref={formRef} className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <Card className="space-y-4 p-6">
        <CardTitle>Tipe entitas</CardTitle>
        <CardDescription>
          Semua kolom pada baris yang ditambahkan wajib diisi sebelum menambah baris lain atau menyetujui ekstraksi. Identitas tipe dan atribut lama dikunci agar data KG tetap konsisten.
        </CardDescription>
        <p className="text-muted-foreground text-xs">
          Nama tipe: huruf awal besar, tanpa spasi (contoh: AkuTestingTipe). Nama atribut: huruf kecil, angka, atau garis bawah, diawali huruf (contoh: harus_ada). Maksimal 64 karakter untuk nama dan 500 untuk deskripsi.
        </p>

        {value.entity_types.map((entity, entityIndex) => {
          const baselineEntity = baseline.entity_types.find((item) => item.name === entity.name)

          return (
            <div key={entityIndex} className="space-y-3 rounded-md border p-4">
              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  <Field label="Nama tipe">
                    <RequiredInput
                      maxLength={64}
                      pattern="[A-Z][a-zA-Z0-9]*"
                      title="Nama tipe harus diawali huruf besar dan hanya berisi huruf serta angka, tanpa spasi. Contoh: AkuTestingTipe."
                      aria-label={`Nama tipe ${entityIndex + 1}`}
                      className="w-full"
                      value={entity.name}
                      disabled={!!baselineEntity}
                      onChange={(event) => renameEntity(entityIndex, event.target.value)}
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tooltip={baselineEntity ? 'Kecualikan tipe dari ekstraksi ini' : 'Hapus tipe'}
                  onClick={() => removeEntity(entityIndex)}
                >
                  <Trash2 />
                </Button>
              </div>

              <Field label="Deskripsi">
                <RequiredInput
                  aria-label={`Deskripsi ${entity.name}`}
                  className="w-full"
                  value={entity.description}
                  onChange={(event) => updateEntityDescription(entityIndex, event.target.value)}
                />
              </Field>

              {entity.attributes.map((attribute, attributeIndex) => {
                const isAttributeLocked = baselineEntity?.attributes.some((item) => item.name === attribute.name)

                return (
                  <div
                    key={attributeIndex}
                    className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_minmax(0,2fr)_auto]"
                  >
                    <Field label="Atribut">
                      <RequiredInput
                        maxLength={64}
                        pattern="[a-z][a-z0-9_]*"
                        title="Nama atribut harus diawali huruf kecil dan hanya berisi huruf kecil, angka, atau garis bawah. Contoh: harus_ada."
                        aria-label={`Atribut ${attributeIndex + 1} ${entity.name}`}
                        className="w-full"
                        disabled={isAttributeLocked}
                        value={attribute.name}
                        onChange={(event) => updateAttribute(entityIndex, attributeIndex, { name: event.target.value })}
                      />
                    </Field>
                    {isAttributeLocked ? (
                      <Field label="Tipe">
                        <Input className="w-full" disabled value={attribute.type} />
                      </Field>
                    ) : (
                      <SelectField
                        label="Tipe atribut"
                        value={attribute.type}
                        onChange={(type) => updateAttribute(entityIndex, attributeIndex, { type: type as SchemaAttribute['type'] })}
                        options={ATTRIBUTE_TYPE_OPTIONS}
                      />
                    )}
                    <Field label="Deskripsi atribut">
                      <RequiredInput
                        aria-label={`Deskripsi atribut ${attribute.name}`}
                        className="w-full"
                        value={attribute.description}
                        onChange={(event) => updateAttribute(entityIndex, attributeIndex, { description: event.target.value })}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      tooltip={isAttributeLocked ? 'Kecualikan atribut dari ekstraksi ini' : 'Hapus atribut'}
                      onClick={() => removeAttribute(entityIndex, attributeIndex)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )
              })}

              <Button type="button" variant="outline" size="sm" onClick={() => addAttribute(entityIndex)}>
                <Plus /> Atribut
              </Button>
            </div>
          )
        })}

        <Button type="button" variant="outline" size="sm" onClick={addEntity}>
          <Plus /> Tambah tipe
        </Button>
      </Card>

      <Card className="space-y-4 p-6">
        <CardTitle>Tipe relasi</CardTitle>
        <CardDescription>Tentukan arah hubungan dan tipe entitas yang boleh dihubungkan.</CardDescription>
        <p className="text-muted-foreground text-xs">
          Nama relasi: huruf besar, angka, dan garis bawah antar kata, diawali huruf (contoh: BEKERJA_DI). Maksimal 64 karakter.
        </p>

        {relations.map((relation, relationIndex) => {
          const isRelationNameLocked = baseline.edge_types.some((type) => type.name === relation.name)
          const isRelationPairLocked = baseline.edge_type_map.some((pair) =>
            pair.source === relation.source &&
            pair.target === relation.target &&
            pair.relations.includes(relation.name)
          )

          return (
            <div key={relationIndex} className="space-y-3 rounded-md border p-4">
              <div className="grid items-end gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
                {isRelationPairLocked ? (
                  <Field label="Sumber">
                    <Input className="w-full" disabled value={relation.source} />
                  </Field>
                ) : (
                  <SelectField
                    label="Sumber"
                    value={relation.source}
                    options={entityOptions}
                    onChange={(source) => updateRelation(relationIndex, { source })}
                  />
                )}
                <Field label="Relasi">
                  <RequiredInput
                    maxLength={64}
                    pattern="[A-Z][A-Z0-9]*(_[A-Z0-9]+)*"
                    title="Nama relasi harus diawali huruf besar dan berisi huruf besar, angka, atau garis bawah antar kata. Contoh: BEKERJA_DI."
                    className="w-full"
                    aria-label={`Relasi ${relationIndex + 1}`}
                    disabled={isRelationNameLocked}
                    value={relation.name}
                    onChange={(event) => updateRelation(relationIndex, { name: event.target.value })}
                  />
                </Field>
                {isRelationPairLocked ? (
                  <Field label="Target">
                    <Input className="w-full" disabled value={relation.target} />
                  </Field>
                ) : (
                  <SelectField
                    label="Target"
                    value={relation.target}
                    options={entityOptions}
                    onChange={(target) => updateRelation(relationIndex, { target })}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  tooltip={isRelationPairLocked ? 'Kecualikan relasi dari ekstraksi ini' : 'Hapus pasangan relasi'}
                  onClick={() => removeRelation(relationIndex)}
                >
                  <Trash2 />
                </Button>
              </div>

              <Field label="Deskripsi relasi">
                <RequiredInput
                  aria-label={`Deskripsi relasi ${relation.name}`}
                  className="w-full"
                  value={relation.description}
                  onChange={(event) => updateRelation(relationIndex, { description: event.target.value })}
                />
              </Field>
              <Button type="button" variant="ghost" size="sm" onClick={() => addRelationPair(relationIndex)}>
                <Plus /> Pasangan lain
              </Button>
            </div>
          )
        })}

        <Button type="button" variant="outline" size="sm" disabled={!entityOptions.length} onClick={addRelation}>
          <Plus /> Tambah relasi
        </Button>
      </Card>

      <Card className="space-y-3 p-6">
        <CardTitle>Kamus singkatan</CardTitle>
        {Object.entries(value.glossary).map(([key, description], entryIndex) => (
          <div key={entryIndex} className="flex gap-2">
            <RequiredInput
              aria-label="Singkatan"
              className="w-1/3 min-w-0"
              value={key}
              onChange={(event) => renameGlossaryEntry(entryIndex, event.target.value)}
            />
            <RequiredInput
              aria-label={`Arti ${key}`}
              className="min-w-0 flex-1"
              value={description}
              onChange={(event) => updateGlossaryDescription(key, event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tooltip="Hapus singkatan"
              onClick={() => removeGlossaryEntry(key)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addGlossaryEntry}>
          <Plus /> Singkatan
        </Button>
      </Card>
    </form>
  )
}
