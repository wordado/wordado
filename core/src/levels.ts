import { levelIndex, type CefrLevel } from './types'

/** Whether an entry's level is above the learner's declared level (spec §8.9). */
export function isAboveLevel(entryLevel: CefrLevel, declaredLevel: CefrLevel): boolean {
  return levelIndex(entryLevel) > levelIndex(declaredLevel)
}
