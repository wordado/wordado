import type { CorpusEntry } from '@wordado/core'
import { useT } from '../i18n/i18n'
import { POS_LABEL } from '../labels'

/** The dictionary entry (the one memorable element of the design): headword, IPA, part of speech. */
export function Headword(props: { readonly entry: CorpusEntry; readonly id?: string }) {
  const { t } = useT()
  const { entry } = props
  const ipa = entry.ipa.replace(/^\/|\/$/g, '')
  return (
    <div className="headword">
      <p className="hw-word" lang="en" id={props.id}>
        {entry.headword}
      </p>
      <p className="hw-meta">
        {ipa !== '' && (
          <span className="hw-ipa" lang="en-fonipa">
            /{ipa}/
          </span>
        )}{' '}
        <i className="hw-pos">{t(POS_LABEL[entry.pos])}</i>
      </p>
    </div>
  )
}

/** The primary translation, with the sense gloss where the headword alone is ambiguous (spec §5.2). */
export function Translation(props: { readonly entry: CorpusEntry; readonly lang: string }) {
  const { entry } = props
  return (
    <span className="translation" lang={props.lang}>
      {entry.translations[0]}
      {entry.sense !== '' && <span className="sense"> ({entry.sense})</span>}
    </span>
  )
}
