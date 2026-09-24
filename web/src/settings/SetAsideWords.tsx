import { useClient, useClientSnapshot } from '@wordado/client-data'
import type { WordId } from '@wordado/core'
import { useEffect, useRef } from 'react'
import { useT } from '../i18n/i18n'
import { FlagControls } from '../study/FlagControls'

/**
 * Every word set aside, to bring back (spec §7.4). A labelled section is a
 * region, found by its name. A word brought back leaves the list with the
 * button that was pressed, so focus moves to the section's heading.
 */
export function SetAsideWords() {
  const { t } = useT()
  const client = useClient()
  const { flags } = useClientSnapshot()
  const heading = useRef<HTMLHeadingElement>(null)
  /** The word being brought back, whose row (and the focused button) is about to go. */
  const leaving = useRef<WordId | null>(null)
  const words = [...flags.keys()].map((wordId) => ({ wordId, entry: client.entry(wordId) })).filter((w) => w.entry !== null)
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
                {entry!.headword}
              </span>
              <FlagControls
                wordId={wordId}
                headword={entry!.headword}
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
