import { useEffect } from 'react'

/** Calls handlers[key] on a keydown outside text fields. */
export function useKeys(handlers: Readonly<Record<string, () => void>>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const h = handlers[e.key] ?? handlers[e.key.toLowerCase()]
      if (h) {
        e.preventDefault()
        h()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}
