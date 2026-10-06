import { type AssignmentView, type Language, LANGUAGE_NAMES, LANGUAGES, type ReviewerView, type SnapshotStatus, type SubmissionView } from '../../shared/hosted'

/** How far one language is: what is left in its queues, who is on them and what they have decided. */
export interface LanguageOverview {
  readonly language: Language
  readonly label: string
  /** what is left to decide, per queue: "741 translations · 8 titles" */
  readonly parts: string
  /** the names with an open assignment on one of its queues */
  readonly reviewers: string[]
  /** flagged and reported rows in its queues */
  readonly flagged: number
  readonly decided: number
  readonly submitted: number
  readonly state: 'unassigned' | 'on track' | 'done'
}

export interface Overview {
  readonly toDecide: number
  /** decided and not yet submitted, over the open assignments */
  readonly decided: number
  readonly openPrs: number
  readonly activeReviewers: number
  readonly languages: LanguageOverview[]
}

type Queue = SnapshotStatus['queues'][number]

/** The rows of a queue that wait for a decision: the flagged and the reported ones. */
const openRows = (q: Queue): number => q.files.reduce((n, f) => n + f.flagged + f.reported, 0)

const KINDS = [
  ['translation-', 'translation', 'translations'],
  ['title-', 'title', 'titles'],
  ['', 'row', 'rows'],
] as const

/** "741 translations · 8 titles", "21 rows": a part per queue that has something left, translations first. */
function partsOf(queues: readonly Queue[]): string {
  const parts = KINDS.map(([, one, many], i) => {
    // a queue is of the first kind whose prefix it has; the last kind takes the rest
    const mine = queues.filter((q) => KINDS.findIndex(([prefix]) => q.queue.startsWith(prefix)) === i)
    const n = mine.reduce((sum, q) => sum + openRows(q), 0)
    return n === 0 ? '' : `${n.toLocaleString('en')} ${n === 1 ? one : many}`
  }).filter(Boolean)
  return parts.join(' · ') || 'nothing left to decide'
}

/** The admin Overview, from what the admin API returns: four numbers and a row per language with a queue. */
export function overviewOf(data: {
  snapshot: SnapshotStatus | null
  assignments: readonly AssignmentView[]
  submissions: readonly SubmissionView[]
  reviewers: readonly ReviewerView[]
}): Overview {
  const queues = data.snapshot?.queues ?? []
  const open = data.assignments.filter((a) => !a.closedAt)
  const languages = LANGUAGES.flatMap((language): LanguageOverview[] => {
    const mine = queues.filter((q) => q.language === language)
    if (mine.length === 0) return []
    const held = open.filter((a) => mine.some((q) => q.queue === a.queue))
    const flagged = mine.reduce((n, q) => n + openRows(q), 0)
    return [
      {
        language,
        label: LANGUAGE_NAMES[language],
        parts: partsOf(mine),
        reviewers: [...new Set(held.map((a) => a.reviewerName))],
        flagged,
        decided: held.reduce((n, a) => n + (a.progress?.decided ?? 0), 0),
        submitted: held.reduce((n, a) => n + (a.progress?.submitted ?? 0), 0),
        state: flagged === 0 ? 'done' : held.length === 0 ? 'unassigned' : 'on track',
      },
    ]
  })
  return {
    toDecide: queues.reduce((n, q) => n + openRows(q), 0),
    decided: open.reduce((n, a) => n + (a.progress?.decided ?? 0), 0),
    openPrs: data.submissions.filter((s) => s.status === 'open').length,
    activeReviewers: data.reviewers.filter((r) => !r.disabledAt).length,
    languages,
  }
}
