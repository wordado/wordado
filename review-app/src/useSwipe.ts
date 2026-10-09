import { useLayoutEffect, useRef, type RefObject } from 'react'

/** A swipe counts from this much horizontal movement (px) on. */
const MIN_DISTANCE = 60
/** A gesture that starts on one of these belongs to it: typing, choosing, pressing, or a dialog over the page. */
const NOT_FROM = 'input, textarea, select, button, [role=dialog], dialog'

/** Calls `onLeft` when a finger (or pen) swipes to the left over the element and `onRight` for a swipe to the
 * right: more than 60px sideways, and more sideways than up or down. A gesture that starts on a control, and one the
 * browser took over as a scroll, does nothing; a mouse drag does nothing either (it selects text). The element
 * needs `touch-action: pan-y`, so the browser leaves horizontal movement to the page. The handlers may change
 * between renders: a swipe under way goes on, and ends with the handlers of the moment the finger lifts. */
export function useSwipe(ref: RefObject<HTMLElement | null>, handlers: { onLeft(): void; onRight(): void }): void {
  // The listeners are attached once and read the handlers from here, so a render in the middle of a swipe does not
  // take the listeners (and the swipe's start) away. Both in layout effects, like the keys (useKeys): they are there,
  // with the handlers of this render, as soon as the element is on screen.
  const latest = useRef(handlers)
  useLayoutEffect(() => {
    latest.current = handlers
  })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let start: { id: number; x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      start = null
      if (e.pointerType === 'mouse' || !e.isPrimary) return
      if (e.target instanceof Element && e.target.closest(NOT_FROM)) return
      start = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }
    const up = (e: PointerEvent) => {
      const from = start
      start = null
      if (!from || from.id !== e.pointerId) return
      const dx = e.clientX - from.x
      const dy = e.clientY - from.y
      if (Math.abs(dx) <= MIN_DISTANCE || Math.abs(dx) <= Math.abs(dy)) return
      if (dx < 0) latest.current.onLeft()
      else latest.current.onRight()
    }
    const cancel = () => {
      start = null
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
    }
  }, [ref])
}
