import type { ReactNode } from 'react'

import Button, { type ButtonVariantType } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  confirmLabel: string
  confirmIcon?: ReactNode
  confirmVariant?: ButtonVariantType
  confirmDisabled?: boolean
  onConfirm: () => void
  className?: string
}

/** Generic Dialog shell: header, body, right-aligned footer (Batal + action). */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  confirmIcon,
  confirmVariant = 'default',
  confirmDisabled,
  onConfirm,
  className
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children && <div className="space-y-4">{children}</div>}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button variant={confirmVariant} size="sm" disabled={confirmDisabled} onClick={onConfirm}>
            {confirmIcon}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
