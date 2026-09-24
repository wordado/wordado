import { useClient, useClientSnapshot } from '@wordado/client-data'
import { useT } from '../i18n/i18n'
import { FlagControls } from '../study/FlagControls'

/** Every word set aside, to bring back (spec §7.4). A labelled section is a region, found by its name. */
export function SetAsideWords() {
  const { t } = useT()
  const client = useClient()
  const { flags } = useClientSnapshot()
  const words = [...flags.keys()].map((wordId) => ({ wordId, entry: client.entry(wordId) })).filter((w) => w.entry !== null)
  return (
    <section aria-labelledby="settings-set-aside">
      <h2 id="settings-set-aside">{t('settings.setAside')}</h2>
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
              <FlagControls wordId={wordId} headword={entry!.headword} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
