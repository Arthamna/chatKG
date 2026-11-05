import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Side panel built on the Dialog primitive — used for PropertiesView / QuerySettings below lg. */
const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetTitle = DialogPrimitive.Title
const SheetDescription = DialogPrimitive.Description

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: 'left' | 'right' }
>(({ className, children, side = 'right', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-code/60" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'bg-card data-[state=open]:animate-in data-[state=closed]:animate-out fixed inset-y-0 z-50 flex h-full w-[min(360px,calc(100%-2rem))] flex-col gap-4 overflow-y-auto p-4 duration-200',
        side === 'left'
          ? 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left left-0 border-r'
          : 'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right right-0 border-l',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="focus:ring-ring absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:outline-none">
        <X className="size-4" />
        <span className="sr-only">Tutup</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
SheetContent.displayName = 'SheetContent'

export { Sheet, SheetClose, SheetTrigger, SheetContent, SheetTitle, SheetDescription }
