/** Latin letters for the Bulgarian alphabet, so a Bulgarian word can be set beside an English one. */
const BG: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: '', ю: 'yu', я: 'ya',
}

/** Spellings that write one sound differently in English and in the learners' languages. */
const SAME_SOUND: readonly (readonly [string, string])[] = [
  ['ph', 'f'], ['th', 't'], ['ck', 'k'], ['c', 'k'], ['qu', 'k'], ['y', 'i'], ['w', 'v'], ['x', 'ks'], ['z', 's'], ['j', 'zh'],
]

/** How many letters of each word's beginning are compared, and how close they must be to count as alike. */
const COMPARED = 8
const SHORTEST = 4
const ALIKE = 0.7

function plain(word: string, l1: string): string {
  let s = word.toLowerCase()
  if (l1 === 'bg') s = [...s].map((c) => BG[c] ?? c).join('')
  s = s.normalize('NFKD').replace(/[^\p{L}]/gu, '')
  for (const [from, to] of SAME_SOUND) s = s.replaceAll(from, to)
  return s
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]
    for (let j = 1; j <= b.length; j += 1) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)))
    prev = cur
  }
  return prev[b.length]!
}

/**
 * Whether an English word looks like one of its translations ("information" and "información", "telephone" and "телефон"):
 * an international word a learner can recognise without knowing English at its level. The two beginnings are
 * compared after writing both in the same plain letters; words shorter than four letters are never alike.
 */
export function looksAlike(headword: string, translations: readonly string[], l1: string): boolean {
  const english = plain(headword, l1)
  return translations.some((translation) =>
    translation.split(/[\s,;]+/).some((part) => {
      const word = plain(part, l1)
      const n = Math.min(english.length, word.length, COMPARED)
      return n >= SHORTEST && 1 - editDistance(english.slice(0, n), word.slice(0, n)) / n >= ALIKE
    }),
  )
}
