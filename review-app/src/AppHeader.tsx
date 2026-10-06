import type { ReactNode } from 'react'

/** The header both modes share: the wordmark, what the screen passes in (breadcrumb, tabs, actions), then the name. */
export function AppHeader(props: { children?: ReactNode; who?: string }) {
  return (
    <header className="app-header">
      <span className="wordmark">
        Word<b>ado</b> review
      </span>
      <span className="app-header-content">{props.children}</span>
      {props.who && <span className="app-header-who">{props.who}</span>}
    </header>
  )
}
