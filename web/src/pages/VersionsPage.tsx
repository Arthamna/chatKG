import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Database, MessageSquare, Network, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/layout/PageHeader'
import GraphCanvas from '@/components/graph/GraphCanvas'
import VersionListItem, { type VersionRow } from '@/components/versions/VersionListItem'
import DiffRow, { type DiffSymbol } from '@/components/versions/DiffRow'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { Field } from '@/components/common/Field'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { useIsDark } from '@/hooks/useIsDark'
import { api, errorText, groupIdFor, type Diff, type GraphView } from '@/lib/api'
import { layoutGraph, type GraphData, type GraphEdgeData, type NodeMark } from '@/lib/graph'
import { fmt } from '@/lib/utils'

const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v))

function diffRows(d: Diff): { symbol: DiffSymbol; kind: string; text: string }[] {
  const rel = (e: { source_name: string; name: string; target_name: string }) => `${e.source_name} —${e.name}→ ${e.target_name}`
  return [
    ...d.nodes.added.map((n) => ({ symbol: '+' as const, kind: n.types?.[0] ?? 'Node', text: n.name ?? '' })),
    ...d.nodes.removed.map((n) => ({ symbol: '−' as const, kind: n.types?.[0] ?? 'Node', text: n.name ?? '' })),
    ...d.nodes.changed.map((n) => ({
      symbol: '~' as const,
      kind: 'Node',
      text: `${n.name}: ${Object.entries(n.changes ?? {})
        .map(([k, [a, b]]) => (k === 'summary' ? 'ringkasan diperbarui' : `${k} ${show(a)} → ${show(b)}`))
        .join('; ')}`
    })),
    ...d.edges.added.map((e) => ({ symbol: '+' as const, kind: 'Relasi', text: `${rel(e)} · ${e.fact}` })),
    ...d.edges.removed.map((e) => ({ symbol: '−' as const, kind: 'Relasi', text: rel(e) })),
    ...d.edges.invalidated.map((e) => ({ symbol: '⟂' as const, kind: 'Relasi', text: `${rel(e)} · tidak berlaku lagi` })),
    ...d.edges.changed.map((e) => ({ symbol: '~' as const, kind: 'Relasi', text: `${rel(e)} · ${e.fact}` }))
  ]
}

/** Overlay base and compare by origin key: removed items come from the base view. */
function diffGraph(base: GraphView, compare: GraphView, d: Diff): GraphData {
  const addedN = new Set(d.nodes.added.map((n) => n.key))
  const changedN = new Set(d.nodes.changed.map((n) => n.key))
  const addedE = new Set(d.edges.added.map((e) => e.key))
  const staleE = new Set(d.edges.invalidated.map((e) => e.key))
  const cmpByKey = new Map(compare.nodes.map((n) => [n.key, n.id]))
  const nodes: { id: string; key: string; label: string; type: string; mark: NodeMark | null }[] = compare.nodes.map((n) => ({
    id: n.id,
    key: n.key,
    label: n.label,
    type: n.type,
    mark: addedN.has(n.key) ? 'add' : changedN.has(n.key) ? 'mod' : null
  }))
  const idFor = new Map<string, string>()
  for (const n of base.nodes) {
    const same = cmpByKey.get(n.key)
    if (same) idFor.set(n.id, same)
    else {
      idFor.set(n.id, n.id)
      nodes.push({ id: n.id, key: n.key, label: n.label, type: n.type, mark: 'del' as const })
    }
  }
  const cmpKeys = new Set(compare.edges.map((e) => e.key))
  const edges: GraphEdgeData[] = [
    ...compare.edges.map((e) => ({
      id: e.id,
      key: e.key,
      source: e.source,
      target: e.target,
      label: e.label,
      tone: addedE.has(e.key) ? ('add' as const) : staleE.has(e.key) || e.invalid_at ? ('old' as const) : undefined
    })),
    ...base.edges
      .filter((e) => !cmpKeys.has(e.key))
      .map((e) => ({ id: e.id, key: e.key, source: idFor.get(e.source) ?? e.source, target: idFor.get(e.target) ?? e.target, label: e.label, tone: 'del' as const }))
  ]
  const laid = layoutGraph(nodes, edges)
  return { ...laid, nodes: laid.nodes.map((n) => ({ ...n, dimmed: n.mark === 'del' })) }
}

