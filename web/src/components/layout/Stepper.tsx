import { Fragment } from 'react'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

const STEPS = ['Upload chat', 'Tinjau tipe AI', 'Ekstraksi & review', 'Commit']

/** 4-step ingest stepper. Labels hidden below lg (numbers only) per spec. */
export default function Stepper({ active }: { active: number }) {
  return (
    <ol className="flex items-center gap-2.5" aria-label="Langkah ingest">
      {STEPS.map((label, i) => (
        <Fragment key={label}>
          {i > 0 && <li aria-hidden className={cn('h-px w-7', i <= active ? 'bg-primary' : 'bg-border')} />}
          <li className="flex items-center gap-2" aria-current={i === active ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                i <= active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              )}
            >
              {i < active ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn('hidden text-sm font-medium lg:inline', i > active && 'text-muted-foreground')}>{label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  )
}
