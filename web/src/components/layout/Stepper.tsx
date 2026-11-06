import { Fragment } from 'react'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

const STEPS = ['Upload chat', 'Tinjau hasil AI', 'Ekstraksi & review', 'Commit']

/** Keep the current import step visible on narrow screens. */
export default function Stepper({ active }: { active: number }) {
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2.5" aria-label="Langkah ingest">
      {STEPS.map((label, i) => (
        <Fragment key={label}>
          {i > 0 && <li aria-hidden className={cn('h-px w-7', i <= active ? 'bg-muted-foreground' : 'bg-border')} />}
          <li className="flex items-center gap-2" aria-current={i === active ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                i === active
                  ? 'bg-pill-active text-pill-active-text'
                  : i < active ? 'bg-secondary text-foreground' : 'bg-muted text-muted-foreground'
              )}
            >
              {i < active ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn('text-sm font-medium', i !== active && 'sr-only lg:not-sr-only', i > active && 'text-muted-foreground')}>{label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  )
}
