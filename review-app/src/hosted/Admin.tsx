import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { Target } from '@wordado/core'
import { type AssignmentView, type Language, queueParts, type ReviewerView, type SnapshotStatus, type SubmissionView } from '../../shared/hosted'
import { HeaderSlot } from '../AppHeader'
import { hostedApi } from '../hostedApi'
import { AdminAccounts } from './AdminAccounts'
import { AdminAnnouncements } from './AdminAnnouncements'
import { AdminAssignments } from './AdminAssignments'
import { AdminFeedback } from './AdminFeedback'
import { AdminOverview } from './AdminOverview'
import { AdminReviewers } from './AdminReviewers'
import { AdminSubmissions } from './AdminSubmissions'
import { Assignments } from './Assignments'
import { type Act, messageOf } from './adminUtil'

/** The pages of the word review, under the Review tab. */
const REVIEW_PAGES = [
  ['overview', 'Overview'],
  ['reviewers', 'Reviewers'],
  ['assignments', 'Assignments'],
  ['submissions', 'Submissions'],
  // The admin's own assignments: the reviewer's first screen (#232).
  ['my-work', 'My work'],
] as const
type ReviewPage = (typeof REVIEW_PAGES)[number][0]

/** The tabs in the header, the one that is read most first (#232). */
const TABS = [
  ['feedback', 'Feedback'],
  ['accounts', 'Accounts'],
  // Mail (#215): the announcements, under the address they have had since #185.
  ['announcements', 'Mail'],
  ['review', 'Review'],
] as const
type Tab = (typeof TABS)[number][0]
/** What is shown: a tab's own page, or one of the pages under Review. */
type Page = Exclude<Tab, 'review'> | ReviewPage

const isReviewPage = (page: string): page is ReviewPage => REVIEW_PAGES.some(([id]) => id === page)
const addressOf = (page: Page) => (isReviewPage(page) ? `#review/${page}` : `#${page}`)

/** The admin page an address names: "#feedback" → "feedback", "#review/reviewers" → "reviewers"; null for anything
 * else. A review page's address from before the pages were grouped ("#reviewers") still names it. */
