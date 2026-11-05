import { useState } from 'react'
import { Send } from 'lucide-react'

import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

interface QueryComposerProps {
  placeholder: string
  disabled?: boolean
  onSend: (q: string) => void
}

export default function QueryComposer({ placeholder, disabled, onSend }: QueryComposerProps) {
  const [q, setQ] = useState('')
  const submit = () => {
    if (!q.trim() || disabled) return
    onSend(q.trim())
    setQ('')
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Pertanyaan" className="h-10 flex-1" />
      <Button type="submit" disabled={disabled || !q.trim()}>
        <Send /> Kirim
      </Button>
    </form>
  )
}
