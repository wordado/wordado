import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../i18n/i18n'

/** What each step after the language gets from `Setup` (plan 11). */
export interface StepProps {
  /** True on the last step: Start studying is then its primary button, and there is nothing to skip to. */
  readonly last: boolean
  /** On to the next step, leaving this one's choice as it is. */
  next(): void
  /** Ends the setup: the app's own screens take over. */
  finish(): void
}

/** A ref for a step's heading, which takes focus when the step appears (spec §11.1). */
export function useStepHeading() {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return heading
}

/**
 * A step's way on: its own primary action (if any), Start studying, and Skip; on the last step, Start studying alone.
 * Start studying is the primary button unless the step brings its own (Continue). The setup's styles stack them on a
 * phone, primary first, and set them in a row on the right on a wide screen.
 */
export function StepActions(props: StepProps & { readonly primary?: ReactNode }) {
  const { t } = useT()
  if (props.last) {
    return (
      <div className="actions">
        <button type="button" className="button primary" onClick={props.finish}>
          {t('setup.start')}
        </button>
      </div>
    )
  }
  return (
    <div className="actions">
      {props.primary}
      <button type="button" className={props.primary ? 'button' : 'button primary'} onClick={props.finish}>
        {t('setup.start')}
      </button>
      <button type="button" className="link-button" onClick={props.next}>
        {t('setup.skip')}
      </button>
    </div>
  )
}
