import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, CircleAlert, Clock, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/layout/PageHeader'
import Stepper from '@/components/layout/Stepper'
import GraphCanvas from '@/components/graph/GraphCanvas'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import Progress from '@/components/ui/Progress'
import { useApi } from '@/hooks/useApi'
import { useIsDark } from '@/hooks/useIsDark'
import { api, errorText, groupIdFor, type JobStatus } from '@/lib/api'
import { viewToGraph } from '@/lib/graphView'
import { when } from '@/lib/time'
import { cn } from '@/lib/utils'

const ACTIVE: JobStatus[] = ['queued', 'running', 'waiting_quota']
const STATUS: Record<JobStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  queued: { label: 'antre', variant: 'secondary' },
  running: { label: 'berjalan', variant: 'info' },
  waiting_quota: { label: 'menunggu kuota', variant: 'warning' },
  done: { label: 'selesai', variant: 'success' },
  failed: { label: 'gagal', variant: 'destructive' },
  cancelled: { label: 'dibatalkan', variant: 'secondary' }
}

/** A5 — extraction job progress (Graphiti → draft), polled every 2 s. */
export default function ExtractionPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const kg = params.get('kg') ?? ''
  const jobId = params.get('job') ?? ''
  const dark = useIsDark()

  const job = useApi(() => api.getJob(jobId), [jobId], !!jobId)
  const j = job.data
  const active = !!j && ACTIVE.includes(j.status)
  const { reload } = job

  useEffect(() => {
    if (!active) return
    const t = setInterval(() => void reload(), 2000)
    return () => clearInterval(t)
  }, [active, reload])

  const preview = useApi(() => api.graph(kg, 'draft'), [kg, j?.done, j?.status], !!kg)
  const graph = useMemo(() => (preview.data ? viewToGraph(preview.data) : { nodes: [], edges: [] }), [preview.data])

  const pct = j && j.total ? Math.round((j.done / j.total) * 100) : 0
  const st = j ? STATUS[j.status] : null

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 py-6 md:px-8">
      <PageHeader title="Ekstraksi" description={`Graphiti menulis ke draft ${groupIdFor(kg || 'kg', 'draft')}; kuota Groq diatur otomatis.`}>
        <Stepper active={2} />
      </PageHeader>

      {!jobId && <p className="bg-warning-subtle text-warning rounded-md px-4 py-2 text-sm">Tidak ada job. Mulai dari Upload chat.</p>}
      {job.error && <p className="bg-destructive-subtle text-destructive rounded-md px-4 py-2 text-sm">{job.error}</p>}

      <div className="flex flex-1 flex-col gap-5 lg:flex-row">
        <Card className="flex min-w-0 flex-1 flex-col gap-5 p-6">
          <div className="flex items-center gap-3">
            <span className="bg-muted rounded-full p-2">
              {j?.status === 'done' ? (
                <Check className="text-success size-5" />
              ) : j?.status === 'failed' ? (
                <CircleAlert className="text-destructive size-5" />
              ) : j?.status === 'waiting_quota' ? (
                <Clock className="text-warning size-5" />
              ) : (
                <LoaderCircle className="size-5 animate-spin" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">{j?.status === 'done' ? 'Ekstraksi selesai' : 'Mengekstrak entitas & relasi…'}</CardTitle>
              <CardDescription>{j ? `job ${j.id} · dibuat ${when(j.created_at)}` : 'Memuat…'}</CardDescription>
            </div>
            {st && <Badge variant={st.variant}>{st.label}</Badge>}
          </div>

          <div className="space-y-2" aria-live="polite">
            <Progress value={pct} />
            <div className="flex justify-between gap-2 text-xs">
              <span className="font-medium">
                {j?.done ?? 0} / {j?.total || '?'} episode
              </span>
              <span className="text-muted-foreground text-right">
                {j?.status === 'waiting_quota' && j.resume_at
                  ? `kuota Groq (${j.waiting_reason ?? 'limit'}) habis · lanjut otomatis ${when(j.resume_at)}`
                  : j?.status === 'done'
                    ? `selesai ${when(j.finished_at)}`
                    : j?.current ?? ''}
              </span>
            </div>
          </div>

          {j?.status === 'failed' && <p className="bg-destructive-subtle text-destructive rounded-md p-3 text-sm break-words">{j.error}</p>}

          <div className="flex flex-wrap gap-2">
            <Badge variant="success">{graph.nodes.length} entitas di draft</Badge>
            <Badge variant="success">{graph.edges.length} fakta di draft</Badge>
            {j?.last_episode && (
              <Badge variant="info">
                episode terakhir: {j.last_episode.nodes.length} entitas, {j.last_episode.edges.length} fakta
              </Badge>
            )}
          </div>

          <div className="flex min-h-48 flex-1 flex-col gap-2">
            <p className="text-sm font-semibold">Log</p>
            <ol className="bg-muted max-h-80 flex-1 space-y-1.5 overflow-y-auto rounded-lg p-4 font-mono text-xs">
              {(j?.log ?? []).map((line, i, all) => (
                <li key={i} className={cn(line.includes('gagal') ? 'text-destructive' : i === all.length - 1 && active ? 'text-foreground' : 'text-muted-foreground')}>
                  {line}
                </li>
              ))}
              {j?.last_episode?.edges.map((e) => (
                <li key={e} className="text-success">
                  + {e}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!active}
              onClick={async () => {
                try {
                  await api.cancelJob(jobId)
                  await reload()
                  toast('Job dibatalkan', { description: 'Episode yang sudah masuk tetap ada di draft.' })
                } catch (e) {
                  toast.error('Gagal membatalkan', { description: errorText(e) })
                }
              }}
            >
              Batalkan
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!active}
              onClick={() => {
                toast.info('Ekstraksi lanjut di background', { description: 'Buka lagi dari Upload atau cek di Graph Editor.' })
                navigate('/kg')
              }}
            >
              Jalankan di background
            </Button>
            <Button size="sm" disabled={j?.status !== 'done'} onClick={() => navigate(`/upload/review?kg=${kg}`)}>
              Lihat hasil <ArrowRight />
            </Button>
          </div>
        </Card>

        <Card className="flex h-[420px] shrink-0 flex-col gap-3 p-6 lg:h-auto lg:w-80 xl:w-[460px]">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Live preview</CardTitle>
            <CardDescription>Isi draft, diperbarui tiap episode selesai</CardDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
            {graph.nodes.length ? (
              <GraphCanvas data={graph} dark={dark} edgeLabels camera={{ ratio: 1.15 }} />
            ) : (
              <p className="text-muted-foreground flex h-full items-center justify-center text-sm">Belum ada entitas</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
