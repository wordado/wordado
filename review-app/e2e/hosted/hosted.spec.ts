import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

const tokens = () => JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '.e2e', 'tokens.json'), 'utf8')) as { admin: string; reviewer: string; phone: string; hans: string }
/** A page signed in as one of the fixture's people, with the running project's screen (a context made by hand does not get it by itself). */
const as = async (browser: Browser, who: 'admin' | 'reviewer' | 'phone' | 'hans') => {
  const { viewport, hasTouch } = test.info().project.use
  return (await browser.newContext({ extraHTTPHeaders: { 'cf-access-jwt-assertion': tokens()[who] }, ...(viewport ? { viewport } : {}), ...(hasTouch ? { hasTouch } : {}) })).newPage()
}

/** Nothing is wider than the screen: the page does not scroll sideways, and no part of the row or the header (or of
 * what `selector` names) sticks out. */
async function expectFits(page: Page, selector = 'header *, article *, dialog[open] *') {
  const sizes = await page.evaluate((sel) => {
    const width = document.documentElement.clientWidth
    const out = [...document.querySelectorAll(sel)]
      .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > width + 0.5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
    return { scrollWidth: document.documentElement.scrollWidth, width, out }
  }, selector)
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width)
  expect(sizes.out).toEqual([])
}

/** One finger across the screen at height `y`: the pointer events a touch gives the page, sent to what lies under
 * its start. Sent from inside the page rather than as browser input (CDP touch events): after synthetic touch
 * swipes, Chromium on Linux stops turning later taps into clicks, which broke the taps that follow on the CI
 * runner; the browser's own part in a swipe (touch-action, overscroll) is not what this run is about. */
async function swipe(page: Page, fromX: number, toX: number, y: number) {
  await page.evaluate(
    ({ fromX, toX, y }) => {
      const target = document.elementFromPoint(fromX, y)!
      const at = (type: string, x: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }))
      at('pointerdown', fromX)
      for (let i = 1; i <= 5; i += 1) at('pointermove', fromX + ((toX - fromX) * i) / 5)
      at('pointerup', toX)
    },
    { fromX, toX, y },
  )
}

