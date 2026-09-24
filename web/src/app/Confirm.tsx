import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n/i18n'

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface ConfirmDialogProps {
  readonly title: string
  readonly body: ReactNode
  readonly confirmLabel: string
  onConfirm(): Promise<void> | void
  onClose(): void
  readonly confirmDisabled?: boolean
  /** Extra content between the text and the buttons, such as an "I understand" checkbox. */
  readonly children?: ReactNode
}

/**
 * The modal every destructive action confirms through (spec §11.1): a
 * native `<dialog>`, named by its title and described by its text, Escape
 * cancels, and focus returns to what opened it. A failure is shown inside it.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const bodyId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => {
      if (opener.current?.isConnected) opener.current.focus()
    }
  }, [])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await props.onConfirm()
      dialog.current?.close()
      props.onClose()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} className="confirm" aria-labelledby={titleId} aria-describedby={bodyId} onClose={props.onClose}>
      <h2 id={titleId}>{props.title}</h2>
      <div id={bodyId}>{props.body}</div>
      {props.children}
      {error !== null && <p role="alert">{t('confirm.failed', { message: error })}</p>}
      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            dialog.current?.close()
            props.onClose()
          }}
        >
          {t('confirm.cancel')}
        </button>
        <button type="button" className="button danger" disabled={busy || props.confirmDisabled === true} onClick={() => void confirm()}>
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
