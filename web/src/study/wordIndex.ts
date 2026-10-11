import { wordIndex, type Corpus, type WordIndex } from '@wordado/core'

const built = new WeakMap<Corpus, WordIndex>()

/** The corpus's words as the search for the whole course looks through them, folded once per corpus. */
export function courseIndex(corpus: Corpus): WordIndex {
  let index = built.get(corpus)
  if (!index) {
    index = wordIndex(corpus)
    built.set(corpus, index)
  }
  return index
}