test('@phone a reviewer decides a row with the bottom buttons, swipes and opens the row list', async ({ browser }) => {
  const page = await as(browser, 'phone')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your assignments' })).toBeVisible()
  await expect(page.getByText('English levels · all rows')).toBeVisible()
  await expectFits(page)
  await page.getByRole('button', { name: 'Start' }).tap()
  const article = page.getByRole('article')
  const place = page.locator('.progress-line')
  await expect(place).toContainText(/^1 of \d+/)
  const total = Number(/of (\d+)/.exec(await place.innerText())![1])
  expect(total).toBeGreaterThan(1)
  await expectFits(page)
  // The header keeps the row list, Submit and the account, on one line; what is reviewed has gone into the row list.
  const banner = page.getByRole('banner')
  await expect(banner.getByText('English levels · all rows')).toBeHidden()
  await expect(page.getByRole('button', { name: /Submit 0 decisions/ })).toBeVisible()
  const account = banner.getByRole('button', { name: 'Account: Petra' })
  await expect(account).toHaveText('P')
  const tops = await Promise.all([banner.getByRole('button', { name: 'All rows' }), page.getByRole('button', { name: /Submit 0 decisions/ }), account].map(async (b) => { const box = (await b.boundingBox())!; return box.y + box.height / 2 }))
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1)
  // The account menu stays inside the screen; a tap outside closes it.
  await account.tap()
  const menu = page.getByRole('group', { name: 'Account' })
  await expect(menu.getByText('phone@example.com')).toBeVisible()
  const menuBox = (await menu.boundingBox())!
  expect(menuBox.x).toBeGreaterThanOrEqual(0)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390)
  await expectFits(page)
  await page.locator('.wordmark').tap()
  await expect(menu).toBeHidden()

  // A swipe to the left goes to the next row, one to the right comes back.
  const first = await article.getAttribute('aria-label')
  await swipe(page, 320, 120, 260)
  await expect(place).toContainText(/^2 of/)
  await swipe(page, 80, 300, 260)
  await expect(article).toHaveAttribute('aria-label', first!)

  // Editing fills the screen; a swipe that starts on its input does nothing.
  await page.getByRole('button', { name: /Edit/ }).tap()
  const input = article.getByRole('textbox').first()
  await expect(input).toBeVisible()
  expect(await article.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  await expectFits(page)
  const box = (await input.boundingBox())!
  await swipe(page, box.x + box.width - 20, box.x + 20, box.y + box.height / 2)
  await expect(input).toBeVisible()
  await expect(article).toHaveAttribute('aria-label', first!)
  await page.getByRole('button', { name: /Cancel/ }).tap()

  // The decisions are a bar at the bottom of the screen, wherever the page is scrolled to.
  const keep = page.getByRole('button', { name: /Keep/ })
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(keep).toBeInViewport({ ratio: 1 })
  const keepBox = (await keep.boundingBox())!
  expect(keepBox.y).toBeGreaterThan(844 - 160)
  // …and the end of the card is not under it.
  const skipBox = (await page.getByRole('button', { name: /Skip/ }).boundingBox())!
  expect(skipBox.y + skipBox.height).toBeLessThanOrEqual((await page.locator('.decisions').boundingBox())!.y)
  await keep.tap()
  await expect(article).not.toHaveAttribute('aria-label', first!)

  // The row list is a sheet over the whole screen, with the way back.
  await page.getByRole('button', { name: 'All rows' }).tap()
  const sheet = page.getByRole('dialog', { name: 'All rows' })
  await expect(page.getByRole('list', { name: 'Rows' }).getByRole('button')).toHaveCount(total)
  await expect(page.getByText(`1 of ${total} decided`)).toBeVisible()
  expect(await sheet.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  await expect(sheet.getByText('English levels · all rows')).toBeVisible()
  await expectFits(page)
  await sheet.getByRole('button', { name: 'Back to my assignments' }).tap()
  await expect(page.getByText(`${total} rows · 1 decided`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
})

test('@phone long values wrap inside the card', async ({ browser }) => {
  const page = await as(browser, 'phone')
  // The fixture's values are short: the row that comes up gets a 60-character translation, five alternates and a long reason.
  await page.route('**/api/rows*', async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as { rows: Record<string, unknown>[] }
    const objection = { reviewer: 'flash', model: 'google/gemini-3.8-flash', field: 'translation', category: 'wrong-sense', severity: 'major' }
    const open = body.rows.findIndex((r) => !r['decided'])
    body.rows[open] = {
      ...body.rows[open],
      kind: 'translation',
      fields: ['translation', 'alternates', 'sense'],
      cells: { translation: 'Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenantrag', alternates: 'крайбрежие; речен бряг; бряг на река; крайречие; брегова ивица', sense: 'край на река, където водата среща сушата и хората сядат да гледат лодките' },
      context: { headword: 'counterrevolutionaries-and-then-some', pos: 'noun', level: 'A2', sense_en: 'edge of a river, where the water meets the land', example: 'We sat on the bank and watched the boats go by for a very long afternoon indeed.' },
      reports: '3 reports (translation): odd word, wrong word, very-long-unbroken-report-text-very-long-unbroken-report-text',
      otherSenses: [{ key: 'bank-1', translation: 'финансоваинституциякоятопазипаритенахората', sense_en: 'financial institution' }],
      objections: [
        { ...objection, reason: 'банка is the money sense; a river’s edge is бряг, and this reason goes on and on to see that it wraps inside the card without pushing anything out of the screen', fix: 'Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz' },
        { ...objection, field: 'sense', category: 'sense-unclear-and-a-long-category-name', severity: 'minor', reason: 'say which edge', fix: 'бряг на река' },
      ],
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /Start|Continue/ }).tap()
  await expect(page.getByText('Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenantrag')).toBeVisible()
  await expectFits(page)
  await page.getByRole('button', { name: /Edit/ }).tap()
  await expect(page.getByRole('textbox', { name: 'Translation' })).toBeVisible()
  await expectFits(page)
  await page.getByRole('button', { name: /Cancel/ }).tap()
  await page.getByRole('button', { name: 'All rows' }).tap()
  await expect(page.getByRole('list', { name: 'Rows' })).toBeVisible()
  await expectFits(page)
})

test('a reviewer decides rows with the keys and submits a pull request', async ({ browser }) => {
  const page = await as(browser, 'reviewer')
  await page.goto('/')
  // The assignment's row carries the queue's name; its button opens it.
  await page.getByTitle('translation-bg').getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('1 of 3', { exact: true })).toBeVisible()
  const first = await page.getByRole('article').getAttribute('aria-label')
  // The account: a round button with the initial; its menu has the name, the email and Sign out through Access.
  const account = page.getByRole('banner').getByRole('button', { name: 'Account: Rita' })
  await expect(account).toHaveText('R')
  await expect(page.getByRole('banner').getByText('Rita')).toHaveCount(0)
  await account.click()
  const menu = page.getByRole('group', { name: 'Account' })
  await expect(menu.getByText('Rita', { exact: true })).toBeVisible()
  await expect(menu.getByText('reviewer@example.com')).toBeVisible()
  const signOut = menu.getByRole('link', { name: 'Sign out' })
  await expect(signOut).toHaveAttribute('href', '/cdn-cgi/access/logout')
  await expect(account).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('menu')).toHaveCount(0)
  // It hangs under the button, their right edges together.
  const [buttonBox, menuBox] = [(await account.boundingBox())!, (await menu.boundingBox())!]
  expect(menuBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height)
  expect(Math.abs(menuBox.x + menuBox.width - (buttonBox.x + buttonBox.width))).toBeLessThan(1)
  // The review keys are off while it is open; Escape closes it and the focus is on the button again.
  await page.keyboard.press('2')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(account).toBeFocused()
  await expect(page.getByRole('article')).toHaveAttribute('aria-label', first!)
  // From the keyboard: Enter opens it, Tab goes to Sign out, Tab again leaves it and it closes.
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(signOut).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(menu).toBeHidden()
  await expect(account).not.toBeFocused()
  // A click outside closes it too.
  await account.click()
  await page.locator('.progress-line').click()
  await expect(menu).toBeHidden()
  await expect(account).toBeFocused()
  await page.keyboard.press('2')
  // The keys are off while a decision saves: wait for the next row to take them.
  await expect(page.getByRole('article')).not.toHaveAttribute('aria-label', first!)
  await expect(page.getByRole('button', { name: /Keep/ })).toBeEnabled()
  await page.keyboard.press('2')
  // The list, behind All rows, has the three rows and the two decisions.
  await page.getByRole('button', { name: 'All rows' }).click()
  const list = page.getByRole('list', { name: 'Rows' })
  await expect(list.getByRole('button')).toHaveCount(3)
  await expect(page.getByText('2 of 3 decided')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  // The focus goes back to where it was, not to the page: after Escape, and after choosing a row.
  await expect(page.getByRole('button', { name: 'All rows' })).toBeFocused()
  // (the browser says that it closed the dialog a frame later: only then is the row list gone, and Enter opens a new one)
  await expect(page.locator('dialog')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await list.locator('button[aria-current="true"]').click()
  await expect(page.locator('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
  await expect(page.getByRole('button', { name: 'All rows' })).toBeFocused()
  await page.getByRole('button', { name: /Submit 2 decisions/ }).click()
  await expect(page.getByRole('link', { name: /pull request 1/ })).toBeVisible()
  const state = (await (await fetch('http://127.0.0.1:4182/_state')).json()) as { pulls: { title: string }[] }
  expect(state.pulls[0]!.title).toBe('translation-bg: 2 decisions by Rita')
})

test('an admin invites a reviewer and assigns files; an overlap is refused', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin' }).click()
  // The admin page opens on the Overview; the tab is in the address.
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/#overview$/)
  await expect(page.getByRole('tabpanel', { name: 'Overview' }).getByText('rows to decide')).toBeVisible()

  await page.getByRole('tab', { name: 'Reviewers' }).click()
  await page.getByRole('button', { name: 'Invite a reviewer' }).click()
  // Escape closes the dialog and the focus is on the button that opened it again.
  await expect(page.getByRole('dialog', { name: 'Invite a reviewer' }).getByLabel('Email')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Invite a reviewer' })).toBeFocused()
  await page.keyboard.press('Enter')
  const invite = page.getByRole('dialog', { name: 'Invite a reviewer' }).getByRole('form', { name: 'Invite a reviewer' })
  await invite.getByLabel('Email').fill('new@example.com')
  await invite.getByLabel('Name').fill('Nora')
  await invite.getByLabel('Spanish').check()
  await invite.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByText('new@example.com', { exact: true })).toBeVisible()

  // The arrow keys move between the tabs.
  await page.getByRole('tab', { name: 'Reviewers' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Assignments' })).toBeFocused()
  await expect(page).toHaveURL(/#assignments$/)
  await page.getByRole('button', { name: 'Assign work' }).click()
  const dialog = page.getByRole('dialog', { name: 'Assign work' })
  const assign = dialog.getByRole('form', { name: 'Assign' })
  await assign.getByLabel('Reviewer').selectOption('hans@example.com')
  await assign.getByLabel('Queue').selectOption('translation-bg')
  await assign.getByLabel('All files').check()
  await assign.getByRole('button', { name: 'Assign' }).click()
  await expect(page.locator('p.notice')).toContainText(/already assigned to Rita/)
  // The page's notice is behind the dialog: the dialog stays open and says it too.
  await expect(dialog.getByRole('alert')).toContainText(/already assigned to Rita/)
  await expect(dialog.getByRole('alert')).toBeVisible()

  // Escape closes the dialog; a reload stays on the tab.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Assignments' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Bulgarian translations · flagged rows')).toBeVisible()
  await page.getByRole('button', { name: 'My work' }).click()
  await expect(page.getByRole('heading', { name: 'Your assignments' })).toBeVisible()
  await expect(page).not.toHaveURL(/#/)
})

// After the test above: its refusal names the assignment it meets first, and this one adds a spot check to the queue.
test('an admin makes a spot check; its reviewer says how serious each fault was; the admin reads the result', async ({ browser }) => {
  const admin = await as(browser, 'admin')
  await admin.goto('/#assignments')
  /** Fills the Spot check dialog and asks for the sample. */
  const draw = async (reviewer: string, queue: string, rows: string) => {
    await admin.getByRole('button', { name: 'Spot check' }).click()
    const form = admin.getByRole('dialog', { name: 'Spot check' }).getByRole('form', { name: 'Spot check' })
    await expect(form.getByLabel('Rows in the sample')).toHaveValue('50')
    await form.getByLabel('Reviewer').selectOption(reviewer)
    await form.getByLabel('Queue').selectOption(queue)
    await form.getByLabel('Rows in the sample').fill(rows)
    await form.getByRole('button', { name: 'Draw the sample' }).click()
  }
  const dialog = admin.getByRole('dialog', { name: 'Spot check' })
  // Rita has the flagged rows of the Bulgarian translations: a spot check stands beside that.
  await draw('hans@example.com', 'translation-bg', '4')
  await expect(dialog).toBeHidden()
  const spot = admin.getByRole('listitem').filter({ hasText: 'Bulgarian translations · spot check' })
  await expect(spot).toContainText('Hans · 4 in the sample · checked 0 · fine 0 · minor 0 · serious 0')
  // Not beside a second spot check of the queue, nor beside an assignment of every row (Petra has the levels).
  await draw('reviewer@example.com', 'translation-bg', '4')
  await expect(dialog.getByRole('alert')).toContainText('This queue already has an open spot check, with Hans')
  await admin.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await draw('reviewer@example.com', 'level', '2')
  await expect(dialog.getByRole('alert')).toContainText('Petra is assigned every row')
  await admin.keyboard.press('Escape')

  const page = await as(browser, 'hans')
  await page.goto('/')
  const mine = page.getByRole('listitem').filter({ hasText: 'Bulgarian translations · spot check' })
  await expect(mine).toContainText('4 rows · none decided yet')
  await expect(mine).toContainText('These rows passed the AI review. Keep what is right, change what is wrong.')
  await mine.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('1 of 4', { exact: true })).toBeVisible()
  await expect(page.getByRole('banner').getByText('Bulgarian translations · spot check')).toBeVisible()
  await expect(page.getByRole('main').getByText('Spot check. These rows passed the AI review.')).toBeVisible()
  const article = page.getByRole('article')
  const question = page.getByRole('group', { name: 'How serious was it?' })
  /** The keys are off while a decision saves: waits for the next row to take them. */
  const nextRow = async (after: string) => {
    await expect(article).not.toHaveAttribute('aria-label', after)
    await expect(page.getByRole('button', { name: /Keep/ })).toBeEnabled()
    return (await article.getAttribute('aria-label'))!
  }
  // The rows passed the AI review: there is no fix to accept.
  await expect(page.getByRole('button', { name: /Accept fix/ })).toBeDisabled()
  const first = (await article.getAttribute('aria-label'))!
  // Drop: the question, with what each answer means; Escape goes back, and nothing is decided.
  await page.keyboard.press('4')
  await expect(question).toBeVisible()
  await expect(question.getByRole('button', { name: /Serious/ })).toContainText('a learner would be taught something wrong, or marked wrong for a right answer')
  await expect(question.getByRole('button', { name: /Minor/ })).toContainText('right, but could be better')
  await page.keyboard.press('Escape')
  await expect(question).toBeHidden()
  await expect(article).toHaveAttribute('aria-label', first)
  await page.keyboard.press('4')
  await page.keyboard.press('1')
  const second = await nextRow(first)
  // Edit: Enter in the field saves, the question follows, and 2 is Minor.
  await page.keyboard.press('3')
  await article.getByRole('textbox', { name: 'Translation' }).fill('поправка')
  await page.keyboard.press('Enter')
  await expect(question).toBeVisible()
  await expect(article.getByRole('textbox', { name: 'Translation' })).toBeDisabled()
  await page.keyboard.press('2')
  const third = await nextRow(second)
  // Keep means the row is fine: no question.
  await page.keyboard.press('2')
  await nextRow(third)
  await expect(question).toBeHidden()
  // A decided row shows what it was rated.
  await page.getByRole('button', { name: 'All rows' }).click()
  await expect(page.getByText('3 of 4 decided')).toBeVisible()
  await page.getByRole('list', { name: 'Rows' }).getByRole('button', { name: first.replace(/^Row /, '') }).click()
  await expect(article).toHaveAttribute('aria-label', first)
  await expect(article.getByText('decided: drop')).toBeVisible()
  await expect(article.getByText('rated serious')).toBeVisible()
  await page.getByRole('button', { name: /Submit 3 decisions/ }).click()
  await expect(page.getByRole('link', { name: /pull request \d+/ })).toBeVisible()
  const state = (await (await fetch('http://127.0.0.1:4182/_state')).json()) as { pulls: { title: string }[] }
  expect(state.pulls.at(-1)!.title).toBe('translation-bg: 3 decisions by Hans')

  await admin.reload()
  await expect(spot).toContainText('Hans · 4 in the sample · checked 3 · fine 1 · minor 1 · serious 1')
  await expect(spot).toContainText(`Serious: ${first.replace(/^Row /, '')}`)
})

test('@phone an admin reads the Overview and moves between the tabs', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin' }).tap()
  const overview = page.getByRole('tabpanel', { name: 'Overview' })
  // The four numbers, two by two.
  const stats = overview.getByRole('list', { name: 'In numbers' }).getByRole('listitem')
  await expect(stats).toHaveCount(4)
  await expect(stats.nth(0)).toHaveText(/^[1-9][\d,]*\s*rows? to decide$/)
  await expect(stats.nth(1)).toHaveText(/^[\d,]+\s*decided, not submitted$/)
  await expect(stats.nth(2)).toHaveText(/^\d+\s*pull requests? open$/)
  await expect(stats.nth(3)).toHaveText(/^[1-9]\d*\s*active reviewers?$/)
  const [first, second, third] = await Promise.all([0, 1, 2].map(async (i) => (await stats.nth(i).boundingBox())!))
  expect(second!.y).toBe(first!.y)
  expect(second!.x).toBeGreaterThan(first!.x)
  expect(third!.y).toBeGreaterThan(first!.y)
  expect(third!.x).toBe(first!.x)
  // A row per language; Rita has the Bulgarian translations.
  const bulgarian = overview.getByRole('list', { name: 'By language' }).getByRole('listitem').filter({ hasText: 'Bulgarian' })
  await expect(bulgarian).toContainText('Rita')
  await expect(bulgarian.getByText('on track')).toBeVisible()
  await expect(overview.getByText(/Review data built .* from commit e2e0000/)).toBeVisible()
  // Nothing sticks out of the screen; the tabs slide inside their own strip.
  await expectFits(page, '.admin *')

  await page.getByRole('tab', { name: 'Reviewers' }).tap()
  const reviewers = page.getByRole('tabpanel', { name: 'Reviewers' })
  await expect(reviewers.getByText('reviewer@example.com', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#reviewers$/)
  await expectFits(page, '.admin *')
  // A form is the whole screen.
  await reviewers.getByRole('button', { name: 'Invite a reviewer' }).tap()
  const dialog = page.getByRole('dialog', { name: 'Invite a reviewer' })
  await expect(dialog.getByLabel('Email')).toBeVisible()
  expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  await expectFits(page, '.admin *, dialog[open] *')
  await dialog.getByRole('button', { name: 'Close' }).tap()
  await expect(dialog).toBeHidden()
  // The last tab is reached by sliding the strip; it comes into view when chosen.
  await page.getByRole('tab', { name: 'Submissions' }).tap()
  await expect(page.getByRole('tab', { name: 'Submissions' })).toBeInViewport({ ratio: 1 })
  await expectFits(page, '.admin *')
})

/** The Feedback tab, with the messages of one kind: the desktop run marks the bugs, the phone run the ideas. */
async function readsFeedback(browser: Browser, kind: 'Bug' | 'Idea', newest: string, older: string) {
  const page = await as(browser, 'admin')
  await page.goto('/#feedback')
  const panel = page.getByRole('tabpanel', { name: 'Feedback' })
  const items = panel.getByRole('list', { name: 'Feedback' }).getByRole('listitem')
  // Everything open, newest first: what the fake learner app server holds, read through the Worker with the token.
  await expect(items.first()).toContainText('Thank you for the app.')
  await panel.getByLabel('Kind').selectOption({ label: kind })
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText(newest)
  await expect(items.nth(1)).toContainText(older)
  await expect(items.nth(0).getByRole('heading', { level: 3 })).toContainText(kind)
  await expect(items.nth(0).getByText('not signed in')).toBeVisible()
  // The older one came with an address and an account: the address is text, and a link to write to it.
  const address = kind === 'Bug' ? 'learner@example.com' : 'ideas@example.com'
  await expect(items.nth(1).getByText(address, { exact: true })).toBeVisible()
  await expect(items.nth(1).getByRole('link', { name: 'Write a mail' })).toHaveAttribute('href', `mailto:${address}`)
  await expect(items.nth(1).getByText('signed in', { exact: true })).toBeVisible()
  // The technical details are folded away.
  await expect(items.nth(0).getByText('App version')).toBeHidden()
  await items.nth(0).getByText('Details').click()
  await expect(items.nth(0).getByText('App version')).toBeVisible()
  await expect(items.nth(0).getByText('Mozilla/5.0 (X11; Linux x86_64)')).toBeVisible()
  await expectFits(page, '.admin *')

  // Done saves as it is chosen; the note on Save note.
  await items.nth(0).getByLabel('State').selectOption({ label: 'Done' })
  await expect(items.nth(0).getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  const note = items.nth(1).getByLabel('Note')
  await note.fill('Asked for the browser and the unit.')
  await items.nth(1).getByRole('button', { name: 'Save note' }).click()
  await expect(items.nth(1).getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await expect(items.nth(1).getByRole('button', { name: 'Save note' })).toBeDisabled()
  await items.nth(1).getByLabel('State').selectOption({ label: 'Looked at' })
  await expect(items.nth(1).getByRole('status').filter({ hasText: 'Saved' })).toHaveCount(2)

  // The filters read the list again: Done has the one, Open the other, All both.
  const show = panel.getByLabel('Show')
  await show.selectOption({ label: 'Done' })
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText(newest)
  await show.selectOption({ label: 'Not doing' })
  await expect(panel.getByText('Nothing here to show.')).toBeVisible()
  await show.selectOption({ label: 'All' })
  await expect(items).toHaveCount(2)

  // A reload stays on the tab, and the marks are still there.
  await page.reload()
  await expect(page).toHaveURL(/#feedback$/)
  await expect(page.getByRole('tab', { name: 'Feedback' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Feedback' })).toBeInViewport({ ratio: 1 })
  await panel.getByLabel('Kind').selectOption({ label: kind })
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText(older)
  await expect(items.first().getByLabel('State')).toHaveValue('seen')
  await expect(items.first().getByLabel('Note')).toHaveValue('Asked for the browser and the unit.')
  await show.selectOption({ label: 'Done' })
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText(newest)
  await expect(items.first().getByLabel('State')).toHaveValue('done')
  await expectFits(page, '.admin *')
}

test('an admin reads the feedback, marks one message done, writes a note on another, filters, and finds the marks after a reload', async ({ browser }) => {
  await readsFeedback(browser, 'Bug', 'The sound of a word plays twice on my phone.', 'The path does not open after I finish a unit.')
})

test('@phone an admin reads and marks the feedback on a phone', async ({ browser }) => {
  await readsFeedback(browser, 'Idea', 'Let me choose how many new words a day.', 'A dark theme would be easier in the evening.')
})

test('the weekly job asks the learner app’s server once a week', async () => {
  const asked = async () => ((await (await fetch('http://127.0.0.1:4183/_state')).json()) as { requests: string[] }).requests.filter((r) => /^GET \/v1\/admin\/feedback\?limit=100&since=\d+$/.test(r))
  const before = (await asked()).length
  // Monday's cron line, fired by hand, since no cron fires locally: wrangler dev runs the Worker's `scheduled` for this
  // address. (Its other one, /__scheduled, is answered by the page here, as every address outside /api is.)
  const fire = async (cron: string) => expect(await (await fetch(`http://127.0.0.1:4181/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(cron)}`)).text()).toBe('ok')
  await fire('0 6 * * 1')
  expect(await asked()).toHaveLength(before + 1)
  // Tuesday's line, the same week: the week is taken, so nothing is asked.
  await fire('0 6 * * 2')
  expect(await asked()).toHaveLength(before + 1)
})
