import { cn } from '@/lib/utils'

export type DiffSymbol = '~' | '⟂' | '−' | '+'

const COLOR: Record<DiffSymbol, string> = { '~': 'text-warning', '⟂': 'text-info', '−': 'text-destructive', '+': 'text-success' }

/** `+` added · `−` removed · `~` changed · `⟂` invalidated */
export default function DiffRow({ symbol, kind, text }: { symbol: DiffSymbol; kind: string; text: string }) {
  return (
    <li className="bg-muted flex items-start gap-2.5 rounded-md px-3 py-2 text-sm">
      <span className={cn('w-4 shrink-0 text-base leading-5 font-semibold', COLOR[symbol])}>{symbol}</span>
      <span className="text-muted-foreground w-16 shrink-0 text-xs leading-5">{kind}</span>
      <span className="min-w-0 break-words">{text}</span>
    </li>
  )
}
