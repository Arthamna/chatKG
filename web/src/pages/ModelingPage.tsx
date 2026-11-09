import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'

import PageHeader from '@/components/layout/PageHeader'
import Stepper from '@/components/layout/Stepper'
import SchemaEditor from '@/components/modeling/SchemaEditor'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import Textarea from '@/components/ui/Textarea'
import { useApi } from '@/hooks/useApi'
import { api, errorText, type Ontology, type SchemaProposal } from '@/lib/api'
import { when } from '@/lib/time'

export default function ModelingPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const kg = params.get('kg') ?? ''
  const source = params.get('source') ?? ''
  const requestedJob = params.get('job') ?? ''
  const [jobId, setJobId] = useState(requestedJob)
  const [proposal, setProposal] = useState<SchemaProposal | null>(null)
  const [ontology, setOntology] = useState<Ontology | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [instructions, setInstructions] = useState('')
  const schemaForm = useRef<HTMLFormElement>(null)
  const health = useApi(() => api.health(), [])
  const job = useApi(() => api.getJob(jobId), [jobId], !!jobId)
  const active = starting || (!!jobId && job.data?.id !== jobId) ||
    (!!job.data && ['queued', 'running', 'retrying', 'waiting_quota'].includes(job.data.status))

  useEffect(() => {
    if (!kg || !source) return
    let disposed = false
    setProposal(null)
    setOntology(null)
    setError('')
    setJobId(requestedJob)
    if (requestedJob) return () => { disposed = true }
    setStarting(true)
    api.sourceSchema(kg, source).then((p) => {
      if (disposed) return
      if (!p) { setError('Belum ada hasil AI. Mulai pemetaan dari halaman Upload chat.'); return }
      setProposal(p)
      setOntology(p.ontology)
      setInstructions(p.extraction_instructions ?? '')
    }).catch((e) => { if (!disposed) setError(errorText(e)) })
      .finally(() => { if (!disposed) setStarting(false) })
    return () => { disposed = true }
  }, [kg, requestedJob, source])

  const { reload } = job
  useEffect(() => {
    if (!active || !jobId) return
    const timer = setInterval(() => void reload(), 2000)
    return () => clearInterval(timer)
  }, [active, jobId, reload])

  useEffect(() => {
    if (job.data?.status !== 'done' || job.data.id !== jobId) return
    let disposed = false
    api.sourceSchema(kg, source).then((p) => {
      if (disposed) return
      if (!p) { setError('Source berubah. Petakan ulang untuk membaca mapping terbaru.'); return }
      setProposal(p)
      setOntology(p.ontology)
      setInstructions(p.extraction_instructions ?? '')
    }).catch((e) => { if (!disposed) setError(errorText(e)) })
    return () => { disposed = true }
  }, [job.data?.id, job.data?.status, jobId, kg, source])

  const regenerate = async () => {
    setError('')
    setStarting(true)
    try {
      const j = await api.startSchemaJob(
        kg,
        source,
        proposal?.model ?? job.data?.model ?? health.data?.llm_model ?? '',
        true
      )
      setProposal(null)
      setOntology(null)
      setJobId(j.id)
    } catch (e) { setError(errorText(e)) }
    finally { setStarting(false) }
  }

  const extract = async () => {
    if (!proposal || !ontology) return
    if (!schemaForm.current?.reportValidity()) return
    setBusy(true)
    setError('')
    try {
      const unchanged = JSON.stringify(ontology) === JSON.stringify(proposal.ontology) &&
        instructions.trim() === (proposal.extraction_instructions ?? '')
      const saved = unchanged
        ? proposal : await api.saveSchema(kg, source, proposal.revision, ontology, instructions)
      setProposal(saved)
      const j = await api.startJob(kg, source, saved.revision)
      navigate(`/upload/run?kg=${encodeURIComponent(kg)}&job=${j.id}`)
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }

  return <div className="workspace-page flex min-h-full flex-col gap-6">
    <PageHeader eyebrow="Impor percakapan" title="Tinjau hasil AI" description="Tipe dipetakan dari isi chat. Koreksi sebelum LLM mengekstrak seluruh percakapan.">
      <Stepper active={1} />
    </PageHeader>
    {!source && <p className="text-warning">Belum ada file. Mulai dari Upload chat.</p>}
    {(error || job.error || job.data?.error) && <p role="alert" className="bg-destructive-subtle text-destructive rounded-md p-3 text-sm">{error || job.error || job.data?.error}</p>}
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1">
        {active || (!!jobId && !job.data) ? <Card className="flex items-center gap-3 p-6">
          <LoaderCircle className="size-5 animate-spin" />
          <div><p className="font-medium">{job.data?.status === 'waiting_quota' ? 'Menunggu kuota model gratis' : job.data?.status === 'retrying' ? `Respons terpotong, akan mencoba lagi (${job.data.retry_attempt}/${job.data.retry_max})` : 'AI sedang memetakan tipe entitas dan relasi…'}</p>
            <p className="text-muted-foreground text-sm">{job.data?.resume_at ? `Dilanjutkan otomatis ${when(job.data.resume_at)}. ` : ''}Proses tetap berjalan saat halaman ditutup.</p></div>
        </Card> : ontology && proposal ? <SchemaEditor value={ontology} baseline={proposal.baseline} onChange={setOntology} formRef={schemaForm} /> :
          <Card className="p-6 text-sm text-muted-foreground">Hasil pemetaan akan muncul di sini. Jika proses gagal, periksa konfigurasi lalu petakan ulang.</Card>}
      </div>
      <Card className="h-fit space-y-4 p-6 lg:w-80 lg:shrink-0">
        <CardTitle>Ekstraksi dengan LLM</CardTitle>
        <p className="text-sm">{health.data?.llm_provider ?? '…'} · {proposal?.model ?? job.data?.model ?? health.data?.llm_model ?? '…'}</p>
        <CardDescription>{proposal ? `${proposal.sampled_episodes} episode disampel untuk pemetaan. ` : ''}
          Ekstraksi Knowledge Base dengan bantuan LLM Tipe yang tidak muncul di sampel bisa ditambahkan di sini.</CardDescription>
        <p className="text-muted-foreground text-sm">Tinjau dan edit hasil graph sebelum membuat Knowledge Graph akhir</p>
        <div className="space-y-1.5">
          <label htmlFor="extraction-instructions" className="text-sm font-medium">Instruksi tambahan ekstraksi (opsional)</label>
          <Textarea
            id="extraction-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value.slice(0, 4000))}
            rows={5}
            placeholder="Contoh: abaikan pembahasan proyek lama."
            disabled={!proposal || active || busy}
          />
          <p className="text-muted-foreground text-xs">Ditambahkan tanpa mengganti aturan keselamatan dan waktu bawaan · {instructions.length}/4000</p>
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="sm" disabled={active || busy || !source} onClick={regenerate}><RefreshCw /> Petakan ulang</Button>
          {active && jobId && <Button variant="outline" size="sm" onClick={async () => {
            try { await api.cancelJob(jobId); await reload() } catch (e) { setError(errorText(e)) }
          }}>Batalkan pemetaan</Button>}
          <Button size="sm" disabled={!ontology?.entity_types.length || !proposal || active || busy || !health.data?.llm} onClick={extract}><Sparkles /> {busy ? 'Memulai…' : 'Setujui & ekstrak'}</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/upload?kg=${encodeURIComponent(kg)}`)}>Kembali ke upload</Button>
        </div>
      </Card>
    </div>
  </div>
}
