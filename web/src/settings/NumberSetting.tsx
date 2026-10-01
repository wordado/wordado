import { useEffect, useId, useState } from 'react'
import { useT } from '../i18n/i18n'
import { parseWholeNumber } from './fields'

/**
 * A number field saved when it is left or Enter is pressed, with − and +
 * beside it that save one step at once. What the learner types stays in the
 * field until it is valid; an invalid value is explained at the field and
 * never reaches `updateSettings`.
 */
export function NumberSetting(props: {
  readonly label: string
  readonly hint: string
  readonly invalid: string
  readonly value: number
  readonly min: number
  readonly max: number
  onSave(value: number): Promise<void>
}) {
  const { t } = useT()
  const id = useId()
  const hintId = useId()
  const errorId = useId()
  const [text, setText] = useState(String(props.value))
  const [error, setError] = useState(false)
  // A value changed elsewhere (a pull, another field) replaces the text unless the learner is mid-edit with an error.
  useEffect(() => {
    if (!error) setText(String(props.value))
  }, [props.value])
  const commit = async () => {
    const value = parseWholeNumber(text, props.min, props.max)
    setError(value === null)
    if (value !== null && value !== props.value) await props.onSave(value)
  }
  /** One step from what the field shows (or the saved value, while it shows something invalid). */
  const step = async (by: number) => {
    const from = parseWholeNumber(text, props.min, props.max) ?? props.value
    const value = Math.min(props.max, Math.max(props.min, from + by))
    setText(String(value))
    setError(false)
    if (value !== props.value) await props.onSave(value)
  }
  return (
    <div className="field number-field">
      <label htmlFor={id}>{props.label}</label>
      <div className="stepper">
        <button type="button" aria-label={t('settings.less', { label: props.label })} disabled={props.value <= props.min} onClick={() => void step(-1)}>
          −
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={text}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          aria-invalid={error || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
          }}
        />
        <button type="button" aria-label={t('settings.more', { label: props.label })} disabled={props.value >= props.max} onClick={() => void step(1)}>
          +
        </button>
      </div>
      <p className="note" id={hintId}>
        {props.hint}
      </p>
      {error && (
        <p className="field-error" role="alert" id={errorId}>
          {props.invalid}
        </p>
      )}
    </div>
  )
}
