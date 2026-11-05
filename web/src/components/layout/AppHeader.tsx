import { NavLink } from 'react-router-dom'
import { LogOut, Settings, Sun, Moon, Zap } from 'lucide-react'

import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { api } from '@/lib/api'

/** Tabs point at the KG last opened (stored locally); without one they lead to the KG list. */
function useTabs() {
  const [kg] = useCurrentKg()
  const q = kg ? `?kg=${encodeURIComponent(kg)}` : ''
  return [
    { label: 'Knowledge Graphs', to: '/kg', end: true },
    { label: 'Upload', to: `/upload${q}`, end: false },
    { label: 'Graph Editor', to: kg ? `/kg/${kg}/graph` : '/kg?pick=graph', end: false },
    { label: 'Versions', to: kg ? `/kg/${kg}/versions` : '/kg?pick=versions', end: false },
    { label: 'Ask KG', to: `/ask${q}`, end: false }
  ]
}

interface AppHeaderProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

/** LightRAG SiteHeader: h-10, border-b, Zap emerald, centered tabs, actions on the right. */
export default function AppHeader({ theme, onToggleTheme }: AppHeaderProps) {
  const tabs = useTabs()
  const health = useApi(() => api.health(), [])
  const db = health.data?.neo4j
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 flex h-10 w-full shrink-0 items-center gap-3 border-b px-4 backdrop-blur">
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap lg:w-[280px]">
        <Zap className="text-brand size-4" aria-hidden="true" />
        <span className="font-semibold">Chat → KG</span>
        <span className="text-muted-foreground hidden text-xs xl:inline" aria-hidden="true">
          |
        </span>
        <span className="hidden text-sm font-medium xl:inline">Knowledge Workspace</span>
      </div>

      <nav className="flex min-w-0 flex-1 justify-center" aria-label="Navigasi utama">
        <div className="bg-muted flex max-w-full gap-2 overflow-x-auto rounded-lg p-0.5 [scrollbar-width:none]">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'rounded-sm px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive ? 'bg-brand text-brand-foreground shadow-sm' : 'hover:bg-background/60'
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="flex shrink-0 items-center justify-end gap-1 lg:w-[280px]">
        <span
          className="text-muted-foreground mr-1 hidden items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium md:inline-flex"
          title={health.data ? `${health.data.neo4j_uri} · Groq ${health.data.groq ? health.data.groq_model : 'belum diisi'}` : health.error ?? ''}
        >
          <span className={cn('size-1.5 rounded-full', db ? 'bg-success' : db === false || health.error ? 'bg-destructive' : 'bg-muted-foreground')} />
          {health.error ? 'API offline' : db === false ? 'Neo4j offline' : 'Neo4j · self-hosted'}
        </span>
        <Button variant="ghost" size="icon" tooltip={theme === 'dark' ? 'Mode terang' : 'Mode gelap'} side="bottom" onClick={onToggleTheme}>
          {theme === 'dark' ? <Moon /> : <Sun />}
        </Button>
        <Button variant="ghost" size="icon" tooltip="Pengaturan" side="bottom">
          <Settings />
        </Button>
        <Button variant="ghost" size="icon" tooltip="Keluar" side="bottom">
          <LogOut />
        </Button>
      </div>
    </header>
  )
}
