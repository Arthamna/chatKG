import { useEffect, useState, type ReactNode } from 'react'
import { GitCommitHorizontal } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import Checkbox from '@/components/ui/Checkbox'
import Input from '@/components/ui/Input'

interface CommitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  version: string
  title?: string
  description: string
  defaultMessage: string
  summary: ReactNode
  showOpenEditor?: boolean
  onCommit: (message: string, openEditor: boolean) => void
}

/** A7 / B5 — commit dialog: message, summary box, optional "open editor" checkbox. */
export default function CommitDialog({ open, onOpenChange, version, title, description, defaultMessage, summary, showOpenEditor, onCommit }: CommitDialogProps) {
  const [message, setMessage] = useState(defaultMessage)
  const [openEditor, setOpenEditor] = useState(true)

  // The default depends on the current draft, so refresh it each time the dialog opens.
  useEffect(() => {
    if (open) setMessage(defaultMessage)
  }, [open, defaultMessage])

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? `Commit versi ${version}`}
      description={description}
      confirmLabel={`Commit ${version}`}
      confirmIcon={<GitCommitHorizontal />}
      confirmDisabled={!message.trim()}
      onConfirm={() => onCommit(message, openEditor)}
    >
      <label className="block space-y-2">
        <span className="text-sm font-medium">Pesan commit</span>
        <Input value={message} onChange={(e) => setMessage(e.target.value)} className="w-full" />
      </label>
      <div className="bg-muted space-y-2.5 rounded-md p-4 text-sm">{summary}</div>
      {showOpenEditor && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={openEditor} onCheckedChange={(v) => setOpenEditor(v === true)} />
          Buka Graph Editor setelah commit
        </label>
      )}
    </ConfirmDialog>
  )
}
