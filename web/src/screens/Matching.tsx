import { MatchingRun, useClient, useClientSnapshot, type MatchingSide } from '@wordado/client-data'
import type { CorpusEntry } from '@wordado/core'
import { Check, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { languageName, localized, useT } from '../i18n/i18n'
import { Link } from '../router'
import { Translation } from '../study/Headword'
import { useStore } from '../useStore'
import { usePracticeUnit } from './practiceUnit'

/** The practice-only matching game (spec §8.1). A new board each round; of one unit's words when the path's practice asks (`unit`). */
export function Matching(props: { readonly unit?: string | undefined }) {
  const { t, locale } = useT()
  const client = useClient()
  const { env } = useApp()
  const { corpus } = useClientSnapshot()
  const unit = usePracticeUnit(props.unit)
  const unitId = unit?.unitId
  const [round, setRound] = useState(0)
  // `round` is a dependency on purpose: "Play again" deals a new board.
  const run = useMemo(() => MatchingRun.start(client, env, unitId), [client, env, unitId, round])
  if (!run) {
    return (
      <section aria-labelledby="matching-title">
        <h1 id="matching-title">{t('matching.title')}</h1>
        {unit && <p className="practice-unit">{t('practice.unit', { title: localized(unit.title, locale, corpus?.l1 ?? '') })}</p>}
        <p>{t('practice.needWords')}</p>
        <Link className="button" to={{ name: 'practice', unit: unitId }}>
          {t('practice.back')}
        </Link>
      </section>
    )
  }
  return <Board key={round} run={run} unit={unitId} onAgain={() => setRound((r) => r + 1)} />
}

function Board(props: { readonly run: MatchingRun; readonly unit: string | undefined; readonly onAgain: () => void }) {
  const { t, locale } = useT()
  const { corpus } = useClientSnapshot()
  const { afterRun } = useApp()
  const { run } = props
  const s = useStore(run.store)

  // Fetches the clips of the words about to be met and asks for persistent storage (spec §9.1, §9.3), once per board.
  useEffect(() => {
    if (s.done) afterRun()
  }, [s.done, afterRun])
  const l1 = corpus?.l1 ?? 'bg'
  const byId = (entryId: string) => s.left.find((e) => e.entryId === entryId)
  const leftRefs = useRef(new Map<string, HTMLButtonElement>())
  const againRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)

  // A disabled button loses focus to the body (spec §11.1): follow every match with the
  // next unmatched word, or "Play again" once the board is done. Not on the initial render.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (s.done) {
      againRef.current?.focus()
    } else if (s.matched.size > 0) {
      const next = s.left.find((e) => !s.matched.has(e.entryId))
      if (next) leftRefs.current.get(next.entryId)?.focus()
    }
  }, [s.matched.size, s.done, s.left])

  const pair = (side: MatchingSide, entry: CorpusEntry) => {
    const selected = s.selected?.side === side && s.selected.entryId === entry.entryId
    const matched = s.matched.has(entry.entryId)
    const missed = s.miss !== null && (side === 'left' ? s.miss.left : s.miss.right) === entry.entryId
    return (
      <li key={entry.entryId}>
        <button
          type="button"
          className={`pair${selected ? ' is-selected' : ''}${matched ? ' is-matched' : ''}${missed ? ' is-miss' : ''}`}
          aria-pressed={selected}
          disabled={matched}
          data-entry={entry.entryId}
          ref={
            side === 'left'
              ? (el) => {
                  if (el) leftRefs.current.set(entry.entryId, el)
                  else leftRefs.current.delete(entry.entryId)
                }
              : undefined
          }
          onClick={() => void run.select(side, entry.entryId)}
        >
          {side === 'left' ? <span lang="en">{entry.headword}</span> : <Translation entry={entry} lang={l1} />}
          {matched && (
            <>
              <span aria-hidden="true"> ✓</span>
              <span className="visually-hidden"> {t('matching.matched')}</span>
            </>
          )}
        </button>
      </li>
    )
  }

  const total = s.left.length
  return (
    <section className="matching" aria-labelledby="matching-title">
      <div className="study-bar">
        <Link className="study-close" to={{ name: 'practice', unit: props.unit }} aria-label={t('practice.back')}>
          <X aria-hidden="true" size={20} strokeWidth={2} />
        </Link>
        <div
          className="study-progress is-pairs"
          role="progressbar"
          aria-label={t('matching.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={s.matched.size}
        >
          <span style={{ width: `${total === 0 ? 0 : (100 * s.matched.size) / total}%` }} />
        </div>
        <p className="study-count" aria-hidden="true">
          {s.matched.size} / {total}
        </p>
      </div>
      <div className="matching-head">
        <h1 id="matching-title">{t('matching.title')}</h1>
        {!s.done && <p className="lede">{t('matching.instructions')}</p>}
      </div>
      {s.done ? (
        <div className="panel done-card">
          <span className="done-badge" aria-hidden="true">
            <Check size={42} strokeWidth={2.25} />
          </span>
          <p className="done-card-title" aria-hidden="true">
            {t('matching.done')}
          </p>
        </div>
      ) : (
        <div className="board">
          <div className="column" role="group" aria-labelledby="matching-en" data-side="left">
            <h2 id="matching-en">{t('matching.english')}</h2>
            <ul>{s.left.map((entry) => pair('left', entry))}</ul>
          </div>
          <div className="column" role="group" aria-labelledby="matching-l1" data-side="right">
            <h2 id="matching-l1">{languageName(l1, locale)}</h2>
            <ul>{s.right.map((entry) => pair('right', entry))}</ul>
          </div>
        </div>
      )}
      <div className={`feedback${s.miss ? ' is-miss' : ''}${s.done ? ' visually-hidden' : ''}`} role="status">
        {s.miss && (
          <p className="incorrect">
            ✗ {t('matching.miss', { left: byId(s.miss.left)?.headword ?? '', right: byId(s.miss.right)?.translations[0] ?? '' })}
          </p>
        )}
        {s.done && <p className="correct">✓ {t('matching.done')}</p>}
        {s.error !== null && <p>{t('study.error', { message: s.error })}</p>}
      </div>
      {s.done && (
        <div className="done-actions">
          <button type="button" className="button primary study-main" ref={againRef} onClick={props.onAgain}>
            {t('matching.again')}
          </button>
          <Link className="button study-main" to={{ name: 'practice', unit: props.unit }}>
            {t('practice.back')}
          </Link>
        </div>
      )}
    </section>
  )
}
