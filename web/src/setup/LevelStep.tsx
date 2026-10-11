import { placementAvailable, useClient, useClientSnapshot } from '@wordado/client-data'
import type { CefrLevel } from '@wordado/core'
import { useState } from 'react'
import { errorMessageKey } from '../errors'
import { useT, type MessageKey } from '../i18n/i18n'
import { offeredLevels } from '../settings/StudySettings'
import { StepActions, useStepHeading, type StepProps } from './step'

/**
 * The learner's English level (plan 11), in Settings' segmented level control: a radio per level the installed words
 * come in, the declared level (A1 for a new learner) preselected. Choosing one saves it at once, as Settings does;
 * Continue and Skip move on either way. Under the choice, the placement test (spec §7.2) for who is not sure:
 * `onTest` opens it inside the setup, and `placed` is the level it gave when the learner took its result. It is
 * offered only where it can run (enough words of the first levels), as in Settings.
 */
export function LevelStep(props: StepProps & { readonly placed: CefrLevel | null; onTest(): void }) {
  const { t } = useT()
  const client = useClient()
  const { settings, corpus } = useClientSnapshot()
  const heading = useStepHeading()
  const [error, setError] = useState<string | null>(null)
  const levels = offeredLevels(corpus, settings.declaredLevel)

  const choose = async (level: CefrLevel) => {
    try {
      await client.updateSettings({ declaredLevel: level })
      setError(null)
    } catch (err) {
      setError(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
    }
  }

  return (
    <section className="setup-step" aria-labelledby="setup-level-title">
      <h2 id="setup-level-title" ref={heading} tabIndex={-1}>
        {t('setup.level.title')}
      </h2>
      {/* Settings' level control (StudySettings): a segment per level over real radios, the chosen level named below. */}
      <fieldset className="choices segmented-field">
        <legend className="visually-hidden">{t('setup.level.title')}</legend>
        <div className="segmented">
          {levels.map((level) => (
            <label key={level}>
              <input type="radio" name="setup-level" value={level} checked={settings.declaredLevel === level} onChange={() => void choose(level)} />
              {/* The segment shows the code; its name is the whole label, which begins with it (WCAG 2.5.3). */}
              <span aria-hidden="true">{level}</span>
              <span className="visually-hidden">{t(`level.${level}` as MessageKey)}</span>
            </label>
          ))}
        </div>
        <p className="note">{t(`level.${settings.declaredLevel}` as MessageKey)}</p>
      </fieldset>
      {placementAvailable(corpus) && (
        <div className="setup-test">
          {props.placed !== null && props.placed === settings.declaredLevel ? (
            <p className="note" role="status">
              {t('setup.level.placed', { level: props.placed })}
            </p>
          ) : (
            <p className="note">{t('setup.level.unsure')}</p>
          )}
          <button type="button" className="button" onClick={props.onTest}>
            {t('placement.link')}
          </button>
        </div>
      )}
      {error !== null && <p role="alert">{error}</p>}
      <StepActions
        last={props.last}
        next={props.next}
        finish={props.finish}
        primary={
          <button type="button" className="button primary" onClick={props.next}>
            {t('setup.continue')}
          </button>
        }
      />
    </section>
  )
}
