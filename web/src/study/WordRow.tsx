import type { CorpusEntry } from '@wordado/core'
import { useClientSnapshot } from '@wordado/client-data'
import { corpusWordId } from '@wordado/core'
import { useState, type ReactNode } from 'react'
import { FlagControls } from './FlagControls'
import { Translation } from './Headword'
import { ReportDialog } from './ReportDialog'
import { PlayWord } from './RunView'

/**
 * A word in a list of the course's words (the path's units, a theme's page): its audio, the word with its
 * translation, its standing as a mark, and the ⋯ menu that changes it or reports a problem with the word (spec
 * §8.10). With `learn`, a word that is not started can be marked "Learn this word" from the menu. With `where`, a
 * line under the word says where it is in the course (the search). A word the course never teaches shows as known,
 * with nothing to change but a report to make (issue #285).
 */
export function WordRow(props: { readonly entry: CorpusEntry; readonly lang: string; readonly learn: boolean; readonly where?: ReactNode }) {
  const { entry } = props
  const { corpus } = useClientSnapshot()
  const wordId = corpusWordId(entry.entryId)
  const [reporting, setReporting] = useState(false)
  return (
    <li>
      <PlayWord entry={entry} inList />
      <span className="word-text">
        <span lang={corpus?.target ?? 'en'} className="word-head">
          {entry.headword}
        </span>
        <Translation entry={entry} lang={props.lang} />
      </span>
      <FlagControls wordId={wordId} headword={entry.headword} menu learn={props.learn} taught={entry.taught} onReport={() => setReporting(true)} />
      {props.where !== undefined && <span className="word-where">{props.where}</span>}
      {reporting && <ReportDialog wordId={wordId} entry={entry} onClose={() => setReporting(false)} />}
    </li>
  )
}
