import { replay, type AliasMap, type ReplayEvent } from './replay'
import type { ReviewState } from './scheduler'
import type { WordId } from './wordId'

/** Per device, the highest deviceSeq the server's derived state included (spec §4.3). */
export type DeviceMarks = ReadonlyMap<string, number>

/** An event the server's snapshot cannot contain: newer than its mark, or from a device it has not seen. */
export function isAboveMark(event: Pick<ReplayEvent, 'deviceId' | 'deviceSeq'>, marks: DeviceMarks): boolean {
  const mark = marks.get(event.deviceId)
  return mark === undefined || event.deviceSeq > mark
}

/**
 * The rebase rule: replace local state with the server's, then re-apply the
 * local events above the server's marks, so a pull never rolls back answers
 * the learner has just given (spec §4.3). Events still in the outbox carry
 * their clientTs as effectiveTs until the server stamps them.
 */
export function rebase(
  serverStates: ReadonlyMap<WordId, ReviewState>,
  marks: DeviceMarks,
  localEvents: Iterable<ReplayEvent>,
  aliases: AliasMap = new Map(),
  tombstoned: ReadonlySet<WordId> = new Set(),
): Map<WordId, ReviewState> {
  const newer = [...localEvents].filter((event) => isAboveMark(event, marks))
  return replay(newer, aliases, { prior: serverStates, tombstoned })
}
