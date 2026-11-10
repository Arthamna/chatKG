import { Link, NavLink } from 'react-router-dom'
import { LogOut, Menu, Moon, Settings, Sun } from 'lucide-react'

import { WorkspaceMark } from '@/components/layout/WorkspaceMascot'
import Button from '@/components/ui/Button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useCurrentKg } from '@/hooks/useCurrentKg'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const [kg] = useCurrentKg()
  const encodedKg = kg ? encodeURIComponent(kg) : ''
  const query = encodedKg ? `?kg=${encodedKg}` : ''
  const tabs = [
    { label: 'Dashboard', to: '/kg', end: true },
    { label: 'Upload', to: '/upload' },
    { label: 'Graph Editor', to: encodedKg ? `/kg/${encodedKg}/graph` : '/kg?pick=graph', pick: !kg },
    { label: 'Versions', to: encodedKg ? `/kg/${encodedKg}/versions` : '/kg?pick=versions', pick: !kg },
    { label: 'Ask KG', to: `/ask${query}` }
  ]

  return (
    <nav aria-label="Navigasi utama" className={mobile ? 'flex flex-col gap-1' : 'mx-auto flex max-w-workspace gap-1 px-6'}>
      {tabs.map(({ label, to, end, pick }) => {
        const link = (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-current={pick ? false : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center border px-3 font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2',
                mobile ? 'min-h-10 rounded-md' : 'h-9 rounded-t-md border-b-0',
                isActive && !pick
                  ? 'border-border bg-card text-foreground'
                  : 'text-body-text border-transparent hover:bg-card/60'
              )
            }
          >
            {label}
          </NavLink>
        )
        return mobile ? <SheetClose key={to} asChild>{link}</SheetClose> : link
      })}
    </nav>
  )
}

interface AppHeaderProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export default function AppHeader({ theme, onToggleTheme }: AppHeaderProps) {
  const health = useApi(() => api.health(), [])
  const db = health.data?.neo4j
  const accountActions = (
    <>
      <Button variant="ghost" size="icon" tooltip="Pengaturan" side="bottom"><Settings /></Button>
      <Button variant="ghost" size="icon" tooltip="Keluar" side="bottom"><LogOut /></Button>
    </>
  )

  return (
    <header className="bg-background border-divider shrink-0 border-b">
      <div className="mx-auto grid h-14 max-w-workspace grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 md:flex md:justify-between md:px-6">
        <div className="md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Buka navigasi"><Menu /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-background gap-6 pt-6">
              <div className="flex items-center gap-2 pr-8">
                <WorkspaceMark />
                <SheetTitle className="font-bold">chatKG</SheetTitle>
              </div>
              <SheetDescription className="sr-only">Navigasi chatKG</SheetDescription>
              <Navigation mobile />
              <div className="border-divider mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className="text-muted-foreground text-sm">{status}</p>
                <div className="flex items-center">{accountActions}</div>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <Link to="/kg" className="flex items-center gap-2 rounded-md font-bold whitespace-nowrap focus-visible:outline-2">
          <WorkspaceMark />
          chatKG
        </Link>

        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" tooltip={theme === 'dark' ? 'Mode terang' : 'Mode gelap'} side="bottom" onClick={onToggleTheme}>
            {theme === 'dark' ? <Moon /> : <Sun />}
          </Button>
          <div className="hidden items-center md:flex">{accountActions}</div>
        </div>
      </div>
      <div className="bg-secondary border-divider hidden border-t pt-0.5 md:block">
        <Navigation />
      </div>
    </header>
  )
}
