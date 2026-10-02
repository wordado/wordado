import { useClient, useClientSnapshot, type PathView } from '@wordado/client-data'
import type { Unit, UnitProgress } from '@wordado/core'
import { Check, ChevronDown, CircleDashed, Lock, Play, Star, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { localized, useT, type MessageKey } from '../i18n/i18n'
import { Link } from '../router'
import { FlagControls } from '../study/FlagControls'
import { levelStatus, levelToOpen, unitsAtFirst, type LevelStatus, type UnitStatus } from './pathFolding'

function statusOf(unit: Unit, progress: UnitProgress | undefined, path: PathView): UnitStatus {
  if (!path.unlocked.has(unit.unitId)) return 'locked'
  if (progress?.mastered) return 'mastered'
  if (progress?.complete) return 'complete'
  if (path.currentUnitId === unit.unitId) return 'current'
  return 'open'
}

/** The marker on the path for each status; icons repeat the text, never replace it (spec §11.1). */
const ICON: Readonly<Record<UnitStatus, LucideIcon>> = { locked: Lock, current: Play, complete: Check, mastered: Star, open: CircleDashed }

const UNIT_STATUS: Readonly<Record<UnitStatus, MessageKey>> = {
  locked: 'path.locked',
  current: 'path.current',
  complete: 'path.complete',
  mastered: 'path.mastered',
  open: 'path.open',
}

/** A level's own labels: they agree with "level", which differs in gender from "unit" in some languages (plan 12). */
export const LEVEL_STATUS: Readonly<Record<LevelStatus, MessageKey>> = {
  skipped: 'path.levelSkipped',
  complete: 'path.levelComplete',
  locked: 'path.levelLocked',
  open: 'path.levelOpen',
}

/** Toggles one key in a set held in state. */
const toggled = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/**
 * The level path (spec §7.2): units in order, what is open, where new words
 * come from. The level being studied opens by itself, shortened to its
 * finished units (one line), the current unit and the next few; the other
 * levels are folded to one line each. Everything opens on request.
 */
export function Path() {
  const { t } = useT()
  const { corpus, progress, path } = useClientSnapshot()
  // Levels the learner opened or folded, over the default (only the level being studied is open).
  const [levelChoice, setLevelChoice] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [doneOpen, setDoneOpen] = useState<ReadonlySet<string>>(new Set())
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(new Set())
  // A unit's word list mounts (and subscribes to the snapshot) only while its <details> is open,
  // so a path with many units and words stays cheap to render.
  const [openUnits, setOpenUnits] = useState<ReadonlySet<string>>(new Set())
  if (!corpus || !progress || !path) return null

  const levels = [...new Set(corpus.units.map((u) => u.level))].map((level) => {
    const units = corpus.units.filter((unit) => unit.level === level)
    const statuses = units.map((unit) => statusOf(unit, progress.units.get(unit.unitId), path))
    return { level, units, statuses, skipped: progress.levels[level]?.kind === 'skipped' }
  })
  const studied = levelToOpen(levels)

  return (
    <section className="path" aria-labelledby="path-title">
      <h1 id="path-title">{t('path.title')}</h1>
      {levels.map(({ level, units, statuses, skipped }) => {
        const levelCompletion = progress.levels[level]
        const completion = levelCompletion?.kind === 'skipped' ? undefined : levelCompletion
        const summary = skipped ? t('path.skipped') : t('path.levelProgress', { mature: completion?.mature ?? 0, live: completion?.live ?? 0 })
        const isOpen = levelChoice.get(level) ?? level === studied
        const status = levelStatus(statuses, skipped)
        // The level being studied starts shortened; any other level, once opened, shows every unit.
        const view = level === studied && !showAll.has(level) ? unitsAtFirst(statuses) : null
        const shown = view ? [...(doneOpen.has(level) ? view.done : []), ...view.shown] : units.map((_, i) => i)

        const item = (i: number, next: number | undefined) => (
          <UnitItem
            key={units[i]!.unitId}
            unit={units[i]!}
            status={statuses[i]!}
            progress={progress.units.get(units[i]!.unitId)}
            line={next === undefined ? null : statuses[next] !== 'locked'}
            wordsOpen={openUnits.has(units[i]!.unitId)}
            onWordsToggle={() => setOpenUnits((prev) => toggled(prev, units[i]!.unitId))}
          />
        )

        return (
          <section key={level} className={`panel level-card level-${status}${isOpen ? ' is-open' : ''}`} aria-labelledby={`level-${level}`}>
            <h2 id={`level-${level}`} className="level-heading">
              <button
                type="button"
                className="level-toggle"
                aria-expanded={isOpen}
                aria-controls={`units-${level}`}
                onClick={() => setLevelChoice((prev) => new Map(prev).set(level, !isOpen))}
              >
                <span className="level-code">{level}</span>
                <span className="level-summary">
                  {!isOpen && <span className="level-status">{t(LEVEL_STATUS[status])}</span>}
                  <span className="note">{summary}</span>
                </span>
                <ChevronDown aria-hidden="true" size={20} className="level-chevron" />
              </button>
            </h2>
            {!skipped && (
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
            {isOpen && (
              <div className="level-units" id={`units-${level}`}>
                <ol className="units">
                  {view && view.done.length > 0 && (
                    <DoneFold
                      count={view.done.length}
                      open={doneOpen.has(level)}
                      line={shown.length > 0}
                      onToggle={() => setDoneOpen((prev) => toggled(prev, level))}
                    />
                  )}
                  {shown.map((i, k) => item(i, shown[k + 1]))}
                </ol>
                {view && view.hidden > 0 && (
                  <button type="button" className="button level-show-all" onClick={() => setShowAll((prev) => toggled(prev, level))}>
                    {t('path.showAll', { count: units.length })}
                  </button>
                )}
              </div>
            )}
          </section>
        )
      })}
    </section>
  )
}

/** The finished units of the level being studied, folded into one line that opens them. */
function DoneFold(props: { readonly count: number; readonly open: boolean; readonly line: boolean; onToggle(): void }) {
  const { t } = useT()
  return (
    <li className="unit unit-complete unit-fold">
      <div className="unit-track" aria-hidden="true">
        <span className="unit-marker">
          <Check size={20} strokeWidth={2.25} />
        </span>
        {props.line && <span className="unit-line is-done" />}
      </div>
      <div className="unit-fold-body">
        <button type="button" className="unit-fold-button" aria-expanded={props.open} onClick={props.onToggle}>
          {t('path.unitsComplete', { count: props.count })}
          <ChevronDown aria-hidden="true" size={18} className="level-chevron" />
        </button>
      </div>
    </li>
  )
}

/** One unit on the path: its marker and line, its card, and its words on request. */
function UnitItem(props: {
  readonly unit: Unit
  readonly status: UnitStatus
  readonly progress: UnitProgress | undefined
  /** The line to the next unit shown: null for the last, true once that unit is reachable. */
  readonly line: boolean | null
  readonly wordsOpen: boolean
  onWordsToggle(): void
}) {
  const { t, locale } = useT()
  const client = useClient()
  const { corpus } = useClientSnapshot()
  const { unit, status, progress } = props
  const Icon = ICON[status]
  let words: ReactNode = null
  if (props.wordsOpen) {
    words = (
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
    )
  }
  return (
    <li className={`unit unit-${status}`}>
      <div className="unit-track" aria-hidden="true">
        <span className="unit-marker">
          <Icon size={20} strokeWidth={2.25} />
        </span>
        {props.line !== null && <span className={`unit-line${props.line ? ' is-done' : ''}`} />}
      </div>
      <div className="unit-card">
        <div className="unit-head">
          <h3>{localized(unit.title, locale, corpus?.l1 ?? '')}</h3>
          <p className="unit-status">{t(UNIT_STATUS[status])}</p>
        </div>
        {status !== 'locked' && progress && (
          <div className="unit-progress">
            {status === 'current' && (
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${progress.live > 0 ? (100 * progress.introduced) / progress.live : 0}%` }} />
              </div>
            )}
            <p className="note">{t('path.introduced', { introduced: progress.introduced, live: progress.live })}</p>
          </div>
        )}
        {status === 'current' && (
          <Link className="button primary study-main" to={{ name: 'study', mode: null }}>
            {t('home.start')}
          </Link>
        )}
        <details className="unit-words" open={props.wordsOpen} onToggle={(e) => e.currentTarget.open !== props.wordsOpen && props.onWordsToggle()}>
          <summary>
            {t('path.words', { count: unit.wordIds.length })}
            <ChevronDown aria-hidden="true" size={18} className="unit-chevron" />
          </summary>
          {words}
        </details>
      </div>
    </li>
  )
}
