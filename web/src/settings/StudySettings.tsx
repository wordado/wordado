import { useClient, useClientSnapshot } from '@wordado/client-data'
import { CEFR_LEVELS, MAX_NEW_WORD_LIMIT, MAX_REVIEW_CAP, RETENTION_TARGETS, type CefrLevel, type RetentionSetting, type Settings } from '@wordado/core'
import { useEffect, useId, useState } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { parseWholeNumber } from './fields'

/** The highest daily goal the screen offers; `core` allows any positive whole number. */
const MAX_DAILY_GOAL = 1000
/** What "Set a daily goal" starts from. */
const DEFAULT_DAILY_GOAL = 20

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Saves one settings field, and says so or says why not (spec §11.1: the result is announced). */
function useSave(): { save(patch: Partial<Settings>): Promise<void>; status: string | null } {
  const { t } = useT()
  const client = useClient()
  const [status, setStatus] = useState<string | null>(null)
  return {
    status,
    save: async (patch) => {
      try {
        await client.updateSettings(patch)
        setStatus(t('settings.saved'))
      } catch (err) {
        setStatus(t('settings.saveFailed', { message: messageOf(err) }))
      }
    },
  }
}

/**
 * A number field saved when it is left or Enter is pressed. What the
 * learner types stays in the field until it is valid; an invalid value is
 * explained at the field and never reaches `updateSettings`.
 */
function NumberSetting(props: {
  readonly label: string
  readonly hint: string
  readonly invalid: string
  readonly value: number
  readonly min: number
  readonly max: number
  onSave(value: number): Promise<void>
}) {
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
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <p className="note" id={hintId}>
        {props.hint}
      </p>
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
      {error && (
        <p className="field-error" role="alert" id={errorId}>
          {props.invalid}
        </p>
      )}
    </div>
  )
}

const RETENTIONS = Object.keys(RETENTION_TARGETS) as RetentionSetting[]

/** Level, limits, retention, goal, audio and latency grading (spec §7.1, §7.2, §7.4, §8.4, §11.1). */
export function StudySettings() {
  const { t } = useT()
  const { settings, corpus } = useClientSnapshot()
  const { save, status } = useSave()
  // The levels the installed words come in, and the learner's own: a level with no words would teach nothing.
  const shipped = new Set<CefrLevel>(corpus?.units.map((u) => u.level) ?? [])
  shipped.add(settings.declaredLevel)
  const levels = CEFR_LEVELS.filter((l) => shipped.has(l))
  return (
    <section aria-labelledby="settings-study">
      <h2 id="settings-study">{t('settings.study')}</h2>
      <fieldset className="choices">
        <legend>{t('settings.level')}</legend>
        <p className="note">{t('settings.levelHint')}</p>
        {levels.map((level) => (
          <label key={level}>
            <input type="radio" name="level" value={level} checked={settings.declaredLevel === level} onChange={() => void save({ declaredLevel: level })} />
            {t(`level.${level}` as MessageKey)}
          </label>
        ))}
      </fieldset>
      <NumberSetting
        label={t('settings.newWords')}
        hint={t('settings.newWordsHint', { max: MAX_NEW_WORD_LIMIT })}
        invalid={t('settings.newWordsInvalid', { max: MAX_NEW_WORD_LIMIT })}
        value={settings.newWordLimit}
        min={0}
        max={MAX_NEW_WORD_LIMIT}
        onSave={(newWordLimit) => save({ newWordLimit })}
      />
      <NumberSetting
        label={t('settings.reviewCap')}
        hint={t('settings.reviewCapHint', { max: MAX_REVIEW_CAP })}
        invalid={t('settings.reviewCapInvalid', { max: MAX_REVIEW_CAP })}
        value={settings.reviewCap}
        min={0}
        max={MAX_REVIEW_CAP}
        onSave={(reviewCap) => save({ reviewCap })}
      />
      <fieldset className="choices">
        <legend>{t('settings.retention')}</legend>
        {RETENTIONS.map((r) => (
          <label key={r}>
            <input type="radio" name="retention" value={r} checked={settings.retention === r} onChange={() => void save({ retention: r })} />
            <span>
              {t(`settings.retention.${r}` as MessageKey)} <span className="note">— {t(`settings.retention.${r}Hint` as MessageKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.dailyGoal !== null}
            onChange={(e) => void save({ dailyGoal: e.target.checked ? DEFAULT_DAILY_GOAL : null })}
          />
          {t('settings.goal')}
        </label>
        <p className="note">{t('settings.goalHint')}</p>
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
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={settings.audio} onChange={(e) => void save({ audio: e.target.checked })} />
          {t('settings.audio')}
        </label>
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={settings.latencyGrading} onChange={(e) => void save({ latencyGrading: e.target.checked })} />
          {t('settings.latency')}
        </label>
        <p className="note">{t('settings.latencyHint')}</p>
      </div>
      <p className="note" role="status">
        {status}
      </p>
    </section>
  )
}
