import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

import { errorText } from '@/lib/api'

/** Load data from the API; `reload` refetches, `setData` allows optimistic updates. */
export function useApi<T>(fn: () => Promise<T>, deps: DependencyList, enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const seq = useRef(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)

  const reload = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    try {
      const result = await run()
      if (id === seq.current) {
        setData(result)
        setError(null)
      }
      return result
    } catch (e) {
      if (id === seq.current) setError(errorText(e))
      return null
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [run])

  useEffect(() => {
    if (enabled) void reload()
  }, [reload, enabled])

  return { data, error, loading, reload, setData }
}