/** C1 — version history & diff (+ C2 restore). */
export default function VersionsPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const dark = useIsDark()
  const [, setCurrentKg] = useCurrentKg()
  const kgs = useApi(() => api.listKgs(), [])
  const meta = useApi(() => api.versions(id), [id], !!id)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (id) setCurrentKg(id)
  }, [id, setCurrentKg])

  const kg = meta.data?.kg
  const versions = useMemo(() => meta.data?.versions ?? [], [meta.data])
  const rows: VersionRow[] = useMemo(
    () => [
      ...(kg?.has_draft
        ? [{ id: 'draft', title: 'draft', message: `Draft dari ${kg.draft_base ? `v${kg.draft_base}` : 'KG kosong'} · belum di-commit`, kind: 'draft', size: `${fmt(kg.stats.nodes)} entitas · ${fmt(kg.stats.edges)} fakta` }]
        : []),
      ...versions.map((v) => ({ id: `v${v.n}`, title: `v${v.n}`, message: v.message, kind: v.kind, created_at: v.created_at, size: `${fmt(v.nodes)} entitas · ${fmt(v.edges)} fakta` }))
    ],
    [kg, versions]
  )
  const ids = rows.map((r) => r.id)
  const compare = params.get('compare') && ids.includes(params.get('compare')!) ? params.get('compare')! : (ids[0] ?? '')
  const defaultBase = compare === 'draft' ? (kg?.draft_base ? `v${kg.draft_base}` : '') : ids[ids.indexOf(compare) + 1] ?? ''
  const base = params.get('base') && ids.includes(params.get('base')!) && params.get('base') !== compare ? params.get('base')! : defaultBase
  const set = (b: string, c: string) => setParams({ base: b, compare: c }, { replace: true })

  const ready = !!id && !!base && !!compare && base !== compare
  const diff = useApi(() => api.diff(id, base, compare), [id, base, compare], ready)
  const gBase = useApi(() => api.graph(id, base), [id, base], ready)
  const gCmp = useApi(() => api.graph(id, compare), [id, compare], !!id && !!compare)
  const graph = useMemo(
    () => (diff.data && gBase.data && gCmp.data ? diffGraph(gBase.data, gCmp.data, diff.data) : null),
    [diff.data, gBase.data, gCmp.data]
  )
  const sum = diff.data?.summary
  const restoreN = base.startsWith('v') ? Number(base.slice(1)) : compare.startsWith('v') ? Number(compare.slice(1)) : 0
  const nextN = (kg?.latest ?? 0) + 1

  return (
    <div className="workspace-page flex min-h-full flex-col gap-6">
      <PageHeader eyebrow="Riwayat graph" title="Riwayat versi" description={`Setiap versi = salinan penuh graph (${groupIdFor(id, 'vN')}). Tidak ada versi yang ditimpa.`}>
        <Select value={id} onValueChange={(v) => navigate(`/kg/${v}/versions`)}>
          <SelectTrigger className="w-56" aria-label="Knowledge graph">
            <SelectValue placeholder="Pilih KG" />
          </SelectTrigger>
          <SelectContent>
            {(kgs.data ?? []).map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      {meta.error && <p className="bg-destructive-subtle text-destructive rounded-md px-4 py-2 text-sm">{meta.error}</p>}

      <div className="flex flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex shrink-0 flex-col gap-3 p-6 lg:w-80 xl:w-[440px]">
          <div className="space-y-1.5">
            <CardTitle>Versi ({versions.length})</CardTitle>
            <CardDescription>Pilih dua versi untuk melihat perubahannya</CardDescription>
          </div>
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <VersionListItem
                key={r.id}
                version={r}
                latest={r.id === `v${kg?.latest}`}
                role={r.id === base ? 'base' : r.id === compare ? 'compare' : undefined}
                onSelect={() => (r.id === compare ? null : r.id === base ? set(compare, base) : set(base && base !== r.id ? base : '', r.id))}
              />
            ))}
            {!rows.length && !meta.loading && <li className="text-muted-foreground text-sm">Belum ada versi. Upload chat lalu commit.</li>}
          </ul>
          <p className="text-muted-foreground mt-auto text-xs">
            Penyimpanan: {versions.length} salinan · {fmt(versions.reduce((s, v) => s + v.nodes, 0))} entitas total (Neo4j self-hosted)
          </p>
        </Card>

        <Card className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <Select value={base} onValueChange={(v) => set(v, compare)}>
              <SelectTrigger className="w-28" aria-label="Versi kiri">
                <SelectValue placeholder="Versi" />
              </SelectTrigger>
              <SelectContent>
                {ids.filter((v) => v !== compare).map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ArrowRight className="text-muted-foreground size-4" />
            <Select value={compare} onValueChange={(v) => set(base === v ? '' : base, v)}>
              <SelectTrigger className="w-28" aria-label="Versi kanan">
                <SelectValue placeholder="Versi" />
              </SelectTrigger>
              <SelectContent>
                {ids.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sum && (
              <div className="flex flex-wrap gap-2 md:ml-auto">
                <Badge variant="success">+{sum.nodes_added} entitas</Badge>
                <Badge variant="destructive">−{sum.nodes_removed} entitas</Badge>
                <Badge variant="warning">~{sum.nodes_changed + sum.edges_changed} diubah</Badge>
                <Badge variant="success">+{sum.edges_added} fakta</Badge>
                <Badge variant="info">{sum.edges_invalidated} invalidated</Badge>
              </div>
            )}
          </div>

          {!ready ? (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-sm">
              <Database className="size-6" />
              <p>{rows.length < 2 ? 'Butuh minimal dua versi (atau versi + draft) untuk dibandingkan.' : 'Pilih dua versi.'}</p>
            </div>
          ) : (
            <Tabs defaultValue="graph" className="flex min-h-0 flex-1 flex-col gap-4">
              <TabsList className="self-start">
                <TabsTrigger value="graph">Graph diff</TabsTrigger>
                <TabsTrigger value="list">Daftar perubahan</TabsTrigger>
              </TabsList>
              <TabsContent value="graph" className="h-80 overflow-hidden rounded-md border lg:h-auto lg:min-h-80 lg:flex-1">
                {graph && graph.nodes.length ? (
                  <GraphCanvas data={graph} dark={dark} edgeLabels camera={{ ratio: 1.15 }} />
                ) : (
                  <p className="text-muted-foreground flex h-full items-center justify-center text-sm">{diff.error ?? (diff.loading ? 'Memuat…' : 'Graph kosong')}</p>
                )}
              </TabsContent>
              <TabsContent value="list">
                <ul className="space-y-2">
                  {diff.data && diffRows(diff.data).map((r, i) => <DiffRow key={i} {...r} />)}
                  {diff.data && !diffRows(diff.data).length && <li className="text-muted-foreground text-sm">Kedua versi identik.</li>}
                </ul>
              </TabsContent>
            </Tabs>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {restoreN > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRestoreMsg(`Restore dari v${restoreN}`)
                  setRestoreOpen(true)
                }}
              >
                <RotateCcw /> Restore v{restoreN}
              </Button>
            )}
            {compare && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/kg/${id}/graph?version=${compare}`)}>
                <Network /> Buka {compare} di editor
              </Button>
            )}
            {compare && (
              <Button size="sm" onClick={() => navigate(`/ask?kg=${id}&version=${compare}`)}>
                <MessageSquare /> Ask versi {compare}
              </Button>
            )}
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={`Restore v${restoreN} sebagai v${nextN}?`}
        description={`v${restoreN} disalin penuh menjadi versi baru v${nextN} (${groupIdFor(id, `v${nextN}`)}). Riwayat lain tetap tersimpan, tidak ada yang ditimpa.`}
        confirmLabel={busy ? 'Menyalin…' : 'Restore'}
        confirmIcon={<RotateCcw />}
        confirmDisabled={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            const v = await api.restore(id, restoreN, restoreMsg)
            setRestoreOpen(false)
            toast.success(`v${restoreN} dipulihkan sebagai v${v.n}`, { description: `${v.nodes} entitas · ${v.edges} fakta` })
            await meta.reload()
            set(`v${restoreN}`, `v${v.n}`)
          } catch (e) {
            toast.error('Restore gagal', { description: errorText(e) })
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Pesan commit">
          <Input value={restoreMsg} onChange={(e) => setRestoreMsg(e.target.value)} className="w-full" />
        </Field>
      </ConfirmDialog>
    </div>
  )
}
