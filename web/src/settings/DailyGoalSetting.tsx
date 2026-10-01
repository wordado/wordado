import { useClientSnapshot } from '@wordado/client-data'
import type { Settings } from '@wordado/core'
import { useId } from 'react'
import { useT } from '../i18n/i18n'
import { NumberSetting } from './NumberSetting'

/** The highest daily goal the screen offers; `core` allows any positive whole number. */
const MAX_DAILY_GOAL = 1000
/** What "Set a daily goal" starts from. */
const DEFAULT_DAILY_GOAL = 20

/**
 * The daily goal (spec §8.4): a switch, and while it is on, how many answers a day. Settings' study section and the
 * setup's goal step (plan 11) both show it; `save` is theirs, so the result is announced where they announce it.
 */
export function DailyGoalSetting(props: { save(patch: Partial<Settings>): Promise<void> }) {
  const { t } = useT()
  const { settings } = useClientSnapshot()
  const { save } = props
  const goalHintId = useId()
  return (
    <>
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
    </>
  )
}
