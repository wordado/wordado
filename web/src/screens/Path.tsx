import { useClient, useClientSnapshot, type PathView } from '@wordado/client-data'
import type { UnitProgress, Unit } from '@wordado/core'
import { localized, useT } from '../i18n/i18n'
import { FlagControls } from '../study/FlagControls'

type UnitStatus = 'locked' | 'current' | 'complete' | 'mastered' | 'open'

function statusOf(unit: Unit, progress: UnitProgress | undefined, path: PathView): UnitStatus {
  if (!path.unlocked.has(unit.unitId)) return 'locked'
  if (progress?.mastered) return 'mastered'
  if (progress?.complete) return 'complete'
  if (path.currentUnitId === unit.unitId) return 'current'
  return 'open'
}

/** Icons repeat the text, never replace it (spec §11.1). */
const ICON: Readonly<Record<UnitStatus, string>> = { locked: '○', current: '●', complete: '✓', mastered: '★', open: '◐' }

/** The level path (spec §7.2): units in order, what is open, where new words come from. */
export function Path() {
  const { t, locale } = useT()
  const client = useClient()
  const { corpus, progress, path } = useClientSnapshot()
  if (!corpus || !progress || !path) return null
  const levels = [...new Set(corpus.units.map((u) => u.level))]
  return (
    <section aria-labelledby="path-title">
      <h1 id="path-title">{t('path.title')}</h1>
      {levels.map((level) => {
        const completion = progress.levels[level]
        return (
          <section key={level} className="level" aria-labelledby={`level-${level}`}>
            <h2 id={`level-${level}`} className="level-code">
              {level}
            </h2>
            <p className="note">
              {completion?.kind === 'skipped'
                ? t('path.skipped')
                : t('path.levelProgress', { mature: completion?.mature ?? 0, live: completion?.live ?? 0 })}
            </p>
            <ol className="units">
              {corpus.units
                .filter((unit) => unit.level === level)
                .map((unit) => {
                  const unitProgress = progress.units.get(unit.unitId)
                  const status = statusOf(unit, unitProgress, path)
                  return (
                    <li key={unit.unitId} className={`unit unit-${status}`}>
                      <h3>{localized(unit.title, locale)}</h3>
                      <p className="unit-status">
                        <span aria-hidden="true">{ICON[status]} </span>
                        {status === 'locked' && t('path.locked')}
                        {status === 'current' && t('path.current')}
                        {status === 'complete' && t('path.complete')}
                        {status === 'mastered' && t('path.mastered')}
                        {status === 'open' && t('path.open')}
                      </p>
                      {status !== 'locked' && unitProgress && (
                        <p className="note">{t('path.introduced', { introduced: unitProgress.introduced, live: unitProgress.live })}</p>
                      )}
                      <details className="unit-words">
                        <summary>{t('path.words', { count: unit.wordIds.length })}</summary>
                        <ul>
                          {unit.wordIds.map((wordId) => {
                            const entry = client.entry(wordId)
                            if (!entry) return null
                            return (
                              <li key={wordId}>
                                <span lang="en" className="word-head">
                                  {entry.headword}
                                </span>
                                <FlagControls wordId={wordId} headword={entry.headword} />
                              </li>
                            )
                          })}
                        </ul>
                      </details>
                    </li>
                  )
                })}
            </ol>
          </section>
        )
      })}
    </section>
  )
}
