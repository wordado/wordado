import { MatchingRun, useClient, useClientSnapshot, type MatchingSide } from '@wordado/client-data'
import type { CorpusEntry } from '@wordado/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { Translation } from '../study/Headword'
import { useStore } from '../useStore'

/** The practice-only matching game (spec §8.1). A new board each round. */
export function Matching() {
  const { t } = useT()
  const client = useClient()
  const { env } = useApp()
  const [round, setRound] = useState(0)
  // `round` is a dependency on purpose: "Play again" deals a new board.
  const run = useMemo(() => MatchingRun.start(client, env), [client, env, round])
  if (!run) {
    return (
      <section aria-labelledby="matching-title">
        <h1 id="matching-title">{t('matching.title')}</h1>
        <p>{t('practice.needWords')}</p>
        <Link to={{ name: 'home' }}>{t('done.home')}</Link>
      </section>
    )
  }
  return <Board key={round} run={run} onAgain={() => setRound((r) => r + 1)} />
}

function Board(props: { readonly run: MatchingRun; readonly onAgain: () => void }) {
  const { t } = useT()
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
    return (
      <li key={entry.entryId}>
        <button
          type="button"
          className={`pair${selected ? ' is-selected' : ''}${matched ? ' is-matched' : ''}`}
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

  return (
    <section className="matching" aria-labelledby="matching-title">
      <h1 id="matching-title">{t('matching.title')}</h1>
      <p className="lede">{t('matching.instructions')}</p>
      <div className="board">
        <div className="column" role="group" aria-labelledby="matching-en" data-side="left">
          <h2 id="matching-en">{t('matching.english')}</h2>
          <ul>{s.left.map((entry) => pair('left', entry))}</ul>
        </div>
        <div className="column" role="group" aria-labelledby="matching-l1" data-side="right">
          <h2 id="matching-l1">{t('matching.translation')}</h2>
          <ul>{s.right.map((entry) => pair('right', entry))}</ul>
        </div>
      </div>
      <div className="feedback" role="status">
        {s.miss && (
          <p className="incorrect">
            ✗ {t('matching.miss', { left: byId(s.miss.left)?.headword ?? '', right: byId(s.miss.right)?.translations[0] ?? '' })}
          </p>
        )}
        {s.done && <p className="correct">✓ {t('matching.done')}</p>}
        {s.error !== null && <p>{t('study.error', { message: s.error })}</p>}
      </div>
      {s.done && (
        <div className="actions">
          <button type="button" className="button primary" ref={againRef} onClick={props.onAgain}>
            {t('matching.again')}
          </button>
          <Link className="button" to={{ name: 'home' }}>
            {t('done.home')}
          </Link>
        </div>
      )}
    </section>
  )
}
