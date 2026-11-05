import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { GitCommitHorizontal, History, Network, Pencil, Plus, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/layout/PageHeader'
import StatCard from '@/components/kg/StatCard'
import KgTable from '@/components/kg/KgTable'
import NewKgDialog from '@/components/kg/NewKgDialog'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { api, errorText } from '@/lib/api'
import { fmt } from '@/lib/utils'

type Filter = 'all' | 'draft' | 'empty'

/** A1 — Knowledge Graphs (+ A2 dialog). */
export default function KnowledgeGraphsPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [, setCurrentKg] = useCurrentKg()
  const kgs = useApi(() => api.listKgs(), [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const all = useMemo(() => kgs.data ?? [], [kgs.data])
  const items = useMemo(
    () =>
      all.filter((kg) => {
        if (query && !`${kg.name} ${kg.description} ${kg.id}`.toLowerCase().includes(query.toLowerCase())) return false
        if (filter === 'draft') return kg.has_draft
        if (filter === 'empty') return !kg.latest && !kg.stats.nodes
        return true
      }),
    [all, query, filter]
  )
  const pick = params.get('pick')

  return (
    <div className="space-y-6 px-4 py-6 md:px-8">
      <PageHeader title="Knowledge Graphs" description="Setiap KG berisi pengetahuan hasil ekstraksi chat beserta riwayat versinya.">
        <Button variant="outline" size="sm" onClick={() => navigate('/upload')}>
          <Upload /> Upload chat
        </Button>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus /> KG baru
        </Button>
      </PageHeader>

      {pick && all.length > 0 && (
        <p className="bg-info-subtle text-info rounded-md px-4 py-2 text-sm">Pilih KG dulu untuk membuka {pick === 'graph' ? 'Graph Editor' : 'riwayat versi'}.</p>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Knowledge graphs" value={fmt(all.length)} sub={`${all.filter((k) => k.latest).length} punya versi`} icon={Network} />
        <StatCard label="Versi tersimpan" value={fmt(all.reduce((s, k) => s + k.latest, 0))} sub="salinan penuh per versi di Neo4j" icon={History} />
        <StatCard
          label="Entitas (terkini)"
          value={fmt(all.reduce((s, k) => s + k.stats.nodes, 0))}
          sub={`${fmt(all.reduce((s, k) => s + k.stats.edges, 0))} fakta`}
          icon={GitCommitHorizontal}
        />
        <StatCard label="Draft aktif" value={fmt(all.filter((k) => k.has_draft).length)} sub={all.filter((k) => k.has_draft).map((k) => k.name).join(', ') || 'tidak ada'} icon={Pencil} />
      </div>

      <Card className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari knowledge graph…" aria-label="Cari knowledge graph" className="w-full pl-9" />
          </div>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="h-9 rounded-lg">
              <TabsTrigger value="all">Semua ({all.length})</TabsTrigger>
              <TabsTrigger value="draft">Punya draft</TabsTrigger>
              <TabsTrigger value="empty">Masih kosong</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {kgs.error ? (
          <div className="text-destructive rounded-lg border border-dashed p-8 text-center text-sm">
            Tidak bisa menghubungi backend: {kgs.error}
            <p className="text-muted-foreground mt-1">Jalankan `uv run uvicorn app.api:app --port 8000` di folder backend.</p>
          </div>
        ) : kgs.loading && !kgs.data ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Memuat…</p>
        ) : (
          <KgTable items={items} onOpen={setCurrentKg} />
        )}

        <p className="text-muted-foreground text-xs">{items.length} knowledge graph · Neo4j self-hosted</p>
      </Card>

      <NewKgDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        busy={busy}
        onCreate={async ({ id, name, description }) => {
          setBusy(true)
          try {
            const kg = await api.createKg(name, description, id)
            setCurrentKg(kg.id)
            setDialogOpen(false)
            toast.success(`KG "${kg.name}" dibuat`, { description: 'Lanjutkan dengan upload chat.' })
            navigate(`/upload?kg=${kg.id}`)
          } catch (e) {
            toast.error('Gagal membuat KG', { description: errorText(e) })
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}
