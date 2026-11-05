import type { GraphView } from '@/lib/api'
import { layoutGraph, type GraphData } from '@/lib/graph'

/** API graph view -> laid-out sigma data. Stale facts (invalid/expired) get the 'old' tone. */
export function viewToGraph(v: GraphView): GraphData {
  return layoutGraph(
    v.nodes.map((n) => ({
      id: n.id,
      key: n.key,
      label: n.label,
      type: n.type,
      summary: n.summary,
      props: n.props,
      degree: n.degree,
      mark: n.mark
    })),
    v.edges.map((e) => ({
      id: e.id,
      key: e.key,
      source: e.source,
      target: e.target,
      label: e.label,
      fact: e.fact,
      valid_at: e.valid_at,
      invalid_at: e.invalid_at ?? e.expired_at,
      source_quote: e.source_quote,
      tone: e.invalid_at || e.expired_at ? 'old' : undefined
    }))
  )
}

export const typesOf = (g: GraphData) => [...new Set(g.nodes.map((n) => n.type))].sort()
