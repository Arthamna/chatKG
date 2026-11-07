import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Database, LoaderCircle, MonitorSmartphone, Upload } from 'lucide-react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import DraftBar from '@/components/editor/DraftBar'
import EditPropertyDialog from '@/components/editor/EditPropertyDialog'
import MergeDialog from '@/components/editor/MergeDialog'
import DeleteNodeDialog from '@/components/editor/DeleteNodeDialog'
import CreateRelationDialog from '@/components/editor/CreateRelationDialog'
import EditRelationDialog from '@/components/editor/EditRelationDialog'
import CommitDialog from '@/components/review/CommitDialog'
import GraphCanvas from '@/components/graph/GraphCanvas'
import GraphControls from '@/components/graph/GraphControls'
import GraphSearch from '@/components/graph/GraphSearch'
import Legend from '@/components/graph/Legend'
import PropertiesView from '@/components/graph/PropertiesView'
import PageHeader from '@/components/layout/PageHeader'
import Button from '@/components/ui/Button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { BP, useMediaQuery } from '@/hooks/useMediaQuery'
import { useIsDark } from '@/hooks/useIsDark'
import { api, errorText, groupIdFor } from '@/lib/api'
import { viewToGraph, typesOf } from '@/lib/graphView'

type DialogKind = null | 'edit' | 'merge' | 'delete' | 'add-relation' | 'edit-relation' | 'commit' | 'discard'
const EMPTY = { nodes: [], edges: [] }

