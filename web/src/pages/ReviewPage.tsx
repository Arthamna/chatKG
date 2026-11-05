import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, CircleAlert, Database, GitCommitHorizontal } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/layout/PageHeader'
import Stepper from '@/components/layout/Stepper'
import GraphCanvas from '@/components/graph/GraphCanvas'
import ChangeRow from '@/components/review/ChangeRow'
import CommitDialog from '@/components/review/CommitDialog'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useApi } from '@/hooks/useApi'
import { useIsDark } from '@/hooks/useIsDark'
import { api, errorText, groupIdFor, type ChangeKind } from '@/lib/api'
import { viewToGraph } from '@/lib/graphView'

type TabKey = 'all' | 'node' | 'edge' | ChangeKind

/** A6 — review draft changes (+ A7 commit dialog). */
export default function ReviewPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const kg = params.get('kg') ?? ''
  const dark = useIsDark()
  const review = useApi(() => api.changes(kg), [kg], !!kg)
  const info = useApi(() => api.getKg(kg), [kg], !!kg)
  const draft = useApi(() => api.graph(kg, 'draft'), [kg, review.data], !!kg)
  const [tab, setTab] = useState<TabKey>('all')
  const [commitOpen, setCommitOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const items = useMemo(() => review.data?.items ?? [], [review.data])
  const visible = items.filter((c) => (tab === 'all' ? true : tab === 'node' || tab === 'edge' ? c.target === tab : c.kind === tab))
  const s = review.data?.summary ?? {}
  const conflicts = s.conflict ?? 0
  const next = `v${(info.data?.latest ?? 0) + 1}`
  const graph = useMemo(() => (draft.data ? viewToGraph(draft.data) : { nodes: [], edges: [] }), [draft.data])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      await review.reload()
    } catch (e) {
      toast.error('Gagal', { description: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 py-6 md:px-8">
      <PageHeader title="Review perubahan" description="Tolak yang salah, selesaikan konflik, lalu bekukan draft menjadi versi baru.">
        <Stepper active={2} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-4">
        <Check className="text-success size-4" />
        <span className="text-sm font-medium">
          Draft {groupIdFor(kg || 'kg', 'draft')} vs {review.data?.base ? `v${review.data.base}` : 'kosong'}
        </span>
        <div className="flex flex-wrap gap-2 md:ml-auto">
          <Badge variant="success">{s.add ?? 0} baru</Badge>
          <Badge variant="info">{s.modify ?? 0} diubah</Badge>
          <Badge variant="warning">{s.invalidate ?? 0} invalidated</Badge>
          {conflicts > 0 && <Badge variant="destructive">{conflicts} konflik</Badge>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 lg:flex-row">
        <Card className="flex min-w-0 flex-1 flex-col gap-3 p-4 md:p-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="max-w-full overflow-x-auto">
            <TabsList className="h-9 rounded-lg">
              <TabsTrigger value="all">Semua {items.length}</TabsTrigger>
              <TabsTrigger value="node">Node {s.node ?? 0}</TabsTrigger>
              <TabsTrigger value="edge">Relasi {s.edge ?? 0}</TabsTrigger>
              <TabsTrigger value="invalidate">Invalidated {s.invalidate ?? 0}</TabsTrigger>
              <TabsTrigger value="conflict">Konflik {conflicts}</TabsTrigger>
            </TabsList>
          </Tabs>
          {review.error && <p className="text-destructive text-sm">{review.error}</p>}
          <ul className="space-y-3">
            {visible.map((c) => (
              <ChangeRow
                key={c.id}
                change={c}
                busy={busy}
                onReject={() => act(() => api.rejectChange(kg, c.id), 'Perubahan ditolak')}
                onKeep={() => act(() => api.keepConflict(kg, c.uuid!), 'Konflik diselesaikan')}
              />
            ))}
            {!visible.length && !review.loading && <li className="text-muted-foreground py-8 text-center text-sm">Tidak ada perubahan di kategori ini.</li>}
          </ul>
        </Card>

        <div className="flex shrink-0 flex-col gap-5 lg:w-80 xl:w-[420px]">
          <Card className="flex h-[360px] flex-col gap-3 p-6 lg:h-auto lg:flex-1">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Preview draft</CardTitle>
              <CardDescription>Cincin hijau = baru · oranye = diubah · garis abu = fakta usang</CardDescription>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
              {graph.nodes.length ? (
                <GraphCanvas data={graph} dark={dark} edgeLabels camera={{ ratio: 1.15 }} />
              ) : (
                <p className="text-muted-foreground flex h-full items-center justify-center text-sm">Draft kosong</p>
              )}
            </div>
          </Card>

          <Card className="bg-card space-y-3 p-6 max-lg:sticky max-lg:bottom-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Siap di-commit</CardTitle>
              <Badge variant="outline">
                {info.data?.latest ? `v${info.data.latest}` : 'kosong'} → {next}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {items.length} perubahan · {graph.nodes.length} entitas, {graph.edges.length} fakta di draft
            </p>
            {conflicts > 0 && (
              <p className="text-warning flex gap-2 text-xs">
                <CircleAlert className="size-4 shrink-0" /> {conflicts} konflik belum diselesaikan; tetap ikut ter-commit bila dilanjutkan.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate(`/kg/${kg}/graph?version=draft`)}>
                Edit di Graph Editor
              </Button>
              <Button size="sm" disabled={!graph.nodes.length} onClick={() => setCommitOpen(true)}>
                <GitCommitHorizontal /> Commit sebagai {next}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <CommitDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        version={next}
        description="Draft dibekukan menjadi versi baru (salinan penuh). Versi lama tidak pernah diubah."
        defaultMessage="Ingest chat"
        showOpenEditor
        summary={
          <>
            <p className="flex gap-2.5">
              <Check className="text-success size-4 shrink-0" /> {s.add ?? 0} baru · {s.modify ?? 0} diubah · {s.invalidate ?? 0} invalidated
            </p>
            {conflicts > 0 && (
              <p className="flex gap-2.5">
                <CircleAlert className="text-warning size-4 shrink-0" /> {conflicts} konflik belum diselesaikan
              </p>
            )}
            <p className="flex gap-2.5">
              <Database className="text-muted-foreground size-4 shrink-0" /> Salinan penuh → {groupIdFor(kg || 'kg', next)}
            </p>
          </>
        }
        onCommit={async (message, openEditor) => {
          try {
            const v = await api.commit(kg, message, 'ingest')
            setCommitOpen(false)
            toast.success(`v${v.n} berhasil di-commit`, { description: `${v.nodes} entitas · ${v.edges} fakta di ${v.group_id}` })
            navigate(openEditor ? `/kg/${kg}/graph?version=v${v.n}` : '/kg')
          } catch (e) {
            toast.error('Commit gagal', { description: errorText(e) })
          }
        }}
      />
    </div>
  )
}
