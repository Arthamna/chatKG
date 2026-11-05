export function WorkspaceMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true" fill="none">
      <rect x="0.5" y="0.5" width="31" height="31" rx="5.5" className="fill-card stroke-border" />
      <path d="m6 20 1-5 2 1 1-5 3 2 2-5 2 5 4-1-1 4 4 1 3 3-4 3-5-1c-5 3-10 2-12-2Z" className="fill-secondary stroke-foreground" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22" cy="18.5" r="0.9" className="fill-foreground" />
      <path d="m10 19 2-3m2 3 2-4m1 8v2m5-3 1 2" className="stroke-foreground" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** A small field sketch for workspace pages. */
export default function WorkspaceMascot({ className = 'hidden h-auto w-40 shrink-0 lg:block xl:w-48' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 112" className={className} aria-hidden="true" fill="none">
      <g className="stroke-border" strokeWidth="1.2" strokeLinecap="round">
        <path d="M7 100c29-3 57 1 89 0m24 0c23-2 47-1 68-3M27 104l35 1m94-2 22-1" />
        <path d="m139 17 3-5m4 8 6-2m-20 0-2-5m50 21 5-2m-2 7 6 1" />
      </g>
      <g className="stroke-foreground" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path className="fill-secondary" d="M22 85c-4-5-5-10-5-15l5 2-2-11 7 3-1-12 7 4 3-11 7 5 5-12 6 7 8-10 5 8 8-8 4 9 9-4 1 9 9 1-1 8 7 5-4 11-16 15-30 9c-13 2-25-3-32-13Z" />
        <path d="m28 75 5-7m-3 13 8-6m-1 13 8-6m-6-16 6-9m0 14 8-11m-6 20 9-7m-8 15 11-7m-3-24 6-9m-1 18 8-12m-5 19 9-9m0-9 7-8m-6 19 8-6" />
        <path className="fill-card" d="M58 91c8-9 9-17 17-24 4-4 10-5 16-4 4-3 8-2 10 2 5 2 10 6 13 11l-9 7-10-1c-5 10-17 15-28 14-4 0-7-2-9-5Z" />
        <path d="M92 65c-4-8-10-8-12-2m21 14 4 1m-30 17-3 4m19-10 4 8m-27-8 8-2" />
        <circle cx="98" cy="70" r="1" className="fill-foreground" />
        <path d="m110 74 4 2-3 3" className="fill-foreground" />
        <path d="m105 91 21-27m-19 30 22-28" />
        <path className="fill-card" d="M99 88c2-3 6-4 9-2l2 3c-2 4-6 5-9 3m42-67c14 0 24 9 24 22 0 12-10 22-24 22-13 0-23-10-23-22 0-13 10-22 23-22Z" />
        <path d="M143 29c12 0 20 8 20 18 0 11-9 18-20 18-10 0-19-8-19-18s9-18 19-18Z" className="stroke-border" strokeWidth="1.2" />
        <path d="m133 50 9-13 11 15-20-2m20 2 2-11" />
        <circle cx="133" cy="50" r="3" className="fill-secondary" />
        <circle cx="142" cy="37" r="3" className="fill-secondary" />
        <circle cx="153" cy="52" r="3.5" className="fill-foreground" />
        <circle cx="155" cy="41" r="2" className="fill-card" />
        <path d="m166 84 7-11 12 9-19 2" className="stroke-border" />
        <circle cx="166" cy="84" r="2.5" className="fill-background stroke-muted-foreground" />
        <circle cx="173" cy="73" r="2.5" className="fill-background stroke-muted-foreground" />
        <circle cx="185" cy="82" r="2.5" className="fill-background stroke-muted-foreground" />
      </g>
    </svg>
  )
}
