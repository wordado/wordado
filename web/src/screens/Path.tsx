import { useClient, useClientSnapshot, type PathView } from '@wordado/client-data'
import type { UnitProgress, Unit } from '@wordado/core'
import { Check, ChevronDown, CircleDashed, Lock, Play, Star, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { localized, useT } from '../i18n/i18n'
import { Link } from '../router'
import { FlagControls } from '../study/FlagControls'

type UnitStatus = 'locked' | 'current' | 'complete' | 'mastered' | 'open'

function statusOf(unit: Unit, progress: UnitProgress | undefined, path: PathView): UnitStatus {
  if (!path.unlocked.has(unit.unitId)) return 'locked'
  if (progress?.mastered) return 'mastered'
  if (progress?.complete) return 'complete'
  if (path.currentUnitId === unit.unitId) return 'current'
  return 'open'
}

/** The marker on the path for each status; icons repeat the text, never replace it (spec §11.1). */
const ICON: Readonly<Record<UnitStatus, LucideIcon>> = { locked: Lock, current: Play, complete: Check, mastered: Star, open: CircleDashed }

/** The level path (spec §7.2): units in order, what is open, where new words come from. */
export function Path() {
  const { t, locale } = useT()
  const client = useClient()
  const { corpus, progress, path } = useClientSnapshot()
  // A unit's word list mounts (and subscribes to the snapshot) only while its <details> is open,
  // so a path with many units and words stays cheap to render.
  const [openUnits, setOpenUnits] = useState<ReadonlySet<string>>(new Set())
  if (!corpus || !progress || !path) return null
  const levels = [...new Set(corpus.units.map((u) => u.level))]
  return (
    <section className="path" aria-labelledby="path-title">
      <h1 id="path-title">{t('path.title')}</h1>
      {levels.map((level) => {
        const completion = progress.levels[level]
        const summary =
          completion?.kind === 'skipped' ? t('path.skipped') : t('path.levelProgress', { mature: completion?.mature ?? 0, live: completion?.live ?? 0 })
        const units = corpus.units.filter((unit) => unit.level === level)
        return (
          <section key={level} className="level" aria-labelledby={`level-${level}`}>
            <div className="panel level-card">
              <h2 id={`level-${level}`} className="level-code">
                {level}
              </h2>
              <div className="level-progress">
                {completion?.kind !== 'skipped' && (
                  <div
                    className="bar is-leaf"
                    role="progressbar"
                    aria-label={`${level}: ${summary}`}
                    aria-valuemin={0}
                    aria-valuemax={completion?.live ?? 0}
                    aria-valuenow={completion?.mature ?? 0}
                  >
                    <span style={{ width: `${completion && completion.live > 0 ? (100 * completion.mature) / completion.live : 0}%` }} />
                  </div>
                )}
                <p className="note">{summary}</p>
              </div>
            </div>
            <ol className="units">
              {units.map((unit, index) => {
                const unitProgress = progress.units.get(unit.unitId)
                const status = statusOf(unit, unitProgress, path)
                const Icon = ICON[status]
                const next = units[index + 1]
                // The line to the next unit is coloured once that unit is reachable.
                const lineDone = next !== undefined && path.unlocked.has(next.unitId)
                return (
                  <li key={unit.unitId} className={`unit unit-${status}`}>
                    <div className="unit-track" aria-hidden="true">
                      <span className="unit-marker">
                        <Icon size={20} strokeWidth={2.25} />
                      </span>
                      {next !== undefined && <span className={`unit-line${lineDone ? ' is-done' : ''}`} />}
                    </div>
                    <div className="unit-card">
                      <div className="unit-head">
                        <h3>{localized(unit.title, locale, corpus.l1)}</h3>
                        <p className="unit-status">
                          {status === 'locked' && t('path.locked')}
                          {status === 'current' && t('path.current')}
                          {status === 'complete' && t('path.complete')}
                          {status === 'mastered' && t('path.mastered')}
                          {status === 'open' && t('path.open')}
                        </p>
                      </div>
                      {status !== 'locked' && unitProgress && (
                        <div className="unit-progress">
                          {status === 'current' && (
                            <div className="bar" aria-hidden="true">
                              <span style={{ width: `${unitProgress.live > 0 ? (100 * unitProgress.introduced) / unitProgress.live : 0}%` }} />
                            </div>
                          )}
                          <p className="note">{t('path.introduced', { introduced: unitProgress.introduced, live: unitProgress.live })}</p>
                        </div>
                      )}
                      {status === 'current' && (
                        <Link className="button primary study-main" to={{ name: 'study', mode: null }}>
                          {t('home.start')}
                        </Link>
                      )}
                      <details
                        className="unit-words"
                        onToggle={(e) => {
                          const isOpen = e.currentTarget.open
                          setOpenUnits((prev) => {
                            const next = new Set(prev)
                            if (isOpen) next.add(unit.unitId)
                            else next.delete(unit.unitId)
                            return next
                          })
                        }}
                      >
                        <summary>
                          {t('path.words', { count: unit.wordIds.length })}
                          <ChevronDown aria-hidden="true" size={18} className="unit-chevron" />
                        </summary>
                        {openUnits.has(unit.unitId) && (
                          <ul>
                            {unit.wordIds.map((wordId) => {
                              const entry = client.entry(wordId)
                              if (!entry) return null
                              return (
                                <li key={wordId}>
                                  <span lang="en" className="word-head">
                                    {entry.headword}
                                  </span>
                                  <FlagControls wordId={wordId} headword={entry.headword} menu />
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </details>
                    </div>
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
