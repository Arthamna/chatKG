import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CircleAlert, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/layout/PageHeader'
import Stepper from '@/components/layout/Stepper'
import EntityTypeTable from '@/components/modeling/EntityTypeTable'
import RelationTypeRow from '@/components/modeling/RelationTypeRow'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import { useApi } from '@/hooks/useApi'
import { api, errorText } from '@/lib/api'

/** A4 — Modeling (query model): the ontology and models the extraction will use. */
export default function ModelingPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const kg = params.get('kg') ?? ''
  const source = params.get('source') ?? ''
  const schema = useApi(() => api.schema(), [])
  const health = useApi(() => api.health(), [])
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      const job = await api.startJob(kg, source)
      navigate(`/upload/run?kg=${kg}&job=${job.id}`)
    } catch (e) {
      toast.error('Ekstraksi tidak bisa dimulai', { description: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const h = health.data
  const s = schema.data

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 py-6 md:px-8">
      <PageHeader title="Modeling — query model" description="Skema entitas & relasi yang diekstrak LLM (Graphiti entity_types / edge_types).">
        <Stepper active={1} />
      </PageHeader>

      {!source && <p className="bg-warning-subtle text-warning rounded-md px-4 py-2 text-sm">Belum ada file. Mulai dari langkah Upload chat.</p>}

      <div className="flex flex-1 flex-col gap-5 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <Card className="space-y-2 p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle className="text-base">Entity types</CardTitle>
                <CardDescription>Tiap tipe = model Pydantic; atribut diisi LLM saat ekstraksi</CardDescription>
              </div>
              <Badge variant="outline">ontologi bawaan</Badge>
            </div>
            {s ? <EntityTypeTable items={s.entity_types} /> : <p className="text-muted-foreground py-6 text-sm">{schema.error ?? 'Memuat…'}</p>}
          </Card>

          <Card className="space-y-3 p-6">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Relation types</CardTitle>
              <CardDescription>edge_type_map — pasangan tipe yang boleh dihubungkan</CardDescription>
            </div>
            <ul className="space-y-1">
              {s?.edge_type_map.flatMap((m) => m.relations.map((r) => <RelationTypeRow key={`${m.source}-${r}-${m.target}`} source={m.source} relation={r} target={m.target} />))}
            </ul>
          </Card>
        </div>

        <div className="flex shrink-0 flex-col gap-5 lg:w-80 xl:w-[400px]">
          <Card className="space-y-3 p-6">
            <CardTitle className="text-base">Model</CardTitle>
            <dl className="space-y-2 text-sm">
              {[
                ['Relasi, dedupe, ringkasan', h ? `Groq · ${h.groq_model}` : '…'],
                ['Prompt ringan', h ? `Groq · ${h.groq_small_model}` : '…'],
                ['Entitas', h ? (h.entity_extractor === 'gliner2' ? 'GLiNER2 · CPU lokal' : `Groq · ${h.groq_model}`) : '…'],
                ['Embedding', h ? `${h.embedding_model} · CPU` : '…'],
                ['Reranker', h ? (h.reranker_model ? `${h.reranker_model} · CPU` : 'tidak dipakai') : '…']
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">{k}</dt>
                  <dd className="font-medium break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {h && !h.groq && (
              <p className="bg-destructive-subtle text-destructive flex gap-2 rounded-md p-3 text-xs">
                <CircleAlert className="size-4 shrink-0" /> GROQ_API_KEY belum diisi di backend, jadi ekstraksi tidak bisa dijalankan.
              </p>
            )}
          </Card>

          <Card className="flex flex-1 flex-col gap-3 p-6">
            <CardTitle className="text-base">Kamus singkatan & instruksi</CardTitle>
            <ul className="space-y-1 text-sm">
              {s &&
                Object.entries(s.glossary).map(([k, v]) => (
                  <li key={k}>
                    <Badge variant="outline">{k}</Badge> <span className="text-muted-foreground">= {v}</span>
                  </li>
                ))}
            </ul>
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">Lihat instruksi ekstraksi</summary>
              <pre className="bg-muted mt-2 max-h-64 overflow-y-auto rounded-md p-2.5 font-mono whitespace-pre-wrap">{s?.instructions_template}</pre>
            </details>
            <p className="text-muted-foreground text-xs">Free tier Groq ≈ 20 episode/hari; worker menunggu otomatis saat kuota habis.</p>
            <div className="bg-card mt-auto flex justify-end gap-2 pt-2 max-lg:sticky max-lg:bottom-0 max-lg:py-3">
              <Button variant="outline" size="sm" onClick={() => navigate(`/upload?kg=${kg}`)}>
                Kembali
              </Button>
              <Button size="sm" disabled={!source || !kg || busy || !h?.groq} onClick={start}>
                <Sparkles /> {busy ? 'Memulai…' : 'Jalankan ekstraksi'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
