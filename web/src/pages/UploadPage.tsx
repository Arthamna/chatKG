import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CircleAlert, FileText, LoaderCircle, RefreshCw } from 'lucide-react'

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
  const kg = params.get('kg') ?? currentKg ?? ''

  const [file, setFile] = useState<File | null>(null)
  const [owner, setOwner] = useState(readOwner)
  const [aliases, setAliases] = useState('')
  const [tz, setTz] = useState('Asia/Jakarta')
  const [dateOrder, setDateOrder] = useState('auto')
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!kg && kgs.data?.length) setParams({ kg: kgs.data[0].id }, { replace: true })
  }, [kg, kgs.data, setParams])

  const kgInfo = kgs.data?.find((k) => k.id === kg)

  const send = async (f: File | null = file) => {
    if (!f || !kg) return
    if (!owner.trim()) {
      setError('Isi dulu nama pemilik akun (pengganti "Anda").')
      return
    }
    setBusy(true)
    setError(null)
    try {
      localStorage.setItem(OWNER_KEY, owner.trim())
    } catch {
      /* not critical */
    }
    try {
      const p = await api.uploadSource(kg, f, { owner: owner.trim(), aliases, tz, dateOrder: dateOrder === 'auto' ? '' : dateOrder })
      setPreview(p)
      setCurrentKg(kg)
      navigate(`/upload/model?kg=${encodeURIComponent(kg)}&source=${encodeURIComponent(p.source_id)}`)
    } catch (e) {
      setPreview(null)
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const others = preview?.participants.filter((p) => p !== owner.trim()) ?? []

  return (
    <div className="flex min-h-full flex-col gap-5 px-4 py-6 md:px-8">
      <PageHeader title="Upload chat" description="Isi mapping peserta, lalu unggah chat. AI akan memetakan tipe entitas dan relasi secara otomatis.">
        <Stepper active={0} />
      </PageHeader>

      <div className="flex flex-1 flex-col gap-5 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <Card className="space-y-4 p-6">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Unggah export chat</CardTitle>
              <CardDescription>WhatsApp (iOS) “Ekspor chat” tanpa media · file .txt</CardDescription>
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
              <div className="flex items-center gap-3 rounded-lg border p-3">
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
                  <Badge variant="success">Terparse</Badge>
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
                  <CardTitle className="text-base">Preview episode</CardTitle>
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
                  <li key={ep.name} className="rounded-lg border p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">#{i + 1}</Badge>
                      <span className="text-muted-foreground">
                        {when(ep.start)} · {ep.lines}/{ep.messages} pesan dikirim ke LLM
                      </span>
                    </div>
                    <pre className="bg-muted overflow-x-auto rounded-md p-2.5 font-mono text-xs whitespace-pre-wrap">{ep.body}</pre>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>

        <Card className="flex shrink-0 flex-col gap-4 p-6 lg:w-80 xl:w-[380px]">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Tujuan & mapping</CardTitle>
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Zona waktu">
              <Input value={tz} onChange={(e) => setTz(e.target.value)} className="w-full" />
            </Field>
            <SelectField
              label="Format tanggal"
              value={dateOrder}
              onChange={setDateOrder}
              options={[
                { value: 'auto', label: 'Deteksi' },
                { value: 'MDY', label: 'M/D/YY' },
                { value: 'DMY', label: 'D/M/YY' }
              ]}
            />
          </div>
          {file && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => send()}>
              <RefreshCw /> Terapkan mapping
            </Button>
          )}
          <div className="flex gap-3 rounded-lg border p-4">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Versi lama aman</p>
              <p className="text-muted-foreground text-sm">
                Ingest menulis ke draft ({groupIdFor(kg || 'kg', 'draft')}){kgInfo?.latest ? `, salinan penuh v${kgInfo.latest}` : ''}. Versi ber-nomor tidak berubah sampai kamu commit.
              </p>
            </div>
          </div>
          <div className="bg-card mt-auto flex justify-end gap-2 max-lg:sticky max-lg:bottom-0 max-lg:py-3">
            <Button variant="outline" size="sm" onClick={() => navigate('/kg')}>
              Batal
            </Button>
            <Button size="sm" disabled={!preview || busy} onClick={() => preview && navigate(`/upload/model?kg=${kg}&source=${preview.source_id}`)}>
              Tinjau tipe hasil AI <ArrowRight />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
