import { MatchingRun, useClient, useClientSnapshot, type MatchingSide } from '@wordado/client-data'
import type { CorpusEntry } from '@wordado/core'
import { useMemo, useState } from 'react'
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
  const { run } = props
  const s = useStore(run.store)
  const l1 = corpus?.l1 ?? 'bg'
  const byId = (entryId: string) => s.left.find((e) => e.entryId === entryId)

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
          <button type="button" className="button primary" onClick={props.onAgain}>
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
