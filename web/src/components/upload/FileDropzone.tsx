import { useDropzone } from 'react-dropzone'
import { Upload } from 'lucide-react'

import { cn } from '@/lib/utils'

const ACCEPT = {
  'text/plain': ['.txt'],
  'application/json': ['.json'],
  'application/zip': ['.zip'],
  'text/csv': ['.csv']
}

export default function FileDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: onFiles, accept: ACCEPT, maxSize: 50 * 1024 * 1024 })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'border-border bg-muted hover:bg-secondary focus-visible:outline-2 flex cursor-pointer flex-col items-center gap-3 rounded-md border border-dashed px-5 py-6 text-center transition',
        isDragActive && 'border-focus-border bg-info-subtle'
      )}
    >
      <input {...getInputProps()} />
      <div className="bg-card rounded-md border p-3">
        <Upload className="text-muted-foreground size-7" aria-hidden="true" />
      </div>
      <p className="text-muted-foreground text-sm font-medium">
        {isDragActive ? 'Lepaskan file di sini' : 'Tarik & lepas file di sini, atau klik untuk memilih'}
      </p>
      <p className="text-muted-foreground text-[13px]">Bisa beberapa file sekaligus · maks 50 MB per file</p>
    </div>
  )
}
