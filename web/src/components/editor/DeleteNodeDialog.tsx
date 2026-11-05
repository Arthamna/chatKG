import { Trash2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/AlertDialog'
import { buttonVariants } from '@/components/ui/Button'
import type { GraphData, GraphNodeData } from '@/lib/graph'

interface DeleteNodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: GraphNodeData
  graph: GraphData
  onDelete: () => void
}

/** B4 — delete node from the draft only. */
export default function DeleteNodeDialog({ open, onOpenChange, node, graph, onDelete }: DeleteNodeDialogProps) {
  const rels = graph.edges.filter((e) => e.source === node.id || e.target === node.id)
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[480px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus node “{node.label}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Node dan {rels.length} relasinya dihapus dari draft. Versi yang sudah di-commit tetap menyimpan node ini.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {rels.length > 0 && (
          <ul className="bg-destructive-subtle space-y-1 rounded-md p-3 text-sm">
            {rels.map((e) => (
              <li key={e.id}>
                • {label(e.source)} —{e.label}→ {label(e.target)}
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className={buttonVariants({ variant: 'outline', size: 'sm' })}>Batal</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: 'destructive', size: 'sm' })} onClick={onDelete}>
            <Trash2 /> Hapus
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
