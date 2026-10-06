import { type ReactNode, useEffect, useId, useLayoutEffect, useRef } from 'react'

/** A form or a question over the page: a native modal `<dialog>` named by its title, so the focus stays in it and
 * the page behind is out of reach. Escape and Close call `onClose`; its content exists only while it is open, so a
 * form in it starts empty every time. `error` is what went wrong with what was done in it: the page's own notice is
 * behind the dialog (on a phone, under it). */
export function Dialog(props: { open: boolean; title: string; onClose(): void; error?: string; children: ReactNode }) {
  const { open, onClose } = props
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    if (!dialog.open) {
      // happy-dom and old browsers: no showModal, the open attribute shows it.
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      // Start in the first field, not on Close.
      dialog.querySelector<HTMLElement>('.dialog-body :is(input, select, textarea)')?.focus()
    }
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
    }
  }, [open])

  // A modal dialog closes itself on Escape (onClose below hears it); this covers a dialog that is not modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="dialog-head">
        <h2 id={titleId}>{props.title}</h2>
        <button type="button" className="button small ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="dialog-body">
        {props.error && (
          <p role="alert" className="dialog-error">
            {props.error}
          </p>
        )}
        {props.children}
      </div>
    </dialog>
  )
}
