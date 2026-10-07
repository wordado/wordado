import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { type Browser, chromium, type Page, type Route } from '@playwright/test'

/* Screenshots of every screen, for a pull request description and for a look at the whole app after a change to its
 * styles: `pnpm --filter @wordado/review-app screenshots`. It starts the two fixture servers the browser runs use
 * (hosted on :4181, local on :4180), walks through the screens and writes each one at desktop and phone size, light
 * and dark, into .e2e/screenshots/ (not committed); a page longer than the screen is also written whole, into
 * .e2e/screenshots/full/. States the fixture does not have (a row with several objections, long values, a unit
 * title, a stale file, a language nobody holds, the answers to Submit, Import and Propose) are put into the API's
 * answers on their way to the page. It ends by saying what it found sticking out of a screen or offering two main
 * actions, and stops both servers. */

const root = join(import.meta.dirname, '..')
const out = join(root, '.e2e', 'screenshots')
const HOSTED = 'http://127.0.0.1:4181'
const LOCAL = 'http://127.0.0.1:4180'

const SCREENS = [
  { id: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false },
  { id: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true },
] as const
const SCHEMES = ['light', 'dark'] as const

type Who = 'admin' | 'reviewer' | 'phone'
type Row = Record<string, unknown>
/** Changes the rows the API answered with, before the page gets them. */
type Change = (rows: Row[]) => Row[]
/** Sets up, before the page loads, what one API path answers. */
type Api = (page: Page) => Promise<unknown>

/** The rows as the server has them, changed. The hosted mode answers `{ rows }`, the local one the list itself. */
const rows =
  (change: Change): Api =>
  (page) =>
    page.route('**/api/rows*', async (route: Route) => {
      const response = await route.fetch()
      const body = (await response.json()) as Row[] | { rows: Row[] }
      await route.fulfill({ response, json: Array.isArray(body) ? change(body) : { ...body, rows: change(body.rows) } })
    })

/** `json` as the answer of the paths that match, without asking the server: its state stays as it is. */
const answer =
  (path: RegExp, json: unknown): Api =>
  (page) =>
    page.route(path, (route: Route) => route.fulfill({ json }))

/** Two Spanish queues nobody holds, added to the review data the admin page gets. */
const SPANISH: Api = (page) =>
  page.route('**/api/admin/snapshot', async (route: Route) => {
    const response = await route.fetch()
    const body = (await response.json()) as { queues: unknown[] }
    const file = (queue: string, n: number, rowCount: number, flagged: number) => ({ file: `review/${queue}/2026-10-04-0${n}.csv`, rows: rowCount, flagged, reported: 0, assignedTo: null })
    const queues = [
      { queue: 'translation-es', language: 'es', files: [file('translation-es', 1, 1200, 301), file('translation-es', 2, 1200, 263)] },
      { queue: 'title-es', language: 'es', files: [file('title-es', 1, 96, 13)] },
    ]
    await route.fulfill({ response, json: { ...body, queues: [...body.queues, ...queues] } })
  })

/** What Propose answers for the Bulgarian unit titles: the fixture has one file, too few to split. */
const PROPOSAL = answer(/\/api\/admin\/assignments\/split$/, {
  proposal: [
    { reviewer: 'hans@example.com', files: ['review/title-bg/2026-10-04-01.csv', 'review/title-bg/2026-10-04-03.csv'], rows: 31 },
    { reviewer: 'reviewer@example.com', files: ['review/title-bg/2026-10-04-02.csv'], rows: 29 },
  ],
})

interface Shot {
  readonly name: string
  /** hosted: who is signed in; left out: the local mode */
  readonly who?: Who
  /** where to start, e.g. "/#reviewers" */
  readonly path?: string
  /** what the page is to get from the API instead of the server's own answers */
  readonly api?: readonly Api[]
  /** gets the page to the state to capture; must not change anything on the server */
  steps(page: Page): Promise<void>
}

// ---- the servers ----

const servers: ChildProcess[] = []

/** Starts a fixture server in a process group of its own, so that stopping it takes what it started (wrangler,
 * workerd) with it. */
