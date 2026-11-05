import { useSyncExternalStore } from 'react'

/** Tracks the `.dark` class on <html> so canvas renderers (sigma) can follow the theme. */
export function useIsDark() {
  return useSyncExternalStore(
    (onChange) => {
      const obs = new MutationObserver(onChange)
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      return () => obs.disconnect()
    },
    () => document.documentElement.classList.contains('dark'),
    () => false
  )
}
