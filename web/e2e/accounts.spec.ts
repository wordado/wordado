import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { WORKER_LOG } from './accounts.setup'
import { expectAccessible, heading, studyNew } from './helpers'

let clientIp = 0
// The second octet, one per run: Better Auth's own per-IP-and-path rate limit (window 60s,
// e.g. /email-otp/send-verification-otp) lives in Postgres, not this run's memory, and a
// position-only address (10.77.0.N) is identical run to run — a second run started within
// that 60s window inherits the first run's count on the same key and can be refused (fix
// round 1, deviation #3: the brief's `context` reused addresses across runs; each run now
// gets its own octet, so "run it a second time" — spec's own requirement — cannot collide).
const RUN = Math.floor(Math.random() * 250)

/** A context in English, with its own client address: Better Auth limits code requests per address (plan 5). */
async function context(browser: Browser): Promise<BrowserContext> {
  clientIp += 1
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'cf-connecting-ip': `10.${RUN}.${Math.floor(clientIp / 250)}.${(clientIp % 250) + 1}` })
  await ctx.addInitScript(() => {
    if (localStorage.getItem('wordado.locale') === null) localStorage.setItem('wordado.locale', 'en')
  })
  return ctx
}

const address = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`

// How many codes each address has already been read for: a resend, or a second
// account sharing the same email (the "existing account" scenario), sends more
// than one code to the same address, and a fresh read must wait for the next
// one rather than return an already-consumed match straight off the log (fix
// round 1, deviation #1 — the brief's `codeFor` could return a stale code the
// instant a later request's line had not yet been flushed to the log).
const codesRead = new Map<string, number>()

/** The code the Worker printed for `email`, the newest one (plan 5's console mailer). */
async function codeFor(email: string): Promise<string> {
  const already = codesRead.get(email) ?? 0
  const pattern = new RegExp(`Sign-in code for ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (\\d{6})`, 'g')
  const deadline = Date.now() + 15_000
  for (;;) {
    const matches = [...readFileSync(WORKER_LOG, 'utf8').matchAll(pattern)]
    if (matches.length > already) {
      codesRead.set(email, matches.length)
      return matches.at(-1)![1]!
    }
    if (Date.now() > deadline) throw new Error(`No sign-in code for ${email} in ${WORKER_LOG}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** What the page saw around the age gate's Continue click; kept on `window` between evaluations. */
interface GateTrace {
  readonly events: string[]
  readonly form: HTMLFormElement | null
}

/**
 * Clicks Continue on the age gate, recording what reached the page. In Firefox on CI the click
 * has twice done nothing: no step change, no error, focus left on the year. When that happens
 * the test now fails at once with the events the page saw, instead of timing out without a clue.
 * The gate's submit handler calls preventDefault, so a submit reaching the window already
 * prevented means the handler ran. Test-only: the app is unchanged.
 */
