import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string | null
  title: string
  description?: string | null
  children?: ReactNode
}

export default function PageHeader({ eyebrow, title, description, children }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-[44rem] space-y-1">
        <p className="text-body-text text-xs leading-4 font-bold uppercase">{eyebrow}</p>
        <h1 className="text-[28px] leading-[1.5] font-bold sm:text-4xl">{title}</h1>
        <p className="text-body-text leading-6 wrap-anywhere">{description}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}
