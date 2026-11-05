import { Eye, LayoutGrid, Maximize, Settings, ZoomIn, ZoomOut } from 'lucide-react'
import { useCamera, useFullScreen } from '@react-sigma/core'

import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'

interface GraphControlsProps {
  onToggleLegend?: () => void
  onToggleEdgeLabels?: () => void
  className?: string
}

/** LightRAG GraphViewer bottom-left column: layout · zoom ± · fullscreen · legend · settings. */
export default function GraphControls({ onToggleLegend, onToggleEdgeLabels, className }: GraphControlsProps) {
  const { zoomIn, zoomOut, reset } = useCamera({ duration: 200, factor: 1.5 })
  const { toggle } = useFullScreen()

  return (
    <div className={cn('bg-background/60 flex flex-col rounded-xl border-2 p-0.5 backdrop-blur-lg', className)}>
      <Button variant="ghost" size="icon" tooltip="Atur ulang tampilan" side="right" onClick={() => reset()}>
        <LayoutGrid />
      </Button>
      <Button variant="ghost" size="icon" tooltip="Perbesar" side="right" onClick={() => zoomIn()}>
        <ZoomIn />
      </Button>
      <Button variant="ghost" size="icon" tooltip="Perkecil" side="right" onClick={() => zoomOut()}>
        <ZoomOut />
      </Button>
      <Button variant="ghost" size="icon" tooltip="Layar penuh" side="right" onClick={() => toggle()}>
        <Maximize />
      </Button>
      {onToggleLegend && (
        <Button variant="ghost" size="icon" tooltip="Legend" side="right" onClick={onToggleLegend}>
          <Eye />
        </Button>
      )}
      {onToggleEdgeLabels && (
        <Button variant="ghost" size="icon" tooltip="Tampilkan / sembunyikan label relasi" side="right" onClick={onToggleEdgeLabels}>
          <Settings />
        </Button>
      )}
    </div>
  )
}
