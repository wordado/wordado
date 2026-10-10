import type { SpotCheckView } from '../../shared/hosted'

/** What a spot check is for, in one line: on My work and above its rows. */
export const SPOT_CHECK_PURPOSE = 'These rows passed the AI review. Keep what is right, change what is wrong.'

/** How many rows a spot check asks for unless the coordinator says otherwise, and the most it can. */
export const SPOT_CHECK_ROWS = 50
export const SPOT_CHECK_MAX = 500

/** A spot check's result in one line: "50 in the sample · checked 12 · fine 9 · minor 2 · serious 1". */
export function resultLine(s: SpotCheckView): string {
  const r = s.result
  if (!r) return `${s.sample} in the sample · the review data is not available yet`
  return [`${s.sample} in the sample`, `checked ${r.checked}`, `fine ${r.fine}`, `minor ${r.minor}`, `serious ${r.serious}`].join(' · ')
}
