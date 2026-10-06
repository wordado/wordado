import { useEffect } from 'react'

/** Calls handlers[key] on a keydown outside text fields (input, textarea, select, anything contentEditable) and
 * without a modifier (Ctrl, Meta, Alt), so typing and browser/OS shortcuts are left alone. While a dialog is open
 * (the row list, a form) the keys belong to it: nothing behind it reacts, wherever the focus is. */
export function useKeys(handlers: Readonly<Record<string, () => void>>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (document.querySelector('dialog[open]')) return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
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
