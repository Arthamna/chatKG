/** REST client for backend/app/api.py (Vite proxies /api to :8000). */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfter?: number
  ) {
    super(message)
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(BASE + path, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body
  })
  if (!res.ok) {
    let detail = res.statusText
    let code: string | undefined
    let retryAfter: number | undefined
    try {
      const body = await res.json()
      const raw = body.detail ?? body
      if (typeof raw === 'string') detail = raw
      else if (raw && typeof raw === 'object') {
        detail = typeof raw.message === 'string' ? raw.message : JSON.stringify(raw)
        code = typeof raw.code === 'string' ? raw.code : undefined
        retryAfter = typeof raw.retry_after === 'number' ? raw.retry_after : undefined
      }
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail || `HTTP ${res.status}`, res.status, code, retryAfter)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------- types

export interface Stats {
  nodes: number
  edges: number
  episodes: number
}

export interface KnowledgeGraph {
  id: string
  name: string
  description: string
  created_at: string
  latest: number
  draft_base: number | null
  has_draft: boolean
  stats: Stats
}

export interface Version {
  n: number
  group_id: string
  kind: 'ingest' | 'edit' | 'restore' | string
  message: string
  author: string
  created_at: string
  nodes: number
  edges: number
  parent: number | null
}

export interface Health {
  llm: boolean
  llm_provider: string
  llm_model: string
  llm_models: string[]
  default_tz: string
  neo4j: boolean
  neo4j_uri: string
  groq: boolean
  groq_model: string
  groq_small_model: string
  entity_extractor: string
  embedding_model: string
  reranker_model: string | null
}

export interface Schema {
  entity_types: { name: string; description: string; attributes: Record<string, string> }[]
  edge_types: { name: string; description: string }[]
  edge_type_map: { source: string; target: string; relations: string[] }[]
  glossary: Record<string, string>
  instructions_template: string
}

export interface PreviewEpisode {
  name: string
  start: string
  end: string
  messages: number
  lines: number
  body: string
}

export interface SourcePreview {
  source_id: string
  filename: string
  date_order: 'MDY' | 'DMY'
  tz: string
  counts: { total: number; text: number; media: number; system: number }
  participants: string[]
  partner: string
  date_from: string | null
  date_to: string | null
  episodes: PreviewEpisode[]
  duplicate_extractions: DuplicateExtraction[]
}

export interface DuplicateExtraction {
  kg_id: string
  kg_name: string
  version: string
  episodes: number
}

export type JobStatus = 'queued' | 'running' | 'retrying' | 'waiting_quota' | 'done' | 'failed' | 'cancelled'

export interface IngestJob {
  kind?: 'schema' | 'ingest'
  sampled_episodes?: number
  total_episodes?: number
  id: string
  kg_id: string
  source_id: string
  status: JobStatus
  total: number
  done: number
  nodes: number
  edges: number
  error: string | null
  resume_at: string | null
  waiting_reason?: string
  retry_attempt?: number
  retry_max?: number
  retry_reason?: string
  model?: string
  current?: string
  group_id?: string
  created_at: string
  started_at?: string
  finished_at?: string
  log: string[]
  last_episode: { nodes: string[]; edges: string[] } | null
}

export type ChangeKind = 'add' | 'modify' | 'invalidate' | 'remove' | 'conflict'

export interface SchemaAttribute {
  name: string
  type: 'string' | 'integer' | 'number' | 'boolean' | 'datetime'
  description: string
}

export interface Ontology {
  entity_types: { name: string; description: string; attributes: SchemaAttribute[] }[]
  edge_types: { name: string; description: string }[]
  edge_type_map: { source: string; target: string; relations: string[] }[]
  glossary: Record<string, string>
}

export interface SchemaProposal {
  revision: string
  base_revision: string
  ontology: Ontology
  baseline: Ontology
  sampled_episodes: number
  model: string
  extraction_instructions: string
}

export interface ReviewItem {
  id: string
  kind: ChangeKind
  target: 'node' | 'edge'
  uuid: string | null
  label: string
  item: string
  detail?: string
  quote?: string
  source?: string
  valid_at?: string | null
  invalid_at?: string | null
  conflict_with?: string[]
}

export interface Review {
  kg: string
  base: number | null
  summary: Partial<Record<ChangeKind | 'node' | 'edge', number>>
  items: ReviewItem[]
}

export interface ApiNode {
  id: string
  key: string
  label: string
  type: string
  summary: string
  degree: number
  mark: 'add' | 'mod' | null
  props: Record<string, unknown>
}

export interface ApiEdge {
  id: string
  key: string
  source: string
  target: string
  label: string
  fact: string
  valid_at: string | null
  invalid_at: string | null
  expired_at: string | null
  source_quote: string
}

export interface GraphView {
  kg: string
  group_id: string
  version: string
  nodes: ApiNode[]
  edges: ApiEdge[]
}

export interface DiffNode {
  key: string
  uuid: string
  name?: string
  types?: string[]
  changes?: Record<string, [unknown, unknown]>
}

export interface DiffEdge {
  key: string
  uuid: string
  name: string
  fact: string
  source_name: string
  target_name: string
  valid_at: string | null
  invalid_at: string | null
  changes?: Record<string, [unknown, unknown]>
}

export interface Diff {
  base: string | null
  compare: string
  summary: Record<string, number>
  nodes: { added: DiffNode[]; removed: DiffNode[]; changed: DiffNode[] }
  edges: { added: DiffEdge[]; removed: DiffEdge[]; changed: DiffEdge[]; invalidated: DiffEdge[] }
}

export interface AskReference {
  n: number
  edge_uuid: string
  fact: string
  valid_at: string | null
  invalid_at: string | null
}

export interface AskResult {
  answer: string
  references: AskReference[]
  subgraph: {
    nodes: { id: string; label: string; type: string }[]
    edges: { id: string; source: string; target: string; label: string; stale: boolean }[]
  }
  ms: number
  group_id: string
  version: string
}

export interface AskBody {
  question: string
  version: string
  top_k: number
  point_in_time: string | null
  include_invalid: boolean
  model: string | null
}

// ---------------------------------------------------------------- calls

const enc = encodeURIComponent

export const api = {
  health: () => request<Health>('/health'),
  schema: () => request<Schema>('/schema'),

  listKgs: () => request<KnowledgeGraph[]>('/kgs'),
  createKg: (name: string, description: string, id?: string) =>
    request<KnowledgeGraph>('/kgs', { method: 'POST', json: { name, description, id } }),
  getKg: (kg: string) => request<KnowledgeGraph>(`/kgs/${enc(kg)}`),
  deleteKg: (kg: string) => request<{ graph_nodes: number; jobs: number; sources: number; versions: number; files: number }>(`/kgs/${enc(kg)}`, { method: 'DELETE' }),

  uploadSource: (kg: string, file: File, f: { owner: string; aliases: string; tz?: string; dateOrder?: string }) => {
    const body = new FormData()
    body.append('file', file)
    body.append('owner', f.owner)
    body.append('aliases', f.aliases)
    if (f.tz) body.append('tz', f.tz)
    if (f.dateOrder) body.append('date_order', f.dateOrder)
    return request<SourcePreview>(`/kgs/${enc(kg)}/sources`, { method: 'POST', body })
  },

  startSchemaJob: (kg: string, source: string, model: string, force = false) =>
    request<IngestJob>(`/kgs/${enc(kg)}/sources/${enc(source)}/schema-jobs`, {
      method: 'POST', json: { force, model }
    }),
  sourceSchema: (kg: string, source: string) =>
    request<SchemaProposal | null>(`/kgs/${enc(kg)}/sources/${enc(source)}/schema`),
  saveSchema: (kg: string, source: string, revision: string, ontology: Ontology, extractionInstructions: string) =>
    request<SchemaProposal>(`/kgs/${enc(kg)}/sources/${enc(source)}/schema`, {
      method: 'PUT', json: { revision, ontology, extraction_instructions: extractionInstructions }
    }),
  startJob: (kg: string, sourceId: string, revision: string) =>
    request<IngestJob>(`/kgs/${enc(kg)}/ingest-jobs`, {
      method: 'POST', json: { source_id: sourceId, schema_revision: revision }
    }),
  listJobs: (kg: string) => request<IngestJob[]>(`/kgs/${enc(kg)}/ingest-jobs`),
  getJob: (id: string) => request<IngestJob>(`/ingest-jobs/${enc(id)}`),
  cancelJob: (id: string) => request<IngestJob>(`/ingest-jobs/${enc(id)}/cancel`, { method: 'POST' }),
  retryJob: (id: string) => request<IngestJob>(`/ingest-jobs/${enc(id)}/retry`, { method: 'POST' }),

  ensureDraft: (kg: string) => request<{ group_id: string }>(`/kgs/${enc(kg)}/draft`, { method: 'POST' }),
  discardDraft: (kg: string) => request<{ deleted: number }>(`/kgs/${enc(kg)}/draft`, { method: 'DELETE' }),
  changes: (kg: string) => request<Review>(`/kgs/${enc(kg)}/draft/changes`),
  rejectChange: (kg: string, id: string) =>
    request<Review>(`/kgs/${enc(kg)}/draft/changes/${enc(id)}/reject`, { method: 'POST' }),
  keepConflict: (kg: string, edge: string) =>
    request<{ invalidated: number }>(`/kgs/${enc(kg)}/draft/conflicts/${enc(edge)}/keep`, { method: 'POST' }),

  patchEntity: (kg: string, uuid: string, body: { name?: string; summary?: string; attributes?: Record<string, unknown> }) =>
    request<{ uuid: string; name: string }>(`/kgs/${enc(kg)}/draft/entities/${enc(uuid)}`, { method: 'PATCH', json: body }),
  deleteEntity: (kg: string, uuid: string) =>
    request<{ edges_removed: number }>(`/kgs/${enc(kg)}/draft/entities/${enc(uuid)}`, { method: 'DELETE' }),
  mergeEntity: (kg: string, uuid: string, body: { target_uuid: string; name?: string; summary_mode?: string }) =>
    request<{ uuid: string; moved: number }>(`/kgs/${enc(kg)}/draft/entities/${enc(uuid)}/merge`, { method: 'POST', json: body }),
  patchEdge: (kg: string, uuid: string, body: { fact?: string; name?: string; invalidate?: boolean }) =>
    request<{ uuid: string }>(`/kgs/${enc(kg)}/draft/edges/${enc(uuid)}`, { method: 'PATCH', json: body }),
  createEdge: (kg: string, body: { source_uuid: string; target_uuid: string; name: string; fact: string }) =>
    request<{ uuid: string; name: string; fact: string }>(`/kgs/${enc(kg)}/draft/edges`, { method: 'POST', json: body }),
  deleteEdge: (kg: string, uuid: string) => request<{ deleted: string }>(`/kgs/${enc(kg)}/draft/edges/${enc(uuid)}`, { method: 'DELETE' }),

  graph: (kg: string, version = 'latest') => request<GraphView>(`/kgs/${enc(kg)}/graph?version=${enc(version)}`),
  versions: (kg: string) => request<{ kg: KnowledgeGraph; versions: Version[] }>(`/kgs/${enc(kg)}/versions`),
  commit: (kg: string, message: string, kind = 'edit') =>
    request<Version>(`/kgs/${enc(kg)}/versions`, { method: 'POST', json: { message, kind } }),
  restore: (kg: string, n: number, message: string) =>
    request<Version>(`/kgs/${enc(kg)}/versions/${n}/restore`, { method: 'POST', json: { message } }),
  diff: (kg: string, base: string, compare: string) =>
    request<Diff>(`/kgs/${enc(kg)}/versions/diff?base=${enc(base)}&compare=${enc(compare)}`),

  ask: (kg: string, body: AskBody) => request<AskResult>(`/kgs/${enc(kg)}/ask`, { method: 'POST', json: body })
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** "v3" / "draft" label for a KG's current state. */
export const currentVersionLabel = (kg: KnowledgeGraph) => (kg.has_draft ? 'draft' : kg.latest ? `v${kg.latest}` : 'kosong')

export const groupIdFor = (kg: string, version: string) => (version === 'draft' ? `kg_${kg}__draft` : `kg_${kg}__${version}`)
