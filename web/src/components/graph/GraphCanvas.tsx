import { useEffect, type ReactNode } from 'react'
import Graph, { MultiGraph } from 'graphology'
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSetSettings, useSigma } from '@react-sigma/core'
import type { CameraState } from 'sigma/types'
import { createNodeBorderProgram } from '@sigma/node-border'
import '@react-sigma/core/lib/style.css'

import { cn } from '@/lib/utils'
import { typeColor, type GraphData, type NodeMark } from '@/lib/graph'

/* Sigma constants mirrored from lightrag_webui/src/lib/constants.ts */
const SELECTED = '#F57F17'
const DIMMED = '#B0B0B0'
const MARK_COLOR: Record<NodeMark, string> = { add: '#059669', del: '#EF4444', mod: '#D97706' }
const EDGE_TONE = { old: '#B0B0B0', add: '#059669', del: '#EF4444' } as const

const NodeBorder = createNodeBorderProgram({
  borders: [
    { size: { attribute: 'borderSize', defaultValue: 0.18 }, color: { attribute: 'borderColor', defaultValue: '#FFFFFF' } },
    { size: { fill: true }, color: { attribute: 'color' } }
  ]
})

function buildGraph(data: GraphData) {
  const g = new Graph({ multi: true })
  for (const n of data.nodes) {
    g.addNode(n.id, {
      x: n.x,
      y: -n.y, // screen-style coordinates grow downward, sigma's grow upward
      label: n.label,
      size: 9,
      color: n.dimmed ? DIMMED : typeColor(n.type),
      entityType: n.type,
      borderColor: n.mark ? MARK_COLOR[n.mark] : '#FFFFFF',
      borderSize: n.mark ? 0.3 : 0.18
    })
  }
  for (const e of data.edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    g.addEdgeWithKey(e.id, e.source, e.target, {
      label: e.label,
      size: e.tone && e.tone !== 'old' ? 2 : 1.25,
      color: e.tone ? EDGE_TONE[e.tone] : undefined
    })
  }
  return g
}

interface GraphBehaviorProps {
  data: GraphData
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  typeFilter?: string
  dark: boolean
  edgeLabels: boolean
  /** Initial camera, e.g. to keep nodes clear of overlay panels */
  camera?: Partial<CameraState>
}

function GraphBehavior({ data, selectedId, onSelect, typeFilter = 'all', dark, edgeLabels, camera }: GraphBehaviorProps) {
  const sigma = useSigma()
  const loadGraph = useLoadGraph()
  const registerEvents = useRegisterEvents()
  const setSettings = useSetSettings()

  useEffect(() => {
    loadGraph(buildGraph(data))
  }, [data, loadGraph])

  const camX = camera?.x, camY = camera?.y, camRatio = camera?.ratio
  useEffect(() => {
    if (camX === undefined && camY === undefined && camRatio === undefined) return
    sigma.getCamera().setState({ ...(camX !== undefined && { x: camX }), ...(camY !== undefined && { y: camY }), ...(camRatio !== undefined && { ratio: camRatio }) })
  }, [sigma, camX, camY, camRatio])

  useEffect(() => {
    if (!onSelect) return
    registerEvents({
      clickNode: (e) => onSelect(e.node),
      clickStage: () => onSelect(null),
      enterNode: (e) => e.event.original.target && ((e.event.original.target as HTMLElement).style.cursor = 'pointer'),
      leaveNode: (e) => e.event.original.target && ((e.event.original.target as HTMLElement).style.cursor = 'default')
    })
  }, [registerEvents, onSelect])

  useEffect(() => {
    const edgeColor = dark ? '#888888' : '#D4D4D8'
    setSettings({
      labelColor: { color: dark ? '#FFFFFF' : '#000000' },
      edgeLabelColor: { color: dark ? '#A1A1AA' : '#71717A' },
      defaultEdgeColor: edgeColor,
      renderEdgeLabels: edgeLabels,
      // small graphs: show every label (sigma's label grid otherwise hides neighbours' labels)
      labelDensity: data.nodes.length <= 80 ? 10 : 1,
      labelGridCellSize: data.nodes.length <= 80 ? 40 : 100,
      nodeReducer: (node, attrs) => {
        const res = { ...attrs }
        if (typeFilter !== 'all' && attrs.entityType !== typeFilter) res.hidden = true
        if (node === selectedId) {
          res.borderColor = SELECTED
          res.borderSize = 0.35
          res.size = 11
          res.zIndex = 1
        }
        return res
      },
      edgeReducer: (edge, attrs) => {
        const res = { ...attrs }
        if (selectedId && data.edges.some((e) => e.id === edge && (e.source === selectedId || e.target === selectedId))) {
          res.color = SELECTED
          res.size = 2
          res.zIndex = 1
        }
        return res
      }
    })
  }, [setSettings, selectedId, typeFilter, dark, edgeLabels, data])

  return null
}

interface GraphCanvasProps extends GraphBehaviorProps {
  className?: string
  children?: ReactNode
}

/** sigma.js + graphology canvas (LightRAG GraphViewer look). Overlays go in `children`. */
export default function GraphCanvas({ className, children, ...behavior }: GraphCanvasProps) {
  return (
    <SigmaContainer
      // facts can link the same pair twice (e.g. ASK_REMINDER + RELATES_TO); loadGraph imports into this instance
      graph={MultiGraph}
      className={cn('!bg-background relative !size-full overflow-hidden', className)}
      settings={{
        allowInvalidContainer: true,
        defaultNodeType: 'border',
        nodeProgramClasses: { border: NodeBorder },
        labelRenderedSizeThreshold: 0,
        labelSize: 12,
        labelWeight: '500',
        labelFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
        edgeLabelSize: 10,
        edgeLabelFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
        zIndex: true,
        stagePadding: 48,
        enableEdgeEvents: false
      }}
    >
      <GraphBehavior {...behavior} />
      {children}
    </SigmaContainer>
  )
}
