import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { GitCommitHorizontal, History, Network, Pencil, Plus, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'

import StatCard from '@/components/kg/StatCard'
import KgTable from '@/components/kg/KgTable'
import NewKgDialog from '@/components/kg/NewKgDialog'
import WorkspaceMascot from '@/components/layout/WorkspaceMascot'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { api, errorText } from '@/lib/api'
import { fmt } from '@/lib/utils'

type Filter = 'all' | 'draft' | 'empty'
const filters = [
  { value: 'all', label: 'Semua' },
  { value: 'draft', label: 'Punya draft' },
  { value: 'empty', label: 'Masih kosong' }
] as const

export default function KnowledgeGraphsPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [, setCurrentKg] = useCurrentKg()
  const kgs = useApi(() => api.listKgs(), [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const all = kgs.data ?? []
  const drafts = all.filter((kg) => kg.has_draft)
  const empty = all.filter((kg) => !kg.latest && !kg.stats.nodes)
  const filtered = { all, draft: drafts, empty }
  const search = query.trim().toLowerCase()
  const items = filtered[filter].filter((kg) => `${kg.name} ${kg.description} ${kg.id}`.toLowerCase().includes(search))
  const pick = params.get('pick')
  const metrics = [
    {
      label: 'Knowledge graphs',
      value: all.length,
      sub: `${fmt(all.filter((kg) => kg.latest).length)} punya versi`,
      icon: Network
    },
    {
      label: 'Versi tersimpan',
      value: all.reduce((sum, kg) => sum + kg.latest, 0),
      sub: 'Salinan penuh di Neo4j',
      icon: History
    },
    {
      label: 'Entitas terkini',
      value: all.reduce((sum, kg) => sum + kg.stats.nodes, 0),
      sub: `${fmt(all.reduce((sum, kg) => sum + kg.stats.edges, 0))} fakta`,
      icon: GitCommitHorizontal
    },
    {
      label: 'Draft aktif',
      value: drafts.length,
      sub: drafts.map((kg) => kg.name).join(', ') || 'Tidak ada draft',
      icon: Pencil
    }
  ]

  return (
    <div className="workspace-page space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-full lg:basis-0">
          <p className="text-body-text text-xs leading-4 font-bold uppercase">Ringkasan ruang kerja</p>
          <h1 className="mt-1 text-[28px] leading-[1.5] font-bold sm:text-4xl">Knowledge Graphs</h1>
          <p className="text-body-text mt-1 leading-6">Pantau hasil ekstraksi chat, versi tersimpan, dan draft di ruang kerja ini.</p>
        </div>
        <WorkspaceMascot />
        <div className="flex flex-wrap items-center gap-2 lg:self-end">
          <Button variant="secondary" onClick={() => navigate('/upload')}>
            <Upload /> Upload chat
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus /> KG baru
          </Button>
        </div>
      </header>

      {pick && all.length > 0 && (
        <p className="bg-info-subtle text-info rounded-md px-4 py-3 text-sm">Pilih KG dulu untuk membuka {pick === 'graph' ? 'Graph Editor' : 'riwayat versi'}.</p>
      )}

      <dl aria-label="Metrik ruang kerja" aria-busy={kgs.loading} className="bg-divider rounded-md grid gap-px overflow-hidden border min-[480px]:grid-cols-2 lg:grid-cols-4">
        {metrics.map(({ label, value, sub, icon }) => (
          <StatCard key={label} label={label} value={kgs.data ? fmt(value) : '—'} sub={kgs.data ? sub : undefined} icon={icon} />
        ))}
      </dl>

      <Card>
        <div className="border-divider space-y-4 border-b px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-xl leading-7 font-bold">Daftar knowledge graph</h2>
            <p className="text-muted-foreground text-sm leading-5">Lihat versi, isi, dan status draft tiap graph.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="relative w-full sm:w-72">
              <Search aria-hidden="true" className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari knowledge graph…"
                aria-label="Cari knowledge graph"
                className="w-full pl-9"
              />
            </div>
            <div role="group" aria-label="Filter knowledge graph" className="flex flex-wrap items-center gap-1">
              {filters.map(({ value, label }) => (
                <Button
                  key={value}
                  variant="ghost"
                  size="sm"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className="text-body-text aria-pressed:bg-pill-active aria-pressed:text-pill-active-text h-8 gap-1.5 rounded-full px-2 text-[13px] leading-none sm:px-3.5"
                >
                  {label}
                  {kgs.data && <span className="tabular-nums">({fmt(filtered[value].length)})</span>}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {kgs.error ? (
          <div role="alert" className="px-4 py-8 text-center text-sm sm:px-6">
            <p className="text-destructive font-semibold">Tidak bisa menghubungi backend</p>
            <p className="text-body-text mt-1 break-words">{kgs.error}</p>
            <p className="text-muted-foreground mt-1">Jalankan <code className="bg-secondary rounded-xs px-1.5 py-0.5">uv run uvicorn app.api:app --port 8000</code> di folder backend.</p>
          </div>
        ) : kgs.loading && !kgs.data ? (
          <p role="status" className="text-muted-foreground py-8 text-center text-sm">Memuat knowledge graph…</p>
        ) : items.length ? (
          <KgTable items={items} onOpen={setCurrentKg} />
        ) : (
          <div className="text-body-text px-4 py-10 text-center text-sm sm:px-6">
            <Network aria-hidden="true" className="bg-muted border-divider mx-auto mb-2 size-10 rounded-md border p-2.5" />
            <p className="text-foreground text-base font-semibold">{all.length ? 'Tidak ada hasil yang cocok' : 'Belum ada knowledge graph'}</p>
            <p className="mt-1">{all.length ? 'Coba kata kunci atau filter lain.' : 'Buat KG baru, lalu upload chat untuk mengisinya.'}</p>
          </div>
        )}

        {kgs.data && !kgs.error && (
          <p role="status" className="text-muted-foreground border-divider border-t px-4 py-3 text-[13px] leading-[1.5] sm:px-6">
            {fmt(items.length)} dari {fmt(all.length)} knowledge graph
          </p>
        )}
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
