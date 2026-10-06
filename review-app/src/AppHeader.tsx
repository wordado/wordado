import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The header both modes share: the wordmark, what the screen passes in (breadcrumb, tabs, actions), then the name.
 * A screen further down the tree puts its own controls into the header with `HeaderSlot`; they come first. */
export function AppHeader(props: { children?: ReactNode; who?: string }) {
  return (
    <header className="app-header">
      <span className="wordmark">
        Word<b>ado</b> review
      </span>
      <span className="app-header-content">
        <span className="app-header-slot" data-header-slot="" />
        {props.children}
      </span>
      {props.who && <span className="app-header-who">{props.who}</span>}
    </header>
  )
}

/** Renders its children inside the page's `AppHeader`, wherever in the tree it is used; in a page without the
 * header, in place. */
export function HeaderSlot(props: { children: ReactNode }) {
  // undefined until the header was looked for: nothing is drawn in the wrong place first.
  const [slot, setSlot] = useState<Element | null | undefined>(undefined)
  useEffect(() => setSlot(document.querySelector('[data-header-slot]')), [])
  if (slot === undefined) return null
  return slot ? createPortal(props.children, slot) : <div className="app-header-content">{props.children}</div>
}
