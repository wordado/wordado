import { type ReactNode, useId, useLayoutEffect } from 'react'
import { useModal } from './useModal'

/** A form or a question over the page: a native modal `<dialog>` named by its title, so the focus stays in it and
 * the page behind is out of reach. Escape and Close call `onClose`, and the focus goes back to what opened it; its
 * content exists only while it is open, so a form in it starts empty every time. `error` is what went wrong with what was done in it: the page's own notice is
 * behind the dialog (on a phone, under it). */
export function Dialog(props: { open: boolean; title: string; onClose(): void; error?: string; children: ReactNode }) {
  const { open } = props
  const { ref, close } = useModal(open, props.onClose)
  const titleId = useId()

  // Start in the first field, not on Close (after useModal has shown the dialog).
  useLayoutEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('.dialog-body :is(input, select, textarea)')?.focus()
  }, [open, ref])

  if (!open) return null
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={close}>
      <div className="dialog-head">
        <h2 id={titleId}>{props.title}</h2>
        <button type="button" className="button small ghost" onClick={close}>
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
