import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { WORKER_LOG } from './accounts.setup'
import { expectAccessible, finishSetup, forwardConsole, heading, studyNew, today } from './helpers'

let clientIp = 0
// The second octet, one per run: Better Auth's own per-IP-and-path rate limit (window 60s,
// e.g. /email-otp/send-verification-otp) lives in Postgres, not this run's memory, and a
// position-only address (10.77.0.N) is identical run to run — a second run started within
// that 60s window inherits the first run's count on the same key and can be refused (fix
// round 1, deviation #3: the brief's `context` reused addresses across runs; each run now
// gets its own octet, so "run it a second time" — spec's own requirement — cannot collide).
const RUN = Math.floor(Math.random() * 250)

/** A context in English, with its own client address: Better Auth limits code requests per address (plan 5). */
async function context(browser: Browser, options: { readonly serviceWorkers?: 'allow' | 'block' } = {}): Promise<BrowserContext> {
  clientIp += 1
  const ctx = await browser.newContext(options)
  forwardConsole(ctx)
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
 * has twice done nothing: no step change, no error. When that happens
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
async function signIn(page: Page, email: string, gate: { country?: string } = {}): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('Country where you live').selectOption(gate.country ?? 'BG')
  await page.getByRole('checkbox', { name: /^I’m \d+ or older$/ }).check()
  await continuePastGate(page)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
}

/** The sync line lives in the account menu: open it (it stays open until the next navigation) and read it. */
async function syncLine(page: Page, text: string, timeout?: number): Promise<void> {
  const circle = page.getByRole('button', { name: /^Account: / })
  if ((await circle.getAttribute('aria-expanded')) !== 'true') await circle.click()
  await expect(page.getByText(text)).toBeVisible(timeout === undefined ? {} : { timeout })
}

const synced = (page: Page) => syncLine(page, 'All progress saved to your account', 15_000)

async function exported(page: Page): Promise<{ reviewEvents: { wordId: string; deviceId: string }[]; documents: { type: string; fields: Record<string, unknown> }[] }> {
  const response = await page.request.get('/v1/export')
  expect(response.status()).toBe(200)
  return response.json()
}

test('carries the demo into a new account, from the demo’s own device, and syncs it (spec §8.6)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  await page.goto('/')
  await finishSetup(page)
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
  await page.goto('/settings/account')
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
  await finishSetup(page)
  await ctx.setOffline(true)
  await studyNew(page, 1)
  await page.goto('/')
  await syncLine(page, 'Offline: 1 answer syncs when you are back online')
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
  await page.getByRole('button', { name: 'I’m younger than 16' }).click()
  await expect(heading(page)).toHaveText('Sorry, you can’t create an account yet')
  await expect(page.getByLabel('Email')).toHaveCount(0)
  await ctx.close()
})

test('deletes the demo when signing in to an account that has progress, and merges nothing (spec §8.6)', async ({ browser }) => {
  const email = address('existing')
  const first = await context(browser)
  const a = await first.newPage()
  await signIn(a, email)
  await finishSetup(a)
  await studyNew(a, 1)
  await a.goto('/')
  await synced(a)

  const second = await context(browser)
  const b = await second.newPage()
  await b.goto('/')
  await finishSetup(b)
  await studyNew(b, 3)
  await b.goto('/signin')
  await b.getByRole('checkbox', { name: /^I’m \d+ or older$/ }).check()
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
  await finishSetup(a)
  await a.goto('/settings/study')
  await a.getByLabel('New words a day', { exact: true }).fill('5')
  await a.getByLabel('New words a day', { exact: true }).press('Enter')
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
  await b.goto('/settings/study')
  await expect(b.getByRole('checkbox', { name: 'Count slow answers as “hard”' })).not.toBeChecked()
  await first.close()
  await second.close()
})

test('signs out leaving nothing behind, then deletes the account (spec §11)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  const email = address('leave')
  await signIn(page, email)
  await finishSetup(page)
  await studyNew(page, 1)
  // The end of a session is in focus mode: back to Today, where the masthead is.
  await page.getByRole('link', { name: 'Back to today' }).click()
  await page.getByRole('button', { name: `Account: ${email}` }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('You are signed out. Nothing of your account is left on this device.')).toBeVisible()
  // What is left is a new demo, which opens in the setup (plan 11), under the notice.
  await expect(heading(page)).toHaveText('Set up Wordado')

  await signIn(page, email)
  await page.goto('/settings/account')
  await page.getByRole('button', { name: 'Delete your account' }).click()
  await page.getByRole('checkbox', { name: 'I understand that my progress is deleted for good' }).check()
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page.getByText('Your account and everything in it has been deleted.')).toBeVisible()
  expect((await page.request.get('/v1/me')).status()).toBe(401)
  await ctx.close()
})

test('sends feedback from the account menu; the export names neither it nor a country (spec §8.12, §11, #166)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  const email = address('feedback')
  await signIn(page, email)
  await finishSetup(page)
  await page.goto('/path')
  await page.getByRole('button', { name: /^Account: / }).click()
  await page.getByRole('link', { name: 'Feedback', exact: true }).click()
  await expect(heading(page)).toHaveText('Send feedback')
  await expectAccessible(page, { dark: true })
  // The address is never filled in for the learner.
  await expect(page.getByLabel('Email, if you’d like an answer (optional)')).toHaveValue('')
  await page.getByLabel('Your message', { exact: true }).fill('The path does not open.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.feedback-form [role="status"]')).toHaveText('Thank you! We’ve got your message.')
  // Feedback names no account, so no export can hold it; the age gate's country never left this device.
  const data = (await exported(page)) as unknown as { account: Record<string, unknown> }
  expect(data).not.toHaveProperty('feedback')
  expect(data.account).not.toHaveProperty('country')
  expect(data.account).toMatchObject({ email })
  await ctx.close()
})

