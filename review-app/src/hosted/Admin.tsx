import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { AssignmentView, Language, ReviewerView, SnapshotStatus, SubmissionView } from '../../shared/hosted'
import { HeaderSlot } from '../AppHeader'
import { hostedApi } from '../hostedApi'
import { AdminAssignments } from './AdminAssignments'
import { AdminOverview } from './AdminOverview'
import { AdminReviewers } from './AdminReviewers'
import { AdminSubmissions } from './AdminSubmissions'
import { type Act, messageOf } from './adminUtil'

const TABS = [
  ['overview', 'Overview'],
  ['reviewers', 'Reviewers'],
  ['assignments', 'Assignments'],
  ['submissions', 'Submissions'],
] as const
type Tab = (typeof TABS)[number][0]

/** The admin tab an address names: "#reviewers" → "reviewers"; null for anything else. */
export function adminTabOf(hash: string): Tab | null {
  return TABS.find(([id]) => `#${id}` === hash)?.[0] ?? null
}

/** The admin page: Overview, Reviewers, Assignments and Submissions as tabs in the header, one shown at a time. The
 * tab is kept in the address (`#reviewers`), so a reload stays put. `onBack` is the way to the reviewer's own
 * assignments, drawn beside the tabs. */
export function Admin(props: { onBack?: () => void }) {
  const [snapshot, setSnapshot] = useState<SnapshotStatus | null | undefined>(undefined)
  const [reviewers, setReviewers] = useState<ReviewerView[] | undefined>(undefined)
  const [assignments, setAssignments] = useState<AssignmentView[] | undefined>(undefined)
  const [submissions, setSubmissions] = useState<SubmissionView[] | undefined>(undefined)
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<Tab>(() => adminTabOf(window.location.hash) ?? 'overview')
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

  useEffect(() => void reload(), [reload])

  /** Shows a tab. The notice is about what was done on the tab that is left, so it goes with it. */
  const shown = useRef(tab)
  const show = useCallback((next: Tab) => {
    if (next !== shown.current) setNotice('')
    shown.current = next
    setTab(next)
  }, [])

  // The address names the tab from the start (without a step in the history), and the tab follows it: Back and
  // Forward move between the tabs.
  useEffect(() => {
    if (!adminTabOf(window.location.hash)) window.history.replaceState(window.history.state, '', '#overview')
    const onHash = () => show(adminTabOf(window.location.hash) ?? 'overview')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [show])

  const go = (next: Tab) => {
    show(next)
    if (adminTabOf(window.location.hash) !== next) window.location.hash = next
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

  /** Assign on a language nobody holds: the Assign dialog with its translations chosen (its only queue otherwise). */
  const assignLanguage = (language: Language) => {
    const queues = (snapshot?.queues ?? []).filter((q) => q.language === language)
    const queue = queues.find((q) => q.queue.startsWith('translation-')) ?? queues[0]
    setNotice('')
    setAssigning({ queue: queue?.queue ?? '' })
    go('assignments')
  }

  return (
    <div className="admin page wide">
      <HeaderSlot>
        <AdminTabs tab={tab} onGo={go} {...(props.onBack ? { onBack: props.onBack } : {})} />
      </HeaderSlot>
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
      </section>
    </div>
  )
}

/** The tabs, for the header: the way back to the reviewer's assignments, then the four admin pages as a tablist.
 * On a phone they are a strip that slides sideways; the chosen tab is slid into view. */
function AdminTabs(props: { tab: Tab; onGo(tab: Tab): void; onBack?: () => void }) {
  const { tab } = props
  const strip = useRef<HTMLElement>(null)

  useEffect(() => {
    const nav = strip.current
    const chosen = nav?.querySelector('[aria-selected="true"]')
    if (!nav || !chosen) return
    const [around, at] = [nav.getBoundingClientRect(), chosen.getBoundingClientRect()]
    if (at.left < around.left) nav.scrollLeft -= around.left - at.left + 12
    else if (at.right > around.right) nav.scrollLeft += at.right - around.right + 12
  }, [tab])

  /** Left and Right move between the tabs (round the ends), Home and End go to the first and the last. */
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = TABS.findIndex(([id]) => id === tab)
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    const next = TABS[(to + TABS.length) % TABS.length]![0]
    props.onGo(next)
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`#admin-tab-${next}`)?.focus()
  }

  return (
    <nav ref={strip} className="tabs admin-tabs" aria-label="Admin">
      {props.onBack && (
        <button type="button" onClick={props.onBack}>
          My assignments
        </button>
      )}
      <div role="tablist" aria-label="Admin pages">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`admin-tab-${id}`} aria-selected={tab === id} aria-controls="admin-panel" tabIndex={tab === id ? 0 : -1} onClick={() => props.onGo(id)} onKeyDown={onKey}>
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}
