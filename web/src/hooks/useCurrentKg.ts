import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'chat-kg-current'
const listeners = new Set<() => void>()

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** The KG the header tabs (Upload / Graph Editor / Versions / Ask) point at. */
export function useCurrentKg(): [string | null, (id: string | null) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    () => null
  )
  const set = useCallback((id: string | null) => {
    try {
      if (id) localStorage.setItem(KEY, id)
      else localStorage.removeItem(KEY)
    } catch {
      /* storage unavailable: header falls back to the KG list */
    }
    listeners.forEach((l) => l())
  }, [])
  return [value, set]
}
