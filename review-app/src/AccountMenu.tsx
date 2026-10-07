import { useEffect, useId, useRef, useState } from 'react'

/** Who is using the app: the hosted mode knows the email and where Cloudflare Access signs out; the local mode
 * only the name decisions are recorded under. */
export interface Account {
  readonly name: string
  readonly email?: string
  readonly signOutHref?: string
}

/** The first letter of the first word and of the last word of a name, upper-cased; one word gives one letter, no
 * letter at all "?". A word is what stands between whitespace (a hyphen is part of it); its first letter is its
 * first Unicode letter, so quotes and brackets are skipped, and a word without a letter does not count. */
export function initials(name: string): string {
  const letters = name.split(/\s+/).flatMap((word) => /\p{L}/u.exec(word)?.[0] ?? [])
  const first = letters[0]
  if (first === undefined) return '?'
  return (first + (letters.length > 1 ? letters[letters.length - 1]! : '')).toUpperCase()
}

/** The account in the header: a round button with the initials, and under it a menu with the full name, the email
 * and Sign out (hosted), or where the app runs (local). A click, Enter or Space opens and closes it; Escape and a
 * press outside close it and give the focus back to the button; it also closes when the focus goes elsewhere (a
 * dialog opening). While it is open it is marked `data-menu-open`, which keeps the review keys off (`useKeys`). */
export function AccountMenu(props: { account: Account }) {
  const { name, email, signOutHref } = props.account
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const outside = (target: EventTarget | null) => !(target instanceof Node && root.current?.contains(target))
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const onPress = (e: PointerEvent) => {
      if (!outside(e.target)) return
      setOpen(false)
      // Once the press has moved the focus: it comes back to the button unless it went to another control.
      setTimeout(() => {
        const active = document.activeElement
        if (!active || active === document.body) button.current?.focus()
      }, 0)
    }
    const onFocus = (e: FocusEvent) => {
      if (outside(e.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
      document.removeEventListener('focusin', onFocus)
    }
  }, [open])

  // The down arrow opens the menu and goes to its first action.
  const [toFirst, setToFirst] = useState(false)
  useEffect(() => {
    if (!open || !toFirst) return
    setToFirst(false)
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open, toFirst])

  return (
    <span className="account" ref={root} {...(open ? { 'data-menu-open': '' } : {})}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-label={`Account: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? { 'aria-controls': menuId } : {})}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown') return
          e.preventDefault()
          setOpen(true)
          setToFirst(true)
        }}
      >
        <span aria-hidden="true">{initials(name)}</span>
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label="Account" className="account-menu">
          <div className="account-who" role="none">
            <strong>{name}</strong>
            {email && <span className="account-email">{email}</span>}
          </div>
          <hr />
          {signOutHref ? (
            // A plain link: the browser leaves the app for Cloudflare Access's sign-out.
            <a role="menuitem" className="account-action" href={signOutHref}>
              Sign out
            </a>
          ) : (
            <p className="account-note">Running on this computer.</p>
          )}
        </div>
      )}
    </span>
  )
}
