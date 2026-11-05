import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'

import MessageList, { type ChatMessage } from '@/components/ask/MessageList'
import QueryComposer from '@/components/ask/QueryComposer'
import QuerySettings, { type AskSettings } from '@/components/ask/QuerySettings'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { api, errorText } from '@/lib/api'
import { localInputToIso } from '@/lib/time'

/** D1 / D2 — Ask KG: Graphiti search on one version + Groq answer with citations. */
export default function AskPage() {
  const [params] = useSearchParams()
  const [currentKg, setCurrentKg] = useCurrentKg()
  const kgs = useApi(() => api.listKgs(), [])
  const health = useApi(() => api.health(), [])
  const [settings, setSettings] = useState<AskSettings>({
    kg: params.get('kg') ?? currentKg ?? '',
    version: params.get('version') ?? 'latest',
    topK: '10',
    pointInTime: '',
    model: '',
    includeInvalid: true
  })
  const meta = useApi(() => api.versions(settings.kg), [settings.kg], !!settings.kg)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!settings.kg && kgs.data?.length) setSettings((s) => ({ ...s, kg: kgs.data![0].id }))
  }, [kgs.data, settings.kg])
  useEffect(() => {
    if (!settings.model && health.data) setSettings((s) => ({ ...s, model: health.data!.llm_model }))
  }, [health.data, settings.model])
  useEffect(() => {
    if (settings.kg) setCurrentKg(settings.kg)
  }, [settings.kg, setCurrentKg])

  const kgName = kgs.data?.find((k) => k.id === settings.kg)?.name ?? settings.kg
  const scope = `${kgName || 'KG'} · ${settings.version}`
  const models = health.data?.llm_models ?? []

  const ask = async (q: string) => {
    if (!settings.kg) return
    setMessages((m) => [...m, { role: 'user', text: q }])
    setLoading(true)
    try {
      const result = await api.ask(settings.kg, {
        question: q,
        version: settings.version,
        top_k: Number(settings.topK),
        point_in_time: localInputToIso(settings.pointInTime),
        include_invalid: settings.includeInvalid,
        model: settings.model || null
      })
      setMessages((m) => [...m, { role: 'assistant', kg: settings.kg, kgLabel: kgName, result }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: `Gagal menjawab: ${errorText(e)}` }])
    } finally {
      setLoading(false)
    }
  }

  const settingsPanel = (
    <QuerySettings
      value={settings}
      onChange={setSettings}
      kgs={kgs.data ?? []}
      versions={meta.data?.versions ?? []}
      hasDraft={!!meta.data?.kg.has_draft}
      models={models}
    />
  )

  return (
    <div className="flex h-full gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <p className="text-muted-foreground truncate text-sm">{scope}</p>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal /> Parameter
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle className="sr-only">Parameter</SheetTitle>
              <SheetDescription className="sr-only">Sumber dan cara retrieval</SheetDescription>
              {settingsPanel}
            </SheetContent>
          </Sheet>
        </div>
        {health.data && !health.data.llm && (
          <p className="bg-warning-subtle text-warning rounded-md px-3 py-2 text-sm">API key LLM belum diisi di backend; periksa konfigurasi provider.</p>
        )}
        <div className="bg-background min-h-0 flex-1 overflow-y-auto rounded-lg border">
          <MessageList messages={messages} loading={loading} scope={scope} onSuggest={ask} />
        </div>
        <QueryComposer placeholder={messages.length ? 'Tanya lanjutan…' : `Tanyakan sesuatu tentang ${scope}…`} disabled={loading || !settings.kg} onSend={ask} />
      </div>
      <Card className="hidden w-[300px] shrink-0 overflow-y-auto p-4 lg:block">{settingsPanel}</Card>
    </div>
  )
}