export function adminTabOf(hash: string): Page | null {
  const name = hash.replace(/^#(review\/)?/, '')
  if (hash === '#review') return 'overview'
  if (isReviewPage(name)) return name
  return hash === `#${name}` && name !== 'review' && TABS.some(([id]) => id === name) ? (name as Page) : null
}

/** The admin page: Feedback, Accounts, Mail and Review as tabs in the header, one shown at a time; Review has the
 * pages of the word review as a second row of tabs. The page is kept in the address (`#review/reviewers`), so a
 * reload stays put. The Feedback tab reads what it shows itself, when it is opened: it comes from another server, a
 * page at a time. So do the Accounts and the Mail tabs; the review's data is read when one of its pages is opened. */
export function Admin(props: { onOpen(assignment: AssignmentView): void }) {
  const [snapshot, setSnapshot] = useState<SnapshotStatus | null | undefined>(undefined)
  const [reviewers, setReviewers] = useState<ReviewerView[] | undefined>(undefined)
  const [assignments, setAssignments] = useState<AssignmentView[] | undefined>(undefined)
  const [submissions, setSubmissions] = useState<SubmissionView[] | undefined>(undefined)
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<Page>(() => adminTabOf(window.location.hash) ?? 'feedback')
  // The Assign dialog belongs to the Assignments tab; the Overview opens it too, with a queue chosen.
  const [assigning, setAssigning] = useState<{ readonly queue: string } | null>(null)

  const reload = useCallback(async () => {
    const fail = (err: unknown) => setNotice(messageOf(err))
    await Promise.all([
      hostedApi.admin.snapshot().then(setSnapshot, fail),
      hostedApi.admin.reviewers().then(setReviewers, fail),
      hostedApi.admin.assignments().then(setAssignments, fail),
      hostedApi.admin.submissions().then(setSubmissions, fail),
    ])
  }, [])

  // My work reads its own list; the other review pages share these four reads.
  const reads = isReviewPage(tab) && tab !== 'my-work'
  useEffect(() => {
    if (reads) void reload()
  }, [reads, reload])

  /** Shows a page. The notice is about what was done on the page that is left, so it goes with it. */
  const shown = useRef(tab)
  /** The review page last shown: where the Review tab goes back to. */
  const lastReview = useRef<ReviewPage>(isReviewPage(tab) ? tab : 'overview')
  const show = useCallback((next: Page) => {
    if (next !== shown.current) setNotice('')
    shown.current = next
    if (isReviewPage(next)) lastReview.current = next
    setTab(next)
  }, [])

  // The address names the page from the start (without a step in the history; an old address is put in today's
  // form), and the page follows it: Back and Forward move between the pages.
  useEffect(() => {
    const named = addressOf(adminTabOf(window.location.hash) ?? 'feedback')
    if (window.location.hash !== named) window.history.replaceState(window.history.state, '', named)
    const onHash = () => show(adminTabOf(window.location.hash) ?? 'feedback')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [show])

  const go = (next: Page) => {
    show(next)
    if (window.location.hash !== addressOf(next)) window.location.hash = addressOf(next)
  }

  const act: Act = useCallback(
    async (action) => {
      setNotice('')
      try {
        await action()
        return true
      } catch (err) {
        setNotice(messageOf(err))
        return false
      } finally {
        await reload()
      }
    },
    [reload],
  )
  const clearNotice = useCallback(() => setNotice(''), [])

  /** Assign on a language of a course nobody holds: the Assign dialog with its translations chosen (its first queue otherwise). */
  const assignLanguage = (target: Target, language: Language) => {
    const queues = (snapshot?.queues ?? []).filter((q) => q.language === language && queueParts(q.queue)?.target === target)
    const queue = queues.find((q) => queueParts(q.queue)!.name.startsWith('translation-')) ?? queues[0]
    setNotice('')
    setAssigning({ queue: queue?.queue ?? '' })
    go('assignments')
  }

  const inReview = isReviewPage(tab)

  return (
    <div className="admin page wide">
      <HeaderSlot>
        <nav className="tabs admin-tabs" aria-label="Admin">
          <TabRow label="Admin pages" tabs={TABS} chosen={inReview ? 'review' : tab} onGo={(id) => go(id === 'review' ? lastReview.current : id)} />
        </nav>
      </HeaderSlot>
      {inReview && (
        <nav className="tabs sub-tabs" aria-label="Review">
          <TabRow label="Review pages" tabs={REVIEW_PAGES} chosen={tab} onGo={go} />
        </nav>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section role="tabpanel" id="admin-panel" aria-labelledby={`admin-tab-${tab}`} className="tab-panel">
        {tab === 'overview' && <AdminOverview snapshot={snapshot} reviewers={reviewers} assignments={assignments} submissions={submissions} onAssign={assignLanguage} />}
        {tab === 'reviewers' && <AdminReviewers reviewers={reviewers} act={act} notice={notice} clearNotice={clearNotice} />}
        {tab === 'assignments' && (
          <AdminAssignments snapshot={snapshot} reviewers={reviewers} assignments={assignments} act={act} notice={notice} clearNotice={clearNotice} assigning={assigning} onAssigning={setAssigning} />
        )}
        {tab === 'submissions' && <AdminSubmissions submissions={submissions} />}
        {tab === 'my-work' && <Assignments onOpen={props.onOpen} />}
        {tab === 'feedback' && <AdminFeedback />}
        {tab === 'accounts' && <AdminAccounts />}
        {tab === 'announcements' && <AdminAnnouncements />}
      </section>
    </div>
  )
}

/** One row of tabs, as a tablist. On a phone the header's row is a strip that slides sideways; the chosen tab is
 * slid into view. */
function TabRow<Id extends string>(props: { label: string; tabs: readonly (readonly [Id, string])[]; chosen: Id; onGo(id: Id): void }) {
  const { tabs, chosen } = props
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const nav = list.current?.parentElement
    const at = list.current?.querySelector('[aria-selected="true"]')?.getBoundingClientRect()
    if (!nav || !at) return
    const around = nav.getBoundingClientRect()
    if (at.left < around.left) nav.scrollLeft -= around.left - at.left + 12
    else if (at.right > around.right) nav.scrollLeft += at.right - around.right + 12
  }, [chosen])

  /** Left and Right move between the tabs (round the ends), Home and End go to the first and the last. */
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = tabs.findIndex(([id]) => id === chosen)
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    const next = tabs[(to + tabs.length) % tabs.length]![0]
    props.onGo(next)
    list.current?.querySelector<HTMLElement>(`#admin-tab-${next}`)?.focus()
  }

  return (
    <div ref={list} role="tablist" aria-label={props.label}>
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" id={`admin-tab-${id}`} aria-selected={chosen === id} aria-controls="admin-panel" tabIndex={chosen === id ? 0 : -1} onClick={() => props.onGo(id)} onKeyDown={onKey}>
          {label}
        </button>
      ))}
    </div>
  )
}
