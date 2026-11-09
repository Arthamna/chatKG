import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import Button from '@/components/ui/Button'
import { useApi } from '@/hooks/useApi'
import { api, errorText, type JobStatus, type KnowledgeGraph } from '@/lib/api'
import { when } from '@/lib/time'

const activeStatuses: Partial<Record<JobStatus, string>> = {
  queued: 'Dalam antrean',
  running: 'Sedang berjalan',
  retrying: 'Mencoba lagi',
  waiting_quota: 'Menunggu kuota'
}

interface DeleteKgDialogProps {
  kg: KnowledgeGraph
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}

export default function DeleteKgDialog({ kg, busy, onOpenChange, onConfirm }: DeleteKgDialogProps) {
  const jobs = useApi(() => api.listJobs(kg.id), [kg.id])
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState('')
  const blockers = (jobs.data ?? []).filter((job) => activeStatuses[job.status])
  const { reload } = jobs

  useEffect(() => {
    const timer = setInterval(() => void reload(), 2000)
    return () => clearInterval(timer)
  }, [reload])

  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={`Hapus knowledge graph “${kg.name}”?`}
      description="Seluruh KG ini akan dihapus permanen."
      confirmLabel={busy ? 'Menghapus…' : 'Hapus knowledge graph'}
      confirmIcon={<Trash2 />}
      confirmVariant="destructive"
      confirmDisabled={busy || !!cancelling || !jobs.data || !!jobs.error || blockers.length > 0}
      onConfirm={async () => {
        await onConfirm()
        await reload()
      }}
    >
      {!jobs.data && !jobs.error && <p role="status" className="text-muted-foreground text-sm">Memeriksa proses AI…</p>}
      {jobs.error && <div role="alert" className="space-y-2 text-sm">
        <p className="text-destructive">Tidak bisa memeriksa proses AI: {jobs.error}</p>
        <Button variant="outline" size="sm" onClick={() => void reload()}>Coba lagi</Button>
      </div>}
      {cancelError && <p role="alert" className="text-destructive text-sm">{cancelError}</p>}
      {blockers.length > 0 && <section aria-label="Proses AI yang memblokir penghapusan" className="space-y-3">
        <p className="text-sm">Batalkan atau tunggu {blockers.length} proses AI berikut sebelum menghapus KG.</p>
        <ul className="max-h-64 space-y-3 overflow-y-auto">
          {blockers.map((job) => <li key={job.id} className="border-divider space-y-2 rounded-md border p-3 text-sm">
            <div>
              <p className="font-medium">{job.kind === 'schema' ? 'Pemetaan skema' : 'Ekstraksi chat'} · {activeStatuses[job.status]}</p>
              <p className="text-muted-foreground break-all text-xs">Job: {job.id} · Sumber: {job.source_id}</p>
            </div>
            {job.model && <p className="break-all">Model: {job.model}</p>}
            {job.status === 'waiting_quota' && job.waiting_reason && <p>Alasan: {job.waiting_reason}</p>}
            {job.resume_at && <p>Dilanjutkan otomatis {when(job.resume_at)}.</p>}
            <Button variant="outline" size="sm" disabled={busy || !!cancelling} onClick={async () => {
              setCancelling(job.id)
              setCancelError('')
              try {
                await api.cancelJob(job.id)
                await reload()
              } catch (e) {
                setCancelError(errorText(e))
              } finally {
                setCancelling(null)
              }
            }}>{cancelling === job.id ? 'Membatalkan…' : 'Batalkan proses'}</Button>
          </li>)}
        </ul>
      </section>}
      {jobs.data && !jobs.error && blockers.length === 0 && <p role="status" className="text-muted-foreground text-sm">Tidak ada proses AI aktif yang memblokir penghapusan.</p>}
    </ConfirmDialog>
  )
}
