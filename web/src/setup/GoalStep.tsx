import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { DailyGoalSetting } from '../settings/DailyGoalSetting'
import { ReminderSettings } from '../settings/ReminderSettings'
import { useSave } from '../settings/StudySettings'
import { StepActions, useStepHeading, type StepProps } from './step'

/**
 * A daily goal (plan 11): Settings' goal switch and number, and below them the reminders, for an account on a device
 * where they can work. Always the setup's last step.
 */
export function GoalStep(props: StepProps) {
  const { t } = useT()
  const { account, reminders } = useApp()
  const { save, status } = useSave()
  const heading = useStepHeading()
  const remindable = account !== null && reminders.support() === 'supported'

  return (
    <section className="setup-step" aria-labelledby="setup-goal-title">
      <h2 id="setup-goal-title" ref={heading} tabIndex={-1}>
        {t('setup.goal.title')}
      </h2>
      <p className="note">{t('setup.goal.hint')}</p>
      <DailyGoalSetting save={save} />
      <p className="note" role="status">
        {status}
      </p>
      {remindable && <ReminderSettings headingLevel={3} />}
      <StepActions {...props} />
    </section>
  )
}
