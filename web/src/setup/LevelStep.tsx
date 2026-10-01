import { useClient, useClientSnapshot } from '@wordado/client-data'
import type { CefrLevel } from '@wordado/core'
import { useState } from 'react'
import { errorMessageKey } from '../errors'
import { useT, type MessageKey } from '../i18n/i18n'
import { offeredLevels } from '../settings/StudySettings'
import { StepActions, useStepHeading, type StepProps } from './step'

/**
 * The learner's English level (plan 11): a radio per level the installed words come in, the declared level (A1 for a
 * new learner) preselected. Choosing one saves it at once, as Settings does; Continue and Skip move on either way.
 */
export function LevelStep(props: StepProps) {
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
      <fieldset className="choices">
        <legend className="visually-hidden">{t('setup.level.title')}</legend>
        {levels.map((level) => (
          <label key={level}>
            <input type="radio" name="setup-level" value={level} checked={settings.declaredLevel === level} onChange={() => void choose(level)} />
            {t(`level.${level}` as MessageKey)}
          </label>
        ))}
      </fieldset>
      <p className="note">{t('setup.level.later')}</p>
      {error !== null && <p role="alert">{error}</p>}
      <StepActions
        {...props}
        primary={
          <button type="button" className="button primary" onClick={props.next}>
            {t('setup.continue')}
          </button>
        }
      />
    </section>
  )
}
