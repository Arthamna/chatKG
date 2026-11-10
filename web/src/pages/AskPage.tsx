import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'

import MessageList, { type ChatMessage } from '@/components/ask/MessageList'
import QueryComposer from '@/components/ask/QueryComposer'
import QuerySettings, { type AskSettings } from '@/components/ask/QuerySettings'
import PageHeader from '@/components/layout/PageHeader'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { ApiError, api, errorText } from '@/lib/api'
import { localInputToIso } from '@/lib/time'

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
    model: ''
  })
  const meta = useApi(() => api.versions(settings.kg), [settings.kg], !!settings.kg)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [retryStatus, setRetryStatus] = useState('')

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
    setRetryStatus('')
    try {
      const maxRetries = 3
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await api.ask(settings.kg, {
            question: q,
            version: settings.version,
            top_k: Number(settings.topK),
            point_in_time: localInputToIso(settings.pointInTime),
            include_invalid: false,
            model: settings.model || null
          })
          setMessages((m) => [...m, { role: 'assistant', kg: settings.kg, kgLabel: kgName, result }])
          break
        } catch (e) {
          if (e instanceof ApiError && e.code && attempt < maxRetries) {
            setRetryStatus(`${e.message} (${attempt + 1}/${maxRetries})…`)
            await new Promise((resolve) => setTimeout(resolve, (e.retryAfter ?? 2 ** attempt) * 1000))
            continue
          }
          if (e instanceof ApiError && e.code) {
            throw new Error(`Gagal setelah ${maxRetries} retry otomatis: ${e.message.replace(', mencoba ulang kembali', '')}`)
          }
          throw e
        }
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: `Gagal menjawab: ${errorText(e)}` }])
    } finally {
      setLoading(false)
      setRetryStatus('')
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
    <div className="workspace-page flex h-full min-h-[42rem] flex-col gap-4 pb-6">
      <PageHeader
        title="Ask KG"
        description="Ajukan pertanyaan dan telusuri fakta sumber di knowledge graph."
      >
        <div className="lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal /> Parameter
              </Button>
            </SheetTrigger>
            <SheetContent className="pt-6">
              <SheetTitle className="sr-only">Parameter</SheetTitle>
              <SheetDescription className="sr-only">Sumber dan cara retrieval</SheetDescription>
              {settingsPanel}
            </SheetContent>
          </Sheet>
        </div>
      </PageHeader>
      <div className="flex min-h-0 flex-1 gap-4">
        <Card className="flex min-w-0 flex-1 flex-col">
          <div className="bg-muted border-divider flex items-center gap-2 rounded-t-md border-b px-4 py-3 text-sm sm:px-6">
            <span className="text-body-text shrink-0 font-semibold">Sumber</span>
            <span className="text-muted-foreground min-w-0 truncate" title={scope}>{scope}</span>
          </div>
          {health.data && !health.data.llm && (
            <p className="bg-warning-subtle text-warning m-3 rounded-md px-3 py-2 text-sm">API key LLM belum diisi di backend; periksa konfigurasi provider.</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MessageList messages={messages} loading={loading} loadingText={retryStatus} scope={scope} onSuggest={ask} />
          </div>
          <QueryComposer placeholder={messages.length ? 'Tanya lanjutan…' : `Tanyakan sesuatu tentang ${scope}…`} disabled={loading || !settings.kg} onSend={ask} />
        </Card>
        <Card className="hidden w-80 shrink-0 overflow-y-auto p-6 lg:block">{settingsPanel}</Card>
      </div>
    </div>
  )
}
