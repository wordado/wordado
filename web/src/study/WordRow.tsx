import type { CorpusEntry } from '@wordado/core'
import { corpusWordId } from '@wordado/core'
import { FlagControls } from './FlagControls'
import { Translation } from './Headword'
import { PlayWord } from './RunView'

/**
 * A word in a list of the course's words (the path's units, a theme's page): its audio, the word with its
 * translation, its standing as a mark, and the ⋯ menu that changes it. With `learn`, a word that is not
 * started can be marked "Learn this word" from the menu.
 */
export function WordRow(props: { readonly entry: CorpusEntry; readonly lang: string; readonly learn: boolean }) {
  const { entry } = props
  return (
    <li>
      <PlayWord entry={entry} inList />
      <span className="word-text">
        <span lang="en" className="word-head">
          {entry.headword}
        </span>
        <Translation entry={entry} lang={props.lang} />
      </span>
      <FlagControls wordId={corpusWordId(entry.entryId)} headword={entry.headword} menu learn={props.learn} />
    </li>
  )
}
