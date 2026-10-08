import { placementAvailable, useClient, useClientSnapshot } from '@wordado/client-data'
import { CEFR_LEVELS, MAX_NEW_WORD_LIMIT, MAX_REVIEW_CAP, RETENTION_TARGETS, type CefrLevel, type Corpus, type RetentionSetting, type Settings } from '@wordado/core'
import { useId, useState } from 'react'
import { errorMessageKey } from '../errors'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link } from '../router'
import { readAutoContinue, setAutoContinue } from '../study/autoContinue'
import { DailyGoalSetting } from './DailyGoalSetting'
import { NumberSetting } from './NumberSetting'

/** Saves one settings field, and says so or says why not (spec §11.1: the result is announced). */
export function useSave(): { save(patch: Partial<Settings>): Promise<void>; status: string | null } {
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
        setStatus(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
      }
    },
  }
}

const RETENTIONS = Object.keys(RETENTION_TARGETS) as RetentionSetting[]

/** The levels the installed words come in, and the learner's own: a level with no words would teach nothing. */
export function offeredLevels(corpus: Corpus | null, declared: CefrLevel): CefrLevel[] {
  const shipped = new Set<CefrLevel>(corpus?.units.map((u) => u.level) ?? [])
  shipped.add(declared)
  return CEFR_LEVELS.filter((l) => shipped.has(l))
}

/**
 * Level, limits, retention, goal, audio, latency grading and automatic continue (spec §7.1, §7.2, §7.4, §8.1, §8.4,
 * §11.1). All are the learner's and follow them between devices, but the last: it is this device's own, kept in the
 * browser's storage, so no synced document changes for it.
 */
export function StudySettings() {
  const { t } = useT()
  const { settings, corpus } = useClientSnapshot()
  const { save: saveSetting, status } = useSave()
  const latencyHintId = useId()
  const retentionHintId = useId()
  const autoContinueHintId = useId()
  const [autoContinue, setAutoContinueOn] = useState(() => readAutoContinue())
  // What the switch that is this device's own last said; a saved setting's own message replaces it.
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null)
  const save = (patch: Partial<Settings>) => {
    setDeviceStatus(null)
    return saveSetting(patch)
  }
  const levels = offeredLevels(corpus, settings.declaredLevel)
  return (
    <section aria-labelledby="settings-study">
      <h2 id="settings-study">{t('settings.study')}</h2>
      <fieldset className="choices segmented-field">
        <legend>{t('settings.level')}</legend>
        <div className="segmented">
          {levels.map((level) => (
            <label key={level}>
              <input type="radio" name="level" value={level} checked={settings.declaredLevel === level} onChange={() => void save({ declaredLevel: level })} />
              {/* The segment shows the code; its name is the whole label, which begins with it (WCAG 2.5.3). */}
              <span aria-hidden="true">{level}</span>
              <span className="visually-hidden">{t(`level.${level}` as MessageKey)}</span>
            </label>
          ))}
        </div>
        <p className="note">
          {t(`level.${settings.declaredLevel}` as MessageKey)}. {t('settings.levelHint')}
        </p>
      </fieldset>
      {placementAvailable(corpus) ? (
        <p>
          <Link to={{ name: 'placement' }}>{t('placement.link')}</Link>
        </p>
      ) : (
        <p className="note">{t('placement.unavailableNote')}</p>
      )}
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
      <fieldset className="choices segmented-field" aria-describedby={retentionHintId}>
        <legend>{t('settings.retention')}</legend>
        <div className="segmented">
          {RETENTIONS.map((r) => (
            <label key={r}>
              <input type="radio" name="retention" value={r} checked={settings.retention === r} onChange={() => void save({ retention: r })} />
              <span>{t(`settings.retention.${r}` as MessageKey)}</span>
            </label>
          ))}
        </div>
        <p className="note" id={retentionHintId}>
          {t(`settings.retention.${settings.retention}Hint` as MessageKey)}
        </p>
      </fieldset>
      <DailyGoalSetting save={save} />
      <div className="field switch-field">
        <label className="check">
          <input type="checkbox" checked={settings.audio} onChange={(e) => void save({ audio: e.target.checked })} />
          {t('settings.audio')}
        </label>
      </div>
      <div className="field switch-field">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.latencyGrading}
            aria-describedby={latencyHintId}
            onChange={(e) => void save({ latencyGrading: e.target.checked })}
          />
          {t('settings.latency')}
        </label>
        <p className="note" id={latencyHintId}>
          {t('settings.latencyHint')}
        </p>
      </div>
      <div className="field switch-field">
        <label className="check">
          <input
            type="checkbox"
            checked={autoContinue}
            aria-describedby={autoContinueHintId}
            onChange={(e) => {
              // A browser that keeps nothing still follows the switch, for this visit: say that, not "Saved".
              setDeviceStatus(t(setAutoContinue(e.target.checked) ? 'settings.saved' : 'settings.autoUpdateNotKept'))
              setAutoContinueOn(e.target.checked)
            }}
          />
          {t('settings.autoContinue')}
        </label>
        <p className="note" id={autoContinueHintId}>
          {t('settings.autoContinueHint')}
        </p>
      </div>
      <p className="note" role="status">
        {deviceStatus ?? status}
      </p>
    </section>
  )
}
