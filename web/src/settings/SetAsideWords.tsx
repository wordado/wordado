import { entryOf, useClientSnapshot } from '@wordado/client-data'
import type { Corpus, CorpusEntry, WordFlag, WordId } from '@wordado/core'
import { useEffect, useRef } from 'react'
import { useT } from '../i18n/i18n'
import { FlagControls } from '../study/FlagControls'

/**
 * The words set aside that the list shows: those the corpus holds and teaches. A word known from the start is never
 * taught either way, so there is nothing to bring back, though the learner set it aside before (issue #288).
 */
export function setAsideList(flags: ReadonlyMap<WordId, WordFlag>, corpus: Corpus | null): { readonly wordId: WordId; readonly entry: CorpusEntry }[] {
  return [...flags.keys()].flatMap((wordId) => {
    const entry = corpus ? entryOf(corpus, wordId) : null
    return entry && entry.taught ? [{ wordId, entry }] : []
  })
}

/**
 * Every word set aside, to bring back (spec §7.4). A labelled section is a
 * region, found by its name. A word brought back leaves the list with the
 * button that was pressed, so focus moves to the section's heading.
 */
export function SetAsideWords() {
  const { t } = useT()
  const { flags, corpus } = useClientSnapshot()
  const heading = useRef<HTMLHeadingElement>(null)
  /** The word being brought back, whose row (and the focused button) is about to go. */
  const leaving = useRef<WordId | null>(null)
  const words = setAsideList(flags, corpus)
  useEffect(() => {
    if (leaving.current === null || flags.has(leaving.current)) return
    leaving.current = null
    heading.current?.focus()
  }, [flags])
  return (
    <section aria-labelledby="settings-set-aside">
      <h2 id="settings-set-aside" ref={heading} tabIndex={-1}>
        {t('settings.setAside')}
      </h2>
      <p className="note">{t('settings.setAsideHint')}</p>
      {words.length === 0 ? (
        <p>{t('settings.setAsideNone')}</p>
      ) : (
        <ul className="unit-words">
          {words.map(({ wordId, entry }) => (
            <li key={wordId}>
              <span lang="en" className="word-head">
                {entry.headword}
              </span>
              <FlagControls
                wordId={wordId}
                headword={entry.headword}
                onChange={(next) => {
                  leaving.current = next === null ? wordId : null
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