function start(script: string): void {
  servers.push(spawn('pnpm', ['exec', 'tsx', script], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], detached: true }))
}

function stopServers(): void {
  for (const s of servers.splice(0)) {
    if (s.pid === undefined) continue
    try {
      process.kill(-s.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
}

async function up(url: string, seconds: number): Promise<void> {
  for (let i = 0; i < seconds * 2; i += 1) {
    if (await fetch(url).then((r) => r.status < 500, () => false)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} did not come up in ${seconds}s`)
}

// ---- rows the fixture does not have ----

const flash = { reviewer: 'flash', model: 'google/gemini-3.8-flash' }
const pro = { reviewer: 'pro', model: 'google/gemini-3.8-pro' }

/** Puts `patch` over the first undecided row. */
const first =
  (patch: Row): Change =>
  (rows) => {
    const at = rows.findIndex((r) => !r['decided'] && !r['decision'])
    return rows.map((r, i) => (i === at ? { ...r, ...patch } : r))
  }

/** A row two reviewers object to: three objections on two fields, a learner report, another sense. */
const SEVERAL = first({
  kind: 'translation',
  fields: ['translation', 'alternates', 'sense'],
  cells: { translation: 'банка', alternates: 'бряг', sense: '' },
  context: { headword: 'bank', pos: 'noun', level: 'A2', sense_en: 'edge of a river', example: 'We sat on the bank and watched the boats.' },
  reports: '2 reports (translation): odd word; wrong word',
  severity: 'major',
  ai: 'flagged',
  otherSenses: [{ key: 'bank-1', translation: 'банка', sense_en: 'financial institution' }],
  objections: [
    { ...flash, field: 'translation', category: 'wrong-sense', severity: 'major', reason: 'банка is the money sense; a river’s edge is бряг', fix: 'бряг' },
    { ...pro, field: 'translation', category: 'register', severity: 'minor', reason: 'the everyday word is речен бряг', fix: 'речен бряг' },
    { ...flash, field: 'sense', category: 'sense-missing', severity: 'minor', reason: 'two senses share this word: say which', fix: 'край на река' },
  ],
})

/** A row whose values are as long as they get: a 60-character translation, five alternates, a long reason. */
const LONG = first({
  kind: 'translation',
  fields: ['translation', 'alternates', 'sense'],
  cells: {
    translation: 'Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenantrag',
    alternates: 'крайбрежие; речен бряг; бряг на река; крайречие; брегова ивица',
    sense: 'край на река, където водата среща сушата и хората сядат да гледат лодките',
  },
  context: {
    headword: 'counterrevolutionaries-and-then-some',
    pos: 'noun',
    level: 'A2',
    sense_en: 'edge of a river, where the water meets the land',
    example: 'We sat on the bank and watched the boats go by for a very long afternoon indeed.',
  },
  reports: '3 reports (translation): odd word, wrong word, very-long-unbroken-report-text-very-long-unbroken-report-text',
  severity: 'major',
  ai: 'flagged',
  otherSenses: [{ key: 'bank-1', translation: 'финансоваинституциякоятопазипаритенахората', sense_en: 'financial institution' }],
  objections: [
    {
      ...flash,
      field: 'translation',
      category: 'wrong-sense',
      severity: 'major',
      reason: 'банка is the money sense; a river’s edge is бряг, and this reason goes on and on to see that it wraps inside the card without pushing anything out of the screen',
      fix: 'Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz',
    },
    { ...flash, field: 'sense', category: 'sense-unclear-and-a-long-category-name', severity: 'minor', reason: 'say which edge', fix: 'бряг на река' },
  ],
})

/** A unit title with one objection. */
const TITLE = first({
  key: 'A1-03',
  kind: 'title',
  fields: ['title_en', 'title_l1'],
  cells: { title_en: 'At the river', title_l1: 'На реката' },
  context: { level: 'A1', words: 'bank, river, boat, bridge, water, swim' },
  reports: '',
  severity: 'minor',
  ai: 'flagged',
  otherSenses: [],
  objections: [{ ...flash, field: 'title_l1', category: 'unnatural', severity: 'minor', reason: 'a title reads better without the article', fix: 'Край реката' }],
})

/** A row of a file that is older than the draft, and (hosted) a decision on a row that changed since. */
const STALE: Change = (rows) => first({ stale: true })(rows.map((r, i) => (i === rows.length - 1 ? { ...r, decision: { action: 'keep', cells: r['cells'], note: '', submission: null, changed: true } } : r)))

/** Every row decided: the screen has nothing left. */
const ALL_DECIDED: Change = (rows) => rows.map((r) => ({ ...r, decided: { verdict: 'keep', note: '' } }))

// ---- getting to a screen ----

const article = (page: Page) => page.getByRole('article')

/** Opens the signed-in reviewer's first assignment. */
async function openAssignment(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Start|Continue)$/ }).first().click()
  await article(page).or(page.getByText('Nothing left to decide here.')).waitFor()
}

/** Opens the row list and chooses the first row whose button matches. */
async function chooseRow(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'All rows' }).click()
  await page.getByRole('list', { name: 'Rows' }).getByRole('button', { name }).first().click()
  await article(page).waitFor()
}

async function openDialog(page: Page, button: string | RegExp, dialog: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: button }).first().click()
  await page.getByRole('dialog', { name: dialog }).waitFor()
}

/** Opens the account menu from the round button in the header. */
async function openAccount(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account: / }).click()
  await page.getByRole('menu', { name: 'Account' }).waitFor()
}

/** Assign work with Hans and the Bulgarian translations chosen: the files and who holds them show. */
async function assignDialog(page: Page): Promise<void> {
  await openDialog(page, 'Assign work', 'Assign work')
  const form = page.getByRole('form', { name: 'Assign' })
  await form.getByLabel('Reviewer').selectOption('hans@example.com')
  await form.getByLabel('Queue').selectOption('translation-bg')
}

const SHOTS_BEFORE: readonly Shot[] = [
  { name: 'hosted-assignments', who: 'reviewer', steps: async (page) => void (await page.getByRole('heading', { name: 'Your assignments' }).waitFor()) },
  { name: 'hosted-review-one-objection', who: 'reviewer', steps: async (page) => (await openAssignment(page), await chooseRow(page, /bank-/)) },
  { name: 'hosted-review-objections', who: 'reviewer', api: [rows(SEVERAL)], steps: openAssignment },
  { name: 'hosted-review-long', who: 'reviewer', api: [rows(LONG)], steps: openAssignment },
  { name: 'hosted-review-title', who: 'reviewer', api: [rows(TITLE)], steps: openAssignment },
  { name: 'hosted-review-level', who: 'phone', steps: openAssignment },
  { name: 'hosted-review-account-menu', who: 'reviewer', api: [rows(SEVERAL)], steps: async (page) => (await openAssignment(page), await openAccount(page)) },
  {
    name: 'hosted-review-editing',
    who: 'reviewer',
    api: [rows(SEVERAL)],
    steps: async (page) => {
      await openAssignment(page)
      await page.getByRole('button', { name: /^Edit/ }).click()
      await page.getByRole('textbox', { name: 'Translation' }).waitFor()
    },
  },
  {
    name: 'hosted-review-note',
    who: 'reviewer',
    api: [rows(SEVERAL)],
    steps: async (page) => {
      await openAssignment(page)
      await page.getByRole('button', { name: 'Add a note' }).click()
      await page.getByLabel('Note for the coordinator').fill('Both fixes are fine; I took the shorter one.')
    },
  },
  {
    name: 'hosted-review-list',
    who: 'phone',
    steps: async (page) => {
      await openAssignment(page)
      await page.getByRole('button', { name: 'All rows' }).click()
      await page.getByRole('list', { name: 'Rows' }).waitFor()
    },
  },
  { name: 'hosted-review-stale', who: 'reviewer', api: [rows(STALE)], steps: openAssignment },
]

const SHOTS_DECIDED: readonly Shot[] = [
  { name: 'hosted-assignments-progress', who: 'reviewer', steps: async (page) => void (await page.getByRole('button', { name: 'Continue' }).waitFor()) },
  { name: 'hosted-review-decided', who: 'reviewer', steps: async (page) => (await openAssignment(page), await chooseRow(page, /ok$/)) },
  {
    name: 'hosted-review-submitted',
    who: 'reviewer',
    api: [answer(/\/api\/submit$/, { pr: 12, url: 'https://github.com/example/content/pull/12', count: 2, leftOut: [{ key: 'bank-2', reason: 'changed' }] })],
    steps: async (page) => {
      await openAssignment(page)
      await page.getByRole('button', { name: /Submit 2 decisions/ }).click()
      await page.getByRole('link', { name: /pull request 12/ }).waitFor()
    },
  },
]

const SHOTS_DONE: readonly Shot[] = [{ name: 'hosted-review-done', who: 'reviewer', steps: openAssignment }]

const SHOTS_ADMIN: readonly Shot[] = [
  { name: 'hosted-admin-overview', who: 'admin', path: '/#overview', steps: async (page) => void (await page.getByText('rows to decide').waitFor()) },
  { name: 'hosted-admin-account-menu', who: 'admin', path: '/#overview', steps: async (page) => (await page.getByText('rows to decide').waitFor(), await openAccount(page)) },
  { name: 'hosted-admin-overview-unassigned', who: 'admin', path: '/#overview', api: [SPANISH], steps: async (page) => void (await page.getByRole('button', { name: 'Assign Spanish' }).waitFor()) },
  { name: 'hosted-admin-reviewers', who: 'admin', path: '/#reviewers', steps: async (page) => void (await page.getByText('reviewer@example.com', { exact: true }).waitFor()) },
  { name: 'hosted-admin-assignments', who: 'admin', path: '/#assignments', steps: async (page) => void (await page.getByRole('button', { name: 'Reassign…' }).first().waitFor()) },
  { name: 'hosted-admin-submissions', who: 'admin', path: '/#submissions', steps: async (page) => void (await page.getByRole('link', { name: /pull request/ }).first().waitFor()) },
  {
    name: 'hosted-admin-dialog-invite',
    who: 'admin',
    path: '/#reviewers',
    steps: async (page) => {
      await openDialog(page, 'Invite a reviewer', 'Invite a reviewer')
      const form = page.getByRole('form', { name: 'Invite a reviewer' })
      await form.getByLabel('Email').fill('anna@example.com')
      await form.getByLabel('Name').fill('Anna')
      await form.getByLabel('German').check()
    },
  },
  { name: 'hosted-admin-dialog-languages', who: 'admin', path: '/#reviewers', steps: (page) => openDialog(page, 'Edit Rita', /Languages of Rita/) },
  { name: 'hosted-admin-dialog-assign', who: 'admin', path: '/#assignments', steps: assignDialog },
  {
    name: 'hosted-admin-dialog-assign-refused',
    who: 'admin',
    path: '/#assignments',
    steps: async (page) => {
      await assignDialog(page)
      const form = page.getByRole('form', { name: 'Assign' })
      await form.getByLabel('All files').check()
      await form.getByRole('button', { name: 'Assign' }).click()
      await page.getByRole('dialog').getByRole('alert').waitFor()
    },
  },
  {
    name: 'hosted-admin-dialog-split',
    who: 'admin',
    path: '/#assignments',
    api: [PROPOSAL],
    steps: async (page) => {
      await openDialog(page, 'Split a queue', 'Split a queue')
      const form = page.getByRole('form', { name: 'Split a queue' })
      await form.getByLabel('Queue').selectOption('title-bg')
      await form.getByLabel('Rita').check()
      await form.getByLabel('Hans').check()
      await form.getByRole('button', { name: 'Propose' }).click()
      await form.getByRole('button', { name: 'Create these assignments' }).waitFor()
    },
  },
  { name: 'hosted-admin-dialog-reassign', who: 'admin', path: '/#assignments', steps: (page) => openDialog(page, 'Reassign…', 'Reassign') },
]

const SHOTS_LOCAL_NAME: readonly Shot[] = [{ name: 'local-name', steps: async (page) => void (await page.getByLabel(/Your name/).waitFor()) }]

const SHOTS_LOCAL: readonly Shot[] = [
  { name: 'local-review', steps: async (page) => void (await article(page).waitFor()) },
  { name: 'local-review-objection', steps: async (page) => (await article(page).waitFor(), await chooseRow(page, /bank-/)) },
  { name: 'local-review-objections', api: [rows(SEVERAL)], steps: async (page) => void (await article(page).waitFor()) },
  { name: 'local-review-account-menu', api: [rows(SEVERAL)], steps: async (page) => (await article(page).waitFor(), await openAccount(page)) },
  { name: 'local-review-title', api: [rows(TITLE)], steps: async (page) => void (await article(page).waitFor()) },
  {
    name: 'local-review-imported',
    api: [answer(/\/api\/import$/, { applied: 2, pending: 5, errors: [] })],
    steps: async (page) => {
      await article(page).waitFor()
      await page.getByRole('button', { name: 'Import decisions' }).click()
      await page.getByText(/Imported 2/).waitFor()
    },
  },
  { name: 'local-review-done', api: [rows(ALL_DECIDED)], steps: async (page) => void (await page.getByText('Nothing left to decide here.').waitFor()) },
]

// ---- taking them ----

const tokens = () => JSON.parse(readFileSync(join(root, '.e2e', 'tokens.json'), 'utf8')) as Record<Who, string>
const findings: string[] = []
let taken = 0

async function context(browser: Browser, who: Who | undefined, screen: (typeof SCREENS)[number], scheme: (typeof SCHEMES)[number]) {
  return browser.newContext({
    baseURL: who ? HOSTED : LOCAL,
    viewport: screen.viewport,
    deviceScaleFactor: screen.deviceScaleFactor,
    hasTouch: screen.hasTouch,
    colorScheme: scheme,
    ...(who ? { extraHTTPHeaders: { 'cf-access-jwt-assertion': tokens()[who] } } : {}),
  })
}

/** What sticks out of the screen to the right, and how many main (rose) actions are on offer: on the dialog when
 * one is open, else on the page. */
// A string, not a function: tsx gives a function's inner functions names with a helper the page does not have.
const MEASURE = `(() => {
  const width = document.documentElement.clientWidth
  const seen = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const dialog = document.querySelector('dialog[open]')
  const main = [...(dialog ?? document).querySelectorAll('.button.primary')].filter(seen)
  const text = (el) => (el.textContent ?? '').trim()
  return {
    wide: document.documentElement.scrollWidth > width,
    long: !dialog && document.documentElement.scrollHeight > window.innerHeight + 1,
    // the admin tabs slide inside their own strip
    out: [...document.querySelectorAll('body *')].filter((el) => seen(el) && !el.closest('.admin-tabs') && el.getBoundingClientRect().right > width + 0.5).map((el) => el.tagName.toLowerCase() + '.' + String(el.className)),
    header: main.filter((el) => el.closest('.app-header')).map(text),
    page: main.filter((el) => !el.closest('.app-header')).map(text),
  }
})()`

/** What sticks out of the screen to the right, whether the page is longer than the screen, and the main (rose)
 * actions on offer, in the header and below it: on the dialog when one is open, else on the page. */
const measure = (page: Page) => page.evaluate<{ wide: boolean; long: boolean; out: string[]; header: string[]; page: string[] }>(MEASURE)

async function take(browser: Browser, shots: readonly Shot[]): Promise<void> {
  for (const shot of shots) {
    for (const screen of SCREENS) {
      for (const scheme of SCHEMES) {
        const file = `${shot.name}-${screen.id}-${scheme}.png`
        const ctx = await context(browser, shot.who, screen, scheme)
        const page = await ctx.newPage()
        try {
          for (const api of shot.api ?? []) await api(page)
          await page.goto(shot.path ?? '/')
          await shot.steps(page)
          await page.evaluate('document.fonts.ready')
          // From the top of the page (getting here may have scrolled it), the pointer resting on nothing.
          await page.evaluate('window.scrollTo(0, 0)')
          if (!screen.hasTouch) await page.mouse.move(0, 0)
          const m = await measure(page)
          if (m.wide) findings.push(`${file}: the page scrolls sideways`)
          if (m.out.length > 0) findings.push(`${file}: wider than the screen: ${[...new Set(m.out)].join(', ')}`)
          // One main action in the header (Submit, Import) and one below it (the decision) is the design; two in
          // one place is not.
          for (const [where, main] of [['header', m.header], ['page', m.page]] as const) if (main.length > 1) findings.push(`${file}: ${main.length} main actions in the ${where}: ${main.join(' | ')}`)
          await page.screenshot({ path: join(out, file) })
          if (m.long) await page.screenshot({ path: join(out, 'full', file), fullPage: true })
          taken += 1
        } catch (err) {
          findings.push(`${file}: not taken: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`)
          await page.screenshot({ path: join(out, file) }).catch(() => undefined)
        } finally {
          await ctx.close()
        }
      }
    }
  }
}

/** Does something as one of the fixture's people, on a desktop screen: what the next screenshots start from. */
async function act(browser: Browser, who: Who | undefined, steps: (page: Page) => Promise<void>): Promise<void> {
  const ctx = await context(browser, who, SCREENS[0], 'light')
  try {
    const page = await ctx.newPage()
    await page.goto('/')
    await steps(page)
  } finally {
    await ctx.close()
  }
}

/** Keeps the row on the screen (key 2) and waits for the next one, or for the end. */
async function keep(page: Page): Promise<void> {
  const row = await article(page).getAttribute('aria-label')
  await page.keyboard.press('2')
  await page.waitForFunction((was) => document.querySelector('article')?.getAttribute('aria-label') !== was, row)
  await article(page).getByRole('button', { name: /Keep/ }).and(page.locator(':enabled')).or(page.getByText('Nothing left to decide here.')).waitFor()
}

async function main(): Promise<void> {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'full'), { recursive: true })
  start('e2e/hosted/start.ts')
  start('e2e/start.ts')
  await Promise.all([up(`${HOSTED}/`, 180), up(`${LOCAL}/api/queues`, 120)])
  const browser = await chromium.launch()
  try {
    await take(browser, SHOTS_BEFORE)
    await act(browser, 'reviewer', async (page) => (await openAssignment(page), await keep(page), await keep(page)))
    await take(browser, SHOTS_DECIDED)
    await act(browser, 'reviewer', async (page) => (await openAssignment(page), await keep(page)))
    await take(browser, SHOTS_DONE)
    // A pull request for the Submissions tab, a reviewer whose invite was not sent, a closed assignment.
    await act(browser, 'reviewer', async (page) => {
      await openAssignment(page)
      await page.getByRole('button', { name: /Submit 3 decisions/ }).click()
      await page.getByRole('link', { name: /pull request/ }).waitFor()
    })
    await act(browser, 'admin', async (page) => {
      await page.goto('/#reviewers')
      await openDialog(page, 'Invite a reviewer', 'Invite a reviewer')
      const invite = page.getByRole('form', { name: 'Invite a reviewer' })
      await invite.getByLabel('Email').fill('nora@example.com')
      await invite.getByLabel('Name').fill('Nora')
      await invite.getByLabel('Spanish').check()
      await invite.getByRole('button', { name: 'Invite' }).click()
      await page.getByText('nora@example.com', { exact: true }).waitFor()
    })
    await take(browser, SHOTS_ADMIN)

    await take(browser, SHOTS_LOCAL_NAME)
    await act(browser, undefined, async (page) => {
      await page.getByLabel(/Your name/).fill('Tester')
      await page.getByRole('button', { name: 'Start' }).click()
      await article(page).waitFor()
    })
    await take(browser, SHOTS_LOCAL)
  } finally {
    await browser.close()
    stopServers()
  }
  console.log(`${taken} screenshots in ${out}`)
  if (findings.length > 0) console.log(`To look at:\n${findings.map((f) => `  ${f}`).join('\n')}`)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => (stopServers(), process.exit(1)))
await main().catch((err: unknown) => {
  stopServers()
  console.error(err)
  process.exitCode = 1
})
