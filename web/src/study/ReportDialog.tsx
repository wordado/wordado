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

/** Report a problem with a card (spec §8.10). Works offline: the report is a document that syncs later. */
export function ReportDialog(props: { readonly wordId: WordId; readonly entry: CorpusEntry; readonly onClose: () => void }) {
  const { t } = useT()
  const client = useClient()
  const { packVersion } = useClientSnapshot()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [field, setField] = useState<ReportField>('translation')
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await client.report({ wordId: props.wordId, field, note: note.trim(), packVersion: packVersion ?? 0 })
    setSent(true)
  }

  return (
    <dialog ref={dialog} className="report" aria-labelledby={titleId} onCancel={props.onClose}>
      <h2 id={titleId}>{t('report.title', { word: props.entry.headword })}</h2>
      {sent ? (
        <>
          <p role="status">{t('report.sent')}</p>
          <button type="button" className="button" onClick={props.onClose}>
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
          <div className="actions">
            <button type="submit" className="button primary">
              {t('report.send')}
            </button>
            <button type="button" className="button" onClick={props.onClose}>
              {t('report.cancel')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
