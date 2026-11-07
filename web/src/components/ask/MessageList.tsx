import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Copy, LoaderCircle, Network } from 'lucide-react'
import { toast } from 'sonner'

import GraphCanvas from '@/components/graph/GraphCanvas'
import WorkspaceMascot, { WorkspaceMark } from '@/components/layout/WorkspaceMascot'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { useIsDark } from '@/hooks/useIsDark'
import { layoutGraph } from '@/lib/graph'
import { when } from '@/lib/time'
import { fmt } from '@/lib/utils'
import type { AskResult } from '@/lib/api'

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; kg: string; kgLabel: string; result: AskResult }
  | { role: 'error'; text: string }

export const SUGGESTIONS = ['Tugas apa saja yang dibahas?', 'Siapa saja yang terlibat dan apa perannya?', 'Apa yang belum selesai?']

export function ChatBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="bg-secondary text-foreground max-w-[85%] rounded-md px-4 py-2.5 text-sm wrap-anywhere">{text}</p>
    </div>
  )
}

export function AssistantMessage({ kg, kgLabel, result }: { kg: string; kgLabel: string; result: AskResult }) {
  const dark = useIsDark()
  const graph = useMemo(
    () =>
      layoutGraph(
        result.subgraph.nodes.map((n) => ({ id: n.id, label: n.label, type: n.type })),
        result.subgraph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label, tone: e.stale ? 'old' : undefined }))
      ),
    [result]
  )
  return (
    <div className="flex gap-2.5">
      <WorkspaceMark />
      <div className="bg-muted border-divider min-w-0 flex-1 space-y-3 rounded-md border p-3 sm:p-4">
        <p className="text-body-text text-sm leading-5 whitespace-pre-wrap wrap-anywhere">{result.answer}</p>
        {graph.nodes.length > 0 && (
          <div className="bg-background h-44 overflow-hidden rounded-md border">
            <GraphCanvas data={graph} dark={dark} edgeLabels camera={{ ratio: 1.2 }} />
          </div>
        )}
        {result.references.length > 0 && (
          <ol className="border-divider space-y-1.5 border-t pt-3">
            {result.references.map((r) => (
              <li key={r.n} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="text-link font-semibold">[{r.n}]</span>
                <span className="font-medium wrap-anywhere">{r.fact}</span>
                <span className="text-muted-foreground">
                  {r.invalid_at ? `berlaku ${when(r.valid_at)} – ${when(r.invalid_at)}` : `berlaku sejak ${when(r.valid_at)}`}
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">
            {kgLabel} · {result.version}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {result.references.length} fakta · {fmt(result.ms / 1000, 1)} dtk
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            tooltip="Salin jawaban"
            onClick={() =>
              navigator.clipboard
                .writeText(result.answer)
                .then(() => toast.success('Jawaban disalin'))
                .catch(() => toast.error('Tidak bisa mengakses clipboard'))
            }
          >
            <Copy className="text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/kg/${kg}/graph?version=${result.version}`} className="whitespace-normal">
              <Network /> Buka di Graph Editor
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

interface MessageListProps {
  messages: ChatMessage[]
  loading: boolean
  loadingText?: string
  scope: string
  onSuggest: (q: string) => void
}

export default function MessageList({ messages, loading, loadingText, scope, onSuggest }: MessageListProps) {
  if (!messages.length) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-4 text-center sm:p-6">
        <WorkspaceMascot className="h-auto w-36" />
        <h2 className="text-lg leading-7 font-semibold">Tanya knowledge graph</h2>
        <p className="text-body-text text-sm wrap-anywhere">Jawaban diambil dari {scope}, lengkap dengan fakta sumber.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <Button key={s} variant="secondary" size="sm" className="h-auto min-h-9 rounded-full py-1.5 whitespace-normal" onClick={() => onSuggest(s)}>
              {s}
            </Button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-4 p-4 md:p-5" aria-live="polite">
      {messages.map((m, i) =>
        m.role === 'user' ? (
          <ChatBubble key={i} text={m.text} />
        ) : m.role === 'assistant' ? (
          <AssistantMessage key={i} kg={m.kg} kgLabel={m.kgLabel} result={m.result} />
        ) : (
          <p key={i} className="bg-destructive-subtle text-destructive rounded-md p-3 text-sm">
            {m.text}
          </p>
        )
      )}
      {loading && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> {loadingText || `Mencari fakta di ${scope}…`}
        </p>
      )}
    </div>
  )
}
