import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'

import PageHeader from '@/components/layout/PageHeader'
import Stepper from '@/components/layout/Stepper'
import SchemaEditor from '@/components/modeling/SchemaEditor'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import { useApi } from '@/hooks/useApi'
import { api, errorText, type Ontology, type SchemaProposal } from '@/lib/api'
import { when } from '@/lib/time'

export default function ModelingPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const kg = params.get('kg') ?? ''
  const source = params.get('source') ?? ''
  const [jobId, setJobId] = useState('')
  const [proposal, setProposal] = useState<SchemaProposal | null>(null)
  const [ontology, setOntology] = useState<Ontology | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const health = useApi(() => api.health(), [])
  const job = useApi(() => api.getJob(jobId), [jobId], !!jobId)
  const active = starting || (!!jobId && job.data?.id !== jobId) ||
    (!!job.data && ['queued', 'running', 'waiting_quota'].includes(job.data.status))

  useEffect(() => {
    if (!kg || !source) return
    let disposed = false
    setProposal(null)
    setOntology(null)
    setError('')
    setJobId('')
    setStarting(true)
    api.startSchemaJob(kg, source).then((j) => { if (!disposed) setJobId(j.id) })
      .catch((e) => { if (!disposed) setError(errorText(e)) })
      .finally(() => { if (!disposed) setStarting(false) })
    return () => { disposed = true }
  }, [kg, source])

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
    }).catch((e) => { if (!disposed) setError(errorText(e)) })
    return () => { disposed = true }
  }, [job.data?.id, job.data?.status, jobId, kg, source])

  const regenerate = async () => {
    setError('')
    setStarting(true)
    try {
      const j = await api.startSchemaJob(kg, source, true)
      setProposal(null)
      setOntology(null)
      setJobId(j.id)
    } catch (e) { setError(errorText(e)) }
    finally { setStarting(false) }
  }

  const extract = async () => {
    if (!proposal || !ontology) return
    setBusy(true)
    setError('')
    try {
      const saved = JSON.stringify(ontology) === JSON.stringify(proposal.ontology)
        ? proposal : await api.saveSchema(kg, source, proposal.revision, ontology)
      setProposal(saved)
      const j = await api.startJob(kg, source, saved.revision)
      navigate(`/upload/run?kg=${encodeURIComponent(kg)}&job=${j.id}`)
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }

  return <div className="flex min-h-full flex-col gap-5 px-4 py-6 md:px-8">
    <PageHeader title="Tinjau tipe hasil AI" description="Tipe dipetakan dari isi chat. Koreksi sebelum LLM mengekstrak seluruh percakapan.">
      <Stepper active={1} />
    </PageHeader>
    {!source && <p className="text-warning">Belum ada file. Mulai dari Upload chat.</p>}
    {(error || job.error || job.data?.error) && <p role="alert" className="bg-destructive-subtle text-destructive rounded-md p-3 text-sm">{error || job.error || job.data?.error}</p>}
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="min-w-0 flex-1">
        {active || (!!jobId && !job.data) ? <Card className="flex items-center gap-3 p-6">
          <LoaderCircle className="size-5 animate-spin" />
          <div><p className="font-medium">{job.data?.status === 'waiting_quota' ? 'Menunggu kuota model gratis' : 'AI sedang memetakan tipe entitas dan relasi…'}</p>
            <p className="text-muted-foreground text-sm">{job.data?.resume_at ? `Dilanjutkan otomatis ${when(job.data.resume_at)}. ` : ''}Proses tetap berjalan saat halaman ditutup.</p></div>
        </Card> : ontology && proposal ? <SchemaEditor value={ontology} baseline={proposal.baseline} onChange={setOntology} /> :
          <Card className="p-6 text-sm text-muted-foreground">Hasil pemetaan akan muncul di sini. Jika proses gagal, periksa konfigurasi lalu petakan ulang.</Card>}
      </div>
      <Card className="h-fit space-y-4 p-6 lg:w-80 lg:shrink-0">
        <CardTitle>Ekstraksi dengan LLM</CardTitle>
        <p className="text-sm">{health.data?.llm_provider ?? '…'} · {health.data?.llm_model ?? '…'}</p>
        <CardDescription>{proposal ? `${proposal.sampled_episodes} episode disampel untuk pemetaan. ` : ''}Tipe yang tidak muncul di sampel bisa ditambahkan di sini. Ekstraksi membaca seluruh episode.</CardDescription>
        <p className="text-muted-foreground text-sm">Hasil masuk ke draft. Tinjau graph sebelum commit menjadi versi baru.</p>
        <p className="text-muted-foreground text-xs">Model gratis mempunyai batas kuota. Aplikasi menunggu dan melanjutkan proses; model berbayar tidak dipilih otomatis.</p>
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
