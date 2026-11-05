import Graph from 'graphology'
import circular from 'graphology-layout/circular'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import noverlap from 'graphology-layout-noverlap'

export type NodeMark = 'add' | 'del' | 'mod'
export type EdgeTone = 'old' | 'add' | 'del'

export interface GraphNodeData {
  id: string
  key?: string
  label: string
  type: string
  x: number
  y: number
  dimmed?: boolean
  mark?: NodeMark | null
  summary?: string
  props?: Record<string, unknown>
  degree?: number
}

export interface GraphEdgeData {
  id: string
  key?: string
  source: string
  target: string
  label: string
  tone?: EdgeTone
  fact?: string
  valid_at?: string | null
  invalid_at?: string | null
  source_quote?: string
}

export interface GraphData {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
}

/** Keep ontology types visually distinct within the workspace palette. */
export const TYPE_COLORS: Record<string, string> = {
  Person: '#2c84e0',
  Organization: '#2c8c66',
  Course: '#cd4239',
  Task: '#7c44a6',
  Tool: '#b17816',
  Resource: '#1078a3',
  Event: '#a7557b',
  Entity: '#9b9c92'
}
const FALLBACK = Object.values(TYPE_COLORS)

export function typeColor(type: string): string {
  if (TYPE_COLORS[type]) return TYPE_COLORS[type]
  let h = 0
  for (const ch of type) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}

export const isStale = (e: { invalid_at?: string | null; expired_at?: string | null }) => !!(e.invalid_at || e.expired_at)

type LayoutNode = Omit<GraphNodeData, 'x' | 'y'>

/** ForceAtlas2 layout (as in LightRAG's GraphViewer), deterministic from a circular start. */
export function layoutGraph(nodes: LayoutNode[], edges: GraphEdgeData[]): GraphData {
  const g = new Graph({ multi: true })
  for (const n of nodes) if (!g.hasNode(n.id)) g.addNode(n.id)
  const kept = edges.filter((e) => g.hasNode(e.source) && g.hasNode(e.target))
  for (const e of kept) g.addEdgeWithKey(e.id, e.source, e.target)
  circular.assign(g, { scale: 100 })
  if (g.order > 2) {
    forceAtlas2.assign(g, { iterations: 200, settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: g.order > 300 } })
  }
  if (g.order > 1) {
    // FA2 pulls linked pairs on top of each other; keep ~4% of the extent between nodes so dots and labels stay readable
    const xs = g.mapNodes((_, a) => a.x as number), ys = g.mapNodes((_, a) => a.y as number)
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 100
    g.forEachNode((id) => g.setNodeAttribute(id, 'size', extent * 0.02))
    noverlap.assign(g, { maxIterations: 200, settings: { margin: extent * 0.02, ratio: 1 } })
  }
  return {
    nodes: nodes.map((n) => ({ ...n, x: g.getNodeAttribute(n.id, 'x') as number, y: g.getNodeAttribute(n.id, 'y') as number })),
    edges: kept
  }
}
