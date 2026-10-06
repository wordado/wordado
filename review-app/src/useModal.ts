import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/** What a dialog that exists only while it is open needs (`Dialog`, the row list): it is shown as a modal when it
 * appears, and when it goes the focus is back where it was before, if that is still in the page. Returns the ref for
 * the `<dialog>` and `close`, which is both its `onClose` and what its own Close button calls: `onClose` is called
 * once per close.
 *
 * Escape is the browser's: a modal dialog closes itself and says so (`close`). Only where there is no `showModal`
 * (happy-dom's is no modal either, but it has one) does a key listener stand in for it. */
export function useModal(open: boolean, onClose: () => void): { ref: RefObject<HTMLDialogElement | null>; close: () => void } {
  const ref = useRef<HTMLDialogElement>(null)
  const latest = useRef(onClose)
  /** `close` events still to come from closing the dialog here, not from the reviewer: they are not a close to report */
  const own = useRef(0)
  useLayoutEffect(() => {
    latest.current = onClose
  })
  const close = useCallback(() => {
    if (own.current > 0) own.current -= 1
    else latest.current()
  }, [])

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const opener = document.activeElement
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => {
      // React has usually taken the dialog out of the page by now, and a removed dialog gives no focus back. When
      // it is still there (the whole screen is going), it is closed first: what is behind a modal takes no focus.
      if (dialog.isConnected && dialog.open && typeof dialog.close === 'function') {
        own.current += 1
        dialog.close()
      }
      const active = document.activeElement
      const lost = !active || active === document.body || dialog.contains(active)
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog || typeof dialog.showModal === 'function') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  return { ref, close }
}
