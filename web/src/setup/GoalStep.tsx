import { useClientSnapshot } from '@wordado/client-data'
import { useId } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { ReminderSettings } from '../settings/ReminderSettings'
import { DEFAULT_DAILY_GOAL, MAX_DAILY_GOAL, NumberSetting, useSave } from '../settings/StudySettings'
import { StepActions, useStepHeading, type StepProps } from './step'

/**
 * A daily goal (plan 11): the switch and number of Settings' goal, and below them the reminders, for an account on a
 * device where they can work. Always the setup's last step.
 */
export function GoalStep(props: StepProps) {
  const { t } = useT()
  const { settings } = useClientSnapshot()
  const { account, reminders } = useApp()
  const { save, status } = useSave()
  const heading = useStepHeading()
  const goalHintId = useId()
  const remindable = account !== null && reminders.support() === 'supported'

  return (
    <section className="setup-step" aria-labelledby="setup-goal-title">
      <h2 id="setup-goal-title" ref={heading} tabIndex={-1}>
        {t('setup.goal.title')}
      </h2>
      <p className="note">{t('setup.goal.hint')}</p>
      <div className="field switch-field">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.dailyGoal !== null}
            aria-describedby={goalHintId}
            onChange={(e) => void save({ dailyGoal: e.target.checked ? DEFAULT_DAILY_GOAL : null })}
          />
          {t('settings.goal')}
        </label>
        <p className="note" id={goalHintId}>
          {t('settings.goalHint')}
        </p>
      </div>
      {settings.dailyGoal !== null && (
        <NumberSetting
          label={t('settings.goalAnswers')}
          hint=""
          invalid={t('settings.goalInvalid', { max: MAX_DAILY_GOAL })}
          value={settings.dailyGoal}
          min={1}
          max={MAX_DAILY_GOAL}
          onSave={(dailyGoal) => save({ dailyGoal })}
        />
      )}
      <p className="note" role="status">
        {status}
      </p>
      {remindable && <ReminderSettings headingLevel={3} />}
      <StepActions {...props} />
    </section>
  )
}
