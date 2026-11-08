import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CircleAlert, FileText, LoaderCircle, Network, RefreshCw, Sparkles } from 'lucide-react'

import ConfirmDialog from '@/components/common/ConfirmDialog'
import PageHeader from '@/components/layout/PageHeader'
import Stepper from '@/components/layout/Stepper'
import FileDropzone from '@/components/upload/FileDropzone'
import { Field, SelectField } from '@/components/common/Field'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { api, errorText, groupIdFor, type SourcePreview } from '@/lib/api'
import { when } from '@/lib/time'

const OWNER_KEY = 'chat-kg-owner'
const readOwner = () => {
  try {
    return localStorage.getItem(OWNER_KEY) ?? ''
  } catch {
    return ''
  }
}

/** A3 — Upload a WhatsApp export, map "Anda" + contact names, preview episodes. */
export default function UploadPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [currentKg, setCurrentKg] = useCurrentKg()
  const kgs = useApi(() => api.listKgs(), [])
  const health = useApi(() => api.health(), [])
  const kg = params.get('kg') ?? currentKg ?? ''

  const [file, setFile] = useState<File | null>(null)
  const [owner, setOwner] = useState(readOwner)
  const [aliases, setAliases] = useState('')
  const [tz, setTz] = useState('')
  const [dateOrder, setDateOrder] = useState('auto')
  const [model, setModel] = useState('')
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [duplicateTarget, setDuplicateTarget] = useState('')

  useEffect(() => {
    if (!kg && kgs.data?.length) setParams({ kg: kgs.data[0].id }, { replace: true })
  }, [kg, kgs.data, setParams])

  useEffect(() => {
    if (!model && health.data?.llm_model) setModel(health.data.llm_model)
  }, [health.data?.llm_model, model])

  const kgInfo = kgs.data?.find((k) => k.id === kg)

  const send = async (f: File | null = file) => {
    if (!f || !kg) return
    if (!owner.trim()) {
      setError('Isi dulu nama pemilik akun (pengganti "Anda").')
      return
    }
    setBusy(true)
    setError(null)
    setDuplicateOpen(false)
    try {
      localStorage.setItem(OWNER_KEY, owner.trim())
    } catch {
      /* not critical */
    }
    try {
      const p = await api.uploadSource(kg, f, { owner: owner.trim(), aliases, tz, dateOrder: dateOrder === 'auto' ? '' : dateOrder })
      setPreview(p)
      if (p.duplicate_extractions.length) {
        setDuplicateTarget(p.duplicate_extractions[0].kg_id)
        setDuplicateOpen(true)
      } else {
        setDuplicateTarget('')
        setCurrentKg(kg)
      }
    } catch (e) {
      setPreview(null)
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const others = preview?.participants.filter((p) => p !== owner.trim()) ?? []

  const mapWithAi = async () => {
    if (!preview || !model || preview.duplicate_extractions.length) return
    setBusy(true)
    setError(null)
    try {
      const job = await api.startSchemaJob(kg, preview.source_id, model)
      navigate(`/upload/model?kg=${encodeURIComponent(kg)}&source=${encodeURIComponent(preview.source_id)}&job=${job.id}`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="workspace-page flex min-h-full flex-col gap-6">
      <PageHeader title="Upload chat" description="Isi mapping dan unggah chat. AI akan memetakan tipe entitas dan relasi secara otomatis.">
        <Stepper active={0} />
      </PageHeader>

      <div className="flex flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <Card className="space-y-4 p-6">
            <div className="space-y-1.5">
              <CardTitle>Unggah chat</CardTitle>
              <CardDescription>File .txt dari chat Whatsapp</CardDescription>
            </div>
            <FileDropzone
              onFiles={(files) => {
                const f = files[0]
                if (!f) return
                setFile(f)
                void send(f)
              }}
            />
            {file && (
              <div className="flex items-center gap-3 rounded-md border p-3">
                <FileText className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {(file.size / 1024).toFixed(1)} KB
                    {preview && ` · ${preview.counts.total} pesan (${preview.counts.text} teks, ${preview.counts.media} media, ${preview.counts.system} sistem)`}
                  </p>
                </div>
                {busy ? (
                  <Badge variant="info">
                    <LoaderCircle className="mr-1 size-3 animate-spin" /> Memproses…
                  </Badge>
                ) : preview ? (
                  preview.duplicate_extractions.length ? <Badge variant="warning">Sudah diekstrak</Badge> : <Badge variant="success">Terparse</Badge>
                ) : error ? (
                  <Badge variant="destructive">Gagal</Badge>
                ) : null}
              </div>
            )}
            {error && <p className="bg-destructive-subtle text-destructive rounded-md p-3 text-sm">{error}</p>}
          </Card>

          {preview && (
            <Card className="space-y-3 p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1.5">
                  <CardTitle>Preview episode</CardTitle>
                  <CardDescription>
                    Format tanggal {preview.date_order === 'MDY' ? 'M/D/YY' : 'D/M/YY'} · {when(preview.date_from)} – {when(preview.date_to)} ({preview.tz})
                  </CardDescription>
                </div>
                <Badge variant="secondary">{preview.episodes.length} episode · sesi jeda 6 jam</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                Peserta: {preview.participants.map((p) => <Badge key={p} variant="outline" className="mr-1">{p}</Badge>)}
              </p>
              <ol className="space-y-3">
                {preview.episodes.map((ep, i) => (
                  <li key={ep.name} className="rounded-md border p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">#{i + 1}</Badge>
                      <span className="text-muted-foreground">
                        {when(ep.start)} · {ep.lines}/{ep.messages} pesan dikirim ke LLM
                      </span>
                    </div>
                    <pre className="bg-code text-on-code overflow-x-auto rounded-md px-5 py-4 font-mono text-sm leading-5 whitespace-pre-wrap wrap-anywhere">{ep.body}</pre>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>

        <Card className="flex shrink-0 flex-col gap-4 p-6 lg:w-80 xl:w-[380px]">
          <div className="space-y-1.5">
            <CardTitle>Tujuan & mapping</CardTitle>
            <CardDescription>Ke KG mana hasil ekstraksi masuk</CardDescription>
          </div>
          <SelectField
            label="Knowledge graph"
            value={kg}
            onChange={(v) => {
              setParams({ kg: v })
              setPreview(null)
            }}
            options={(kgs.data ?? []).map((k) => ({ value: k.id, label: k.name }))}
          />
          {!kgs.data?.length && !kgs.loading && <p className="text-muted-foreground text-xs">Belum ada KG. Buat dulu di halaman Knowledge Graphs.</p>}
          <Field label='Nama pemilik akun ("Anda")'>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="mis. Pemilik" className="w-full" />
          </Field>
          <Field label="Alias nama kontak">
            <Textarea value={aliases} onChange={(e) => setAliases(e.target.value)} rows={2} placeholder={'Leon TC 24=Leon\nsatu per baris'} />
          </Field>
          {others.length > 0 && <p className="text-muted-foreground -mt-2 text-xs">Nama di file: {others.join(', ')}</p>}
          <SelectField
            label="Model AI"
            value={model}
            onChange={setModel}
            options={(health.data?.llm_models ?? []).map((value) => ({ value, label: value }))}
          />
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">Pengaturan waktu</summary>
            <div className="mt-3 grid gap-3 min-[480px]:grid-cols-2">
              <Field label="Zona waktu">
                <Input
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  placeholder={health.data?.default_tz ?? 'Asia/Jakarta'}
                  className="w-full"
                />
              </Field>
              <SelectField
                label="Format tanggal"
                value={dateOrder}
                onChange={setDateOrder}
                options={[
                  { value: 'auto', label: 'Deteksi otomatis' },
                  { value: 'MDY', label: 'M/D/YY' },
                  { value: 'DMY', label: 'D/M/YY' }
                ]}
              />
            </div>
            <p className="text-muted-foreground mt-2 text-xs">Ubah hanya jika tanggal atau waktu pada preview tidak sesuai.</p>
          </details>
          {file && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => send()}>
              <RefreshCw /> Terapkan mapping
            </Button>
          )}
          <div className="bg-card mt-auto flex flex-wrap justify-end gap-2 max-lg:sticky max-lg:bottom-0 max-lg:py-3">
            <Button variant="outline" size="sm" onClick={() => navigate('/kg')}>
              Batal
            </Button>
            <Button size="sm" disabled={!preview || busy || !model || !health.data?.llm || !!preview.duplicate_extractions.length} onClick={mapWithAi}>
              <Sparkles /> {busy ? 'Memulai AI…' : 'Petakan dengan AI'}
            </Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={duplicateOpen}
        onOpenChange={(open) => {
          setDuplicateOpen(open)
          if (!open) {
            setPreview(null)
            setFile(null)
            setDuplicateTarget('')
          }
        }}
        title="Chat ini sudah pernah diekstrak"
        description="Knowledge graph yang merujuk chat dengan isi identik sudah tersedia. Ekstraksi ulang diblokir agar fakta tidak terduplikasi."
        confirmLabel="Beralih ke knowledge graph"
        confirmIcon={<Network />}
        confirmDisabled={!duplicateTarget}
        onConfirm={() => {
          const target = preview?.duplicate_extractions.find((item) => item.kg_id === duplicateTarget)
          if (!target) return
          setCurrentKg(target.kg_id)
          navigate(`/kg/${encodeURIComponent(target.kg_id)}/graph?version=${encodeURIComponent(target.version)}`)
        }}
      >
        {preview && preview.duplicate_extractions.length > 1 ? (
          <SelectField
            label="Knowledge graph"
            value={duplicateTarget}
            onChange={setDuplicateTarget}
            options={preview.duplicate_extractions.map((item) => ({
              value: item.kg_id,
              label: `${item.kg_name} · ${item.version} · ${item.episodes} episode`
            }))}
          />
        ) : preview?.duplicate_extractions[0] ? (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">{preview.duplicate_extractions[0].kg_name}</p>
            <p className="text-muted-foreground">{preview.duplicate_extractions[0].version} · {preview.duplicate_extractions[0].episodes} episode</p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
