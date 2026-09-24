import { useClient, useClientSnapshot } from '@wordado/client-data'
import { MAX_REPORT_NOTE_LENGTH, REPORT_FIELDS, type CorpusEntry, type ReportField, type WordId } from '@wordado/core'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'

const FIELD_LABEL: Readonly<Record<ReportField, MessageKey>> = {
  translation: 'report.translation',
  example: 'report.example',
  audio: 'report.audio',
  level: 'report.level',
  other: 'report.other',
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Report a problem with a card (spec §8.10). Works offline: the report is a document that syncs later. */
export function ReportDialog(props: { readonly wordId: WordId; readonly entry: CorpusEntry; readonly onClose: () => void }) {
  const { t } = useT()
  const client = useClient()
  const { packVersion } = useClientSnapshot()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [field, setField] = useState<ReportField>('translation')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const submitting = useRef(false)
  const continueButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  // The Continue button is announced and takes focus once the report is saved (spec §11.1).
  useEffect(() => {
    if (sent) continueButton.current?.focus()
  }, [sent])

  // Cancel/Continue close the dialog themselves; its own 'close' event unmounts it, so focus
  // never has to move off an element React is about to remove (unlike a cleanup calling close()).
  const close = () => dialog.current?.close()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setSending(true)
    setError(null)
    try {
      await client.report({ wordId: props.wordId, field, note: note.trim(), packVersion: packVersion ?? 0 })
      setSent(true)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      submitting.current = false
      setSending(false)
    }
  }

  return (
    <dialog ref={dialog} className="report" aria-labelledby={titleId} onClose={props.onClose}>
      <h2 id={titleId}>{t('report.title', { word: props.entry.headword })}</h2>
      {sent ? (
        <>
          <p role="status">{t('report.sent')}</p>
          <button type="button" ref={continueButton} className="button" onClick={close}>
            {t('study.continue')}
          </button>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <fieldset>
            <legend>{t('report.field')}</legend>
            {REPORT_FIELDS.map((value) => (
              <label key={value}>
                <input type="radio" name="field" value={value} checked={field === value} onChange={() => setField(value)} />
                {t(FIELD_LABEL[value])}
              </label>
            ))}
          </fieldset>
          <label>
            {t('report.note')}
            <textarea value={note} maxLength={MAX_REPORT_NOTE_LENGTH} rows={3} onChange={(event) => setNote(event.target.value)} />
          </label>
          {error !== null && <p role="alert">{t('study.error', { message: error })}</p>}
          <div className="actions">
            <button type="submit" className="button primary" disabled={sending}>
              {t('report.send')}
            </button>
            <button type="button" className="button" onClick={close}>
              {t('report.cancel')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
