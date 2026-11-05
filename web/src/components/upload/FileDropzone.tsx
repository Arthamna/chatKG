import { useDropzone } from 'react-dropzone'
import { Upload } from 'lucide-react'

import { cn } from '@/lib/utils'

const ACCEPT = {
  'text/plain': ['.txt'],
  'application/json': ['.json'],
  'application/zip': ['.zip'],
  'text/csv': ['.csv']
}

/** LightRAG FileUploader look: dashed border-2, round upload icon, helper text. */
export default function FileDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: onFiles, accept: ACCEPT, maxSize: 50 * 1024 * 1024 })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'border-muted-foreground/25 hover:bg-muted/25 flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-5 py-6 text-center transition',
        isDragActive && 'border-muted-foreground/50 bg-muted/25'
      )}
    >
      <input {...getInputProps()} />
      <div className="rounded-full border border-dashed p-3">
        <Upload className="text-muted-foreground size-7" aria-hidden="true" />
      </div>
      <p className="text-muted-foreground text-sm font-medium">
        {isDragActive ? 'Lepaskan file di sini' : 'Tarik & lepas file di sini, atau klik untuk memilih'}
      </p>
      <p className="text-muted-foreground/70 text-xs">Bisa beberapa file sekaligus · maks 50 MB per file</p>
    </div>
  )
}
