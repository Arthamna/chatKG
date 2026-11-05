import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'border-input file:text-foreground placeholder:text-muted-foreground focus-visible:border-focus-border focus-visible:ring-ring flex h-9 rounded-md border bg-card px-3 py-1 text-base transition-colors file:border-0 file:bg-card file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-inner-spin-button]:opacity-50 [&::-webkit-outer-spin-button]:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export default Input