test('meets WCAG 2.2 A and AA on the account screens, light and dark (spec §11.1)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  const email = address('a11y')
  await page.goto('/signin')
  await expectAccessible(page, { dark: true })
  await page.getByRole('checkbox', { name: /^I’m \d+ or older$/ }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await expect(page.getByLabel('Code')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  // A new account opens in the setup.
  await expect(page.getByRole('heading', { name: 'Which language do you speak?' })).toBeVisible()
  await expectAccessible(page, { dark: true })
  await finishSetup(page)
  await expectAccessible(page, { dark: true })
  await page.goto('/settings')
  await expectAccessible(page, { dark: true })
  await page.goto('/settings/account')
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
  await finishSetup(page)
  await studyNew(page, 3)
  await page.goto('/')
  await synced(page)
  await first.close()

  // A new context is a browser with nothing kept: no database, no account record, no cookie.
  const cleared = await context(browser)
  const again = await cleared.newPage()
  await again.goto('/')
  // A browser with nothing kept is a new demo: it opens in the setup, and its Sign in link is the way back.
  await expect(heading(again)).toHaveText('Set up Wordado')
  await signIn(again, email)
  await expect(again.getByRole('heading', { name: 'Set up Wordado' })).toHaveCount(0)
  await expect(heading(again)).toHaveText('7 new words', { timeout: 15_000 })
  await again.goto('/path')
  await expect(again.getByText('3 of 20 started')).toBeVisible()
  await cleared.close()
})

// Plan 11: a new account opens in the first-run setup; a returning one does not.

test('a new account opens in the setup, downloads its words with progress, and ends on Home (plan 11)', async ({ browser }) => {
  // No service worker, so the pack request reaches the network, where this test holds it.
  const ctx = await context(browser, { serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await signIn(page, address('setup'))
  await expect(heading(page)).toHaveText('Set up Wordado')
  // Signing in is a navigation; in the setup, the step's heading takes focus, as each step's does (App.tsx).
  await expect(page.getByRole('heading', { name: 'Which language do you speak?' })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Which language do you speak?' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Български' })).toBeChecked()

  // Record every state the progress bar takes: the pack is small, so it fills almost at once.
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __bars: string[] }).__bars = seen
    new MutationObserver(() => {
      for (const bar of document.querySelectorAll('[role="progressbar"]')) {
        seen.push(`${bar.getAttribute('aria-label')} ${bar.getAttribute('aria-valuenow')}/${bar.getAttribute('aria-valuemax')}`)
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true })
  })
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/content/sample/corpus-v0-bg.pack', async (route) => {
    await held
    await route.continue()
  })
  await page.getByRole('button', { name: 'Continue' }).click()
  // While the words download, the step says so, and its choices and Continue wait.
  await expect(page.getByRole('status').filter({ hasText: 'Getting your words ready' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
  release()

  await expect(page.getByRole('heading', { name: 'What do you want English for?' })).toBeFocused()
  const bars = await page.evaluate(() => (window as unknown as { __bars: string[] }).__bars)
  expect(bars.length).toBeGreaterThan(0)
  // Until the pack's size is known the bar is busy (no value); from then on it counts, and never goes back.
  const busy = 'Getting your words ready null/null'
  const counting = bars.slice(bars.findIndex((bar) => bar !== busy))
  expect(counting.length).toBeGreaterThan(0)
  for (const bar of counting) expect(bar).toMatch(/^Getting your words ready \d+\/[1-9]\d*$/)
  expect(bars.at(-1)).toMatch(/^Getting your words ready (\d+)\/\1$/)

  await page.getByRole('button', { name: 'Start studying' }).click()
  await expect(today(page)).toHaveText('10 new words')
  await ctx.close()
})

test('a returning account signing in on a fresh browser lands on Home, without the setup (plan 11)', async ({ browser }) => {
  const email = address('returning')
  const first = await context(browser)
  const a = await first.newPage()
  await signIn(a, email)
  await finishSetup(a, 'Deutsch')
  // A settings change waits for the next sync (at start, on hiding the page, or every five minutes:
  // web/src/app/syncLoop.ts), as the settings test above has it: a reload is the start of one. Then the
  // native language the setup wrote is in the account's settings document.
  await a.goto('/')
  await synced(a)
  await expect
    .poll(
      async () => {
        // No throwing `expect` in here (as `exported` has): a throw ends the poll at once instead of retrying it.
        const response = await a.request.get('/v1/export')
        if (response.status() !== 200) return false
        const { documents } = (await response.json()) as { documents: { fields: Record<string, unknown> }[] }
        return documents.some((d) => d.fields['l1'] === 'de')
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  await first.close()

  const fresh = await context(browser)
  const b = await fresh.newPage()
  await signIn(b, email)
  await expect(today(b)).toHaveText('10 new words', { timeout: 15_000 })
  await expect(b.getByRole('heading', { name: 'Set up Wordado' })).toHaveCount(0)
  // The account's native language came with it.
  await b.goto('/settings/languages')
  await expect(b.getByRole('region', { name: 'Native language' }).getByText('Deutsch', { exact: true })).toBeVisible()
  await fresh.close()
})
