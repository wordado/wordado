import type { SessionPlan } from '@wordado/core'

/** What today's session holds (spec §8.3): Today's figures, and whether a session started now would end at once. */
export function todayCounts(plan: SessionPlan): { readonly reviews: number; readonly fresh: number; readonly nothing: boolean } {
  const reviews = plan.reviews.length
  const fresh = plan.newWords.length
  return { reviews, fresh, nothing: reviews + fresh === 0 }
}
