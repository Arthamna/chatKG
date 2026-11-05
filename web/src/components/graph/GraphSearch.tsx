import { useState } from 'react'
import { Search } from 'lucide-react'
import { useSigma } from '@react-sigma/core'

import Input from '@/components/ui/Input'
import type { GraphNodeData } from '@/lib/graph'

interface GraphSearchProps {
  nodes: GraphNodeData[]
  onSelect: (id: string) => void
}

/** Find a node by label, select it and move the camera to it. */
export default function GraphSearch({ nodes, onSelect }: GraphSearchProps) {
  const sigma = useSigma()
  const [q, setQ] = useState('')

  const submit = () => {
    const term = q.trim().toLowerCase()
    if (!term) return
    const hit = nodes.find((n) => n.label.toLowerCase().includes(term))
    if (!hit) return
    onSelect(hit.id)
    const pos = sigma.getNodeDisplayData(hit.id)
    if (pos) sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.6 }, { duration: 300 })
  }

  return (
    <form
      className="relative min-w-0"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari node…"
        aria-label="Cari node"
        className="w-full pl-9 sm:w-48"
      />
    </form>
  )
}