async function continuePastGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const started = performance.now()
    const trace: GateTrace = { events: [], form: document.querySelector('form') }
    const name = (target: EventTarget | null) =>
      target instanceof Element ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${target.tagName === 'BUTTON' ? ` "${target.textContent?.trim()}"` : ''}` : String(target)
    const note = (line: string) => trace.events.push(`${Math.round(performance.now() - started)}ms ${line}`)
    for (const type of ['pointerdown', 'mousedown', 'focusin', 'mouseup', 'click', 'submit']) {
      document.addEventListener(type, (event) => note(`${type} on ${name(event.target)}`), true)
    }
    window.addEventListener('submit', (event) => note(`submit reached the window${event.defaultPrevented ? ', prevented: the handler ran' : ', not prevented: no handler ran'}`))
    ;(window as unknown as { __gateTrace: GateTrace }).__gateTrace = trace
  })
  await page.getByRole('button', { name: 'Continue' }).click()
  try {
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10_000 })
  } catch (err) {
    const seen = await page.evaluate(() => {
      const trace = (window as unknown as { __gateTrace: GateTrace }).__gateTrace
      const focused = document.activeElement
      return {
        events: trace.events,
        formStillInPage: trace.form?.isConnected ?? null,
        formsNow: document.querySelectorAll('form').length,
        focused: focused ? `${focused.tagName.toLowerCase()}${focused.id ? `#${focused.id}` : ''}` : null,
        heading: document.querySelector('h1')?.textContent ?? null,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent),
        url: location.href,
      }
    })
    const report = JSON.stringify(seen, null, 2)
    console.log(`Continue on the age gate did nothing:\n${report}`)
    await test.info().attach('age-gate-continue', { body: report, contentType: 'application/json' })
    throw err
  }
}

/** Through the age gate and an emailed code, as a learner would (spec §8.6, §11). */
async function signIn(page: Page, email: string, gate: { country?: string; year?: number } = {}): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('Country where you live').selectOption(gate.country ?? 'BG')
  await page.getByLabel('Year of birth').fill(String(gate.year ?? 1990))
  await continuePastGate(page)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
}

const synced = (page: Page) => expect(page.getByText('All progress saved to your account')).toBeVisible({ timeout: 15_000 })

async function exported(page: Page): Promise<{ reviewEvents: { wordId: string; deviceId: string }[]; documents: { type: string; fields: Record<string, unknown> }[] }> {
  const response = await page.request.get('/v1/export')
  expect(response.status()).toBe(200)
  return response.json()
}

test('carries the demo into a new account, from the demo’s own device, and syncs it (spec §8.6)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  await page.goto('/')
  await studyNew(page, 2)
  const email = address('carry')
  await signIn(page, email)
  await expect(page.getByText('Your account is ready, and the words you studied in the demo are in it.')).toBeVisible()
  await synced(page)
  const carried = (await exported(page)).reviewEvents
  expect(carried).toHaveLength(2)
  // Both answers came from one device, the demo's, and the learner's own file is another.
  expect(new Set(carried.map((e) => e.deviceId)).size).toBe(1)
  await page.reload()
  await page.goto('/settings')
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await ctx.close()
})

test('studies offline, then syncs on reconnecting (spec §13)', async ({ browser, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright’s WebKit fails page.goto while offline ("WebKit encountered an internal error"); Safari offline is on the release checklist (docs/deploy.md)')
  const ctx = await context(browser)
  const page = await ctx.newPage()
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await signIn(page, address('offline'))
  await ctx.setOffline(true)
  await studyNew(page, 1)
  await page.goto('/')
  await expect(page.getByText('Offline: 1 answer syncs when you are back online')).toBeVisible()
  await ctx.setOffline(false)
  await synced(page)
  expect((await exported(page)).reviewEvents).toHaveLength(1)
  await ctx.close()
})

test('turns away a learner below their country’s age, before any code is sent (spec §11)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  await page.goto('/signin')
  await page.getByLabel('Country where you live').selectOption('DE')
  await page.getByLabel('Year of birth').fill(String(new Date().getFullYear() - 15))
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(heading(page)).toHaveText('Sorry, you can’t create an account yet')
  await expect(page.getByLabel('Email')).toHaveCount(0)
  await ctx.close()
})

test('deletes the demo when signing in to an account that has progress, and merges nothing (spec §8.6)', async ({ browser }) => {
  const email = address('existing')
  const first = await context(browser)
  const a = await first.newPage()
  await signIn(a, email)
  await studyNew(a, 1)
  await a.goto('/')
  await synced(a)

  const second = await context(browser)
  const b = await second.newPage()
  await b.goto('/')
  await studyNew(b, 3)
  await b.goto('/signin')
  await b.getByLabel('Year of birth').fill('1990')
  await b.getByRole('button', { name: 'Continue' }).click()
  await expect(b.getByText(/the words you studied in the demo are deleted/)).toBeVisible()
  await signIn(b, email)
  await expect(b.getByText(/This email already had an account, so the demo was deleted/)).toBeVisible()
  await synced(b)
  expect((await exported(b)).reviewEvents).toHaveLength(1)
  await first.close()
  await second.close()
})

test('settings follow the learner to another device (spec §9.2)', async ({ browser }) => {
  const email = address('settings')
  const first = await context(browser)
  const a = await first.newPage()
  await signIn(a, email)
  await a.goto('/settings')
  await a.getByLabel('New words a day').fill('5')
  await a.getByLabel('New words a day').press('Enter')
  // Not .uncheck(): the checkbox is controlled by the client's own settings snapshot, which
  // only flips after the save round-trips through client-data (a few tens of ms), so a plain
  // click's native toggle is briefly reverted by React before Playwright's own post-click check
  // reads it — .uncheck() checks once, right away, and fails on that revert (fix round 1, #2:
  // the app is not wrong, `settings.latencyGrading` binds every other checkbox in Settings the
  // same way; the assertion below polls instead of checking once).
  await a.getByRole('checkbox', { name: 'Count slow answers as “hard”' }).click()
  await expect(a.getByRole('checkbox', { name: 'Count slow answers as “hard”' })).not.toBeChecked()
  await a.goto('/')
  await synced(a)

  const second = await context(browser)
  const b = await second.newPage()
  await signIn(b, email)
  await synced(b)
  await expect(heading(b)).toHaveText('5 new words')
  await b.goto('/settings')
  await expect(b.getByRole('checkbox', { name: 'Count slow answers as “hard”' })).not.toBeChecked()
  await first.close()
  await second.close()
})

test('signs out leaving nothing behind, then deletes the account (spec §11)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  const email = address('leave')
  await signIn(page, email)
  await studyNew(page, 1)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('You are signed out. Nothing of your account is left on this device.')).toBeVisible()
  await expect(heading(page)).toHaveText('10 new words')

  await signIn(page, email)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Delete your account' }).click()
  await page.getByRole('checkbox', { name: 'I understand that my progress is deleted for good' }).check()
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page.getByText('Your account and everything in it has been deleted.')).toBeVisible()
  expect((await page.request.get('/v1/me')).status()).toBe(401)
  await ctx.close()
})

test('meets WCAG 2.2 A and AA on the account screens, light and dark (spec §11.1)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  const email = address('a11y')
  await page.goto('/signin')
  await expectAccessible(page, { dark: true })
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Year of birth').fill('1990')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await expect(page.getByLabel('Code')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  await expectAccessible(page, { dark: true })
  await page.goto('/settings')
  await expectAccessible(page, { dark: true })
  await page.getByRole('button', { name: 'Delete your account' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.keyboard.press('Escape')
  await page.goto('/path')
  await page.locator('details.unit-words').first().evaluate((d) => ((d as HTMLDetailsElement).open = true))
  await expectAccessible(page, { dark: true })
  await ctx.close()
})

test('brings a learner’s progress back after the browser’s storage was cleared (spec §13)', async ({ browser }) => {
  const email = address('cleared')
  const first = await context(browser)
  const page = await first.newPage()
  await signIn(page, email)
  await studyNew(page, 3)
  await page.goto('/')
  await synced(page)
  await first.close()

  // A new context is a browser with nothing kept: no database, no account record, no cookie.
  const cleared = await context(browser)
  const again = await cleared.newPage()
  await again.goto('/')
  await expect(heading(again)).toHaveText('10 new words')
  await signIn(again, email)
  await expect(heading(again)).toHaveText('7 new words', { timeout: 15_000 })
  await again.goto('/path')
  await expect(again.getByText('3 of 20 started')).toBeVisible()
  await cleared.close()
})
