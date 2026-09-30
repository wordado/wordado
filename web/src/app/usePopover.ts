import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useRoute } from '../router'

/**
 * A small panel opened by a masthead button (disclosure pattern): Escape
 * closes it and returns focus to the button, a press outside or a
 * navigation closes it quietly.
 */
export function usePopover() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const route = useRoute()

  // Choosing an item navigates; the panel closes behind it.
  useEffect(() => setOpen(false), [route])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  /** Closes the panel and puts focus back on its button. */
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return {
    open,
    close,
    root,
    trigger,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) close()
    },
    triggerProps: { 'aria-expanded': open, 'aria-controls': panelId, onClick: () => setOpen(!open) },
    panelId,
  }
}
