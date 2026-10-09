import { useLayoutEffect } from 'react'

/** Calls handlers[key] on a keydown outside text fields (input, textarea, select, anything contentEditable) and
 * without a modifier (Ctrl, Meta, Alt), so typing and browser/OS shortcuts are left alone. While a dialog is open
 * (the row list, a form) the keys belong to it: nothing behind it reacts, wherever the focus is. The same while a
 * menu is open (the account menu marks itself `data-menu-open`).
 *
 * The listener is set in a layout effect, so it is there as soon as what it serves is on screen: an ordinary effect
 * runs a moment later, and a key pressed in between went nowhere (issue #101). */
export function useKeys(handlers: Readonly<Record<string, () => void>>): void {
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (document.querySelector('dialog[open], [data-menu-open]')) return
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