/** B1 — Graph Editor (+ B2–B5). Committed versions are read-only; edits go to the draft. */
export default function GraphEditorPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const dark = useIsDark()
  const isLg = useMediaQuery(BP.lg)
  const isMd = useMediaQuery(BP.md)
  const [, setCurrentKg] = useCurrentKg()

  const kgs = useApi(() => api.listKgs(), [])
  const meta = useApi(() => api.versions(id), [id], !!id)
  const kg = meta.data?.kg
  const versionParam = params.get('version')
  const version = versionParam ?? (kg ? (kg.has_draft || !kg.latest ? 'draft' : `v${kg.latest}`) : null)

  const view = useApi(() => api.graph(id, version!), [id, version], !!id && !!version)
  const review = useApi(() => api.changes(id), [id, version], !!id && version === 'draft')
  const graph = useMemo(() => (view.data ? viewToGraph(view.data) : EMPTY), [view.data])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [legendOpen, setLegendOpen] = useState(() => window.matchMedia(BP.lg).matches)
  const [edgeLabels, setEdgeLabels] = useState(true)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [propKey, setPropKey] = useState('name')
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (id) setCurrentKg(id)
  }, [id, setCurrentKg])
  useEffect(() => setSelectedId(null), [id, version])

  const readOnly = !isMd || version !== 'draft'
  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null
  const changeCount = review.data?.items.length ?? 0
  const setVersion = (v: string) => setParams({ version: v }, { replace: true })

  const refresh = async () => {
    await Promise.all([view.reload(), review.reload(), meta.reload()])
  }

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      toast.success(label)
      setDialog(null)
      await refresh()
    } catch (e) {
      toast.error('Gagal', { description: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const startEdit = () =>
    run(kg?.has_draft ? 'Draft dibuka' : 'Draft dibuat dari versi terbaru', async () => {
      await api.ensureDraft(id)
      setVersion('draft')
    })

  const currentValue = (key: string) => {
    if (!selected) return ''
    if (key === 'name') return selected.label
    if (key === 'summary') return selected.summary ?? ''
    const v = selected.props?.[key]
    return typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)
  }

  if (meta.error) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <Database className="size-6" />
        <p className="text-foreground font-medium">Tidak bisa memuat KG “{id}”</p>
        <p>{meta.error}</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/kg">Ke daftar KG</Link>
        </Button>
      </div>
    )
  }

  const properties = selected && (
    <PropertiesView
      node={selected}
      graph={graph}
      groupId={groupIdFor(id, version ?? 'draft')}
      readOnly={readOnly}
      onEditProperty={(k) => {
        setPropKey(k)
        setDialog('edit')
      }}
      onMerge={() => setDialog('merge')}
      onDelete={() => setDialog('delete')}
      onAddRelation={() => setDialog('add-relation')}
      onEditRelation={(edge) => {
        setSelectedEdgeId(edge.id)
        setDialog('edit-relation')
      }}
    />
  )

  return (
    <div className="workspace-page flex h-full min-h-[40rem] flex-col gap-4 pb-6">
      <PageHeader
        title="Graph Editor"
        description={kg ? `Telusuri entitas dan relasi di ${kg.name}.` : 'Telusuri entitas dan relasi dalam knowledge graph.'}
      />
      <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
        <DraftBar
          kgs={kgs.data ?? []}
          kg={id}
          onKgChange={(v) => navigate(`/kg/${v}/graph`)}
          versions={meta.data?.versions ?? []}
          hasDraft={!!kg?.has_draft}
          version={version ?? ''}
          onVersionChange={setVersion}
          changes={changeCount}
          readOnly={readOnly}
          canEdit={isMd && !!kg}
          onStartEdit={startEdit}
          onDiscard={() => setDialog('discard')}
          onCommit={() => setDialog('commit')}
        />

        {!isMd && (
          <div className="bg-warning-subtle text-warning flex items-center gap-2 px-4 py-2 text-xs font-medium">
            <MonitorSmartphone className="size-4 shrink-0" /> Gunakan layar yang lebih besar untuk mengedit. Di sini hanya bisa geser & zoom.
          </div>
        )}
        {isMd && version && version !== 'draft' && (
          <div className="bg-muted text-muted-foreground flex items-center gap-2 px-4 py-2 text-xs font-medium wrap-anywhere">
            <Database className="size-4 shrink-0" /> {version} sudah di-commit (read-only, {groupIdFor(id, version)}). Klik “Edit” untuk mengubah lewat draft.
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          {view.loading && !view.data && (
            <div className="bg-background/80 absolute inset-0 z-20 flex items-center justify-center">
              <LoaderCircle className="size-6 animate-spin" />
            </div>
          )}
          {view.data && graph.nodes.length === 0 && (
            <div className="text-muted-foreground absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-center text-sm">
              <p className="text-foreground font-medium">Graph {version} masih kosong</p>
              <p>Upload chat untuk mengisi KG ini.</p>
              <Button size="sm" asChild>
                <Link to={`/upload?kg=${id}`}>
                  <Upload /> Upload chat
                </Link>
              </Button>
            </div>
          )}
          <GraphCanvas
            data={graph}
            selectedId={selectedId}
            onSelect={setSelectedId}
            typeFilter={typeFilter}
            dark={dark}
            edgeLabels={edgeLabels}
            camera={isLg && selected ? { x: 0.62, ratio: 1.2 } : { ratio: 1.1 }}
          >
            <div className="absolute inset-x-2 top-2 z-10 grid grid-cols-2 gap-2 sm:right-auto sm:flex">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="min-w-0 sm:w-40" aria-label="Filter tipe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua tipe</SelectItem>
                  {typesOf(graph).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <GraphSearch nodes={graph.nodes} onSelect={setSelectedId} />
            </div>

            <GraphControls className="absolute bottom-2 left-2 z-10" onToggleLegend={() => setLegendOpen((o) => !o)} onToggleEdgeLabels={() => setEdgeLabels((o) => !o)} />
            {legendOpen && graph.nodes.length > 0 && <Legend types={typesOf(graph)} showDraft={version === 'draft'} className="absolute right-2 bottom-14 z-10 sm:bottom-2" />}

            {isLg && selected && (
              <div className="bg-card absolute top-2 right-2 z-10 max-h-[calc(100%-1rem)] w-[300px] overflow-y-auto rounded-md border p-3 xl:w-[340px]">
                {properties}
              </div>
            )}
          </GraphCanvas>
        </div>
      </div>

      {!isLg && (
        <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
          <SheetContent>
            <SheetTitle className="sr-only">Detail node</SheetTitle>
            <SheetDescription className="sr-only">Properti dan relasi node terpilih</SheetDescription>
            <div className="pt-6">{properties}</div>
          </SheetContent>
        </Sheet>
      )}

      {selected && (
        <>
          <EditPropertyDialog
            open={dialog === 'edit'}
            onOpenChange={(o) => !o && setDialog(null)}
            entity={selected.label}
            entityType={selected.type}
            propKey={propKey}
            current={currentValue(propKey)}
            busy={busy}
            onSave={(value) =>
              run(`${propKey} diperbarui`, () =>
                api.patchEntity(
                  id,
                  selected.id,
                  propKey === 'name' ? { name: value } : propKey === 'summary' ? { summary: value } : { attributes: { [propKey]: value } }
                )
              )
            }
          />
          <MergeDialog
            open={dialog === 'merge'}
            onOpenChange={(o) => !o && setDialog(null)}
            source={selected}
            graph={graph}
            busy={busy}
            onMerge={(target, name, mode) =>
              run('Entitas digabung', async () => {
                await api.mergeEntity(id, selected.id, { target_uuid: target, name, summary_mode: mode })
                setSelectedId(target)
              })
            }
          />
          <DeleteNodeDialog
            open={dialog === 'delete'}
            onOpenChange={(o) => !o && setDialog(null)}
            node={selected}
            graph={graph}
            onDelete={() =>
              run(`${selected.label} dihapus dari draft`, async () => {
                await api.deleteEntity(id, selected.id)
                setSelectedId(null)
              })
            }
          />
          <CreateRelationDialog
            open={dialog === 'add-relation'}
            onOpenChange={(o) => !o && setDialog(null)}
            node={selected}
            graph={graph}
            busy={busy}
            onCreate={(direction, target, name, fact) =>
              run('Relasi ditambahkan ke draft', () => api.createEdge(id, {
                source_uuid: direction === 'out' ? selected.id : target,
                target_uuid: direction === 'out' ? target : selected.id,
                name,
                fact
              }))
            }
          />
          {selectedEdge && (
            <EditRelationDialog
              open={dialog === 'edit-relation'}
              onOpenChange={(o) => !o && setDialog(null)}
              edge={selectedEdge}
              graph={graph}
              busy={busy}
              onSave={(name, fact) =>
                run('Relasi diperbarui', () => api.patchEdge(id, selectedEdge.id, { name, fact }))
              }
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Buang draft?"
        description={`${changeCount} perubahan di draft akan hilang. Versi yang sudah di-commit tidak berubah.`}
        confirmLabel="Buang draft"
        confirmVariant="destructive"
        confirmDisabled={busy}
        onConfirm={() =>
          run('Draft dibuang', async () => {
            await api.discardDraft(id)
            setParams({}, { replace: true })
          })
        }
      />

      <CommitDialog
        open={dialog === 'commit'}
        onOpenChange={(o) => !o && setDialog(null)}
        version={`v${(kg?.latest ?? 0) + 1}`}
        title={`Commit draft → v${(kg?.latest ?? 0) + 1}`}
        description={`${changeCount} perubahan akan dibekukan menjadi versi baru (salinan penuh).`}
        defaultMessage="Manual edit"
        summary={
          <>
            <ul className="bg-background max-h-48 divide-y overflow-y-auto rounded-md border">
              {(review.data?.items ?? []).slice(0, 30).map((c) => (
                <li key={c.id} className="flex gap-2.5 px-3 py-2">
                  <span className="text-muted-foreground w-16 shrink-0 text-xs">{c.kind}</span>
                  <span className="min-w-0 break-words">{c.item}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground flex items-center gap-2">
              <Database className="size-4" /> Salinan penuh → {groupIdFor(id, `v${(kg?.latest ?? 0) + 1}`)}
            </p>
          </>
        }
        onCommit={(message) =>
          run('Versi baru di-commit', async () => {
            const v = await api.commit(id, message, 'edit')
            navigate(`/kg/${id}/versions?compare=v${v.n}`)
          })
        }
      />
    </div>
  )
}
