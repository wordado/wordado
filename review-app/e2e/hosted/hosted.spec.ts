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
 * what `selector` names) sticks out. The admin tabs are left out, and the review's pages under them: on a phone each
 * row is a strip that slides sideways, and the tabs after the chosen one are meant to lie beyond its edge. */
async function expectFits(page: Page, selector = 'header *, article *, dialog[open] *') {
  const sizes = await page.evaluate((sel) => {
    const width = document.documentElement.clientWidth
    const out = [...document.querySelectorAll(sel)]
      .filter((el) => !el.closest('.admin-tabs, .sub-tabs') && el.getClientRects().length > 0 && el.getBoundingClientRect().right > width + 0.5)
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
  // An admin starts on the admin page, on Feedback; the page is in the address. The review's pages are under Review.
  await expect(page.getByRole('tab', { name: 'Feedback' })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/#feedback$/)
  await page.getByRole('tab', { name: 'Review' }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/#review\/overview$/)
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
  await expect(page).toHaveURL(/#review\/assignments$/)
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
  // The admin's own assignments are a page of the review too.
  await page.getByRole('tab', { name: 'My work' }).click()
  await expect(page.getByRole('heading', { name: 'Your assignments' })).toBeVisible()
  await expect(page).toHaveURL(/#review\/my-work$/)
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
  await page.getByRole('tab', { name: 'Review' }).tap()
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
  // Nothing sticks out of the screen; the tabs slide inside their own strips.
  await expectFits(page, '.admin *')

  await page.getByRole('tab', { name: 'Reviewers' }).tap()
  const reviewers = page.getByRole('tabpanel', { name: 'Reviewers' })
  await expect(reviewers.getByText('reviewer@example.com', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#review\/reviewers$/)
  await expectFits(page, '.admin *')
  // A form is the whole screen.
  await reviewers.getByRole('button', { name: 'Invite a reviewer' }).tap()
  const dialog = page.getByRole('dialog', { name: 'Invite a reviewer' })
  await expect(dialog.getByLabel('Email')).toBeVisible()
  expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  await expectFits(page, '.admin *, dialog[open] *')
  await dialog.getByRole('button', { name: 'Close' }).tap()
  await expect(dialog).toBeHidden()
  await page.getByRole('tab', { name: 'Submissions' }).tap()
  await expect(page.getByRole('tab', { name: 'Submissions' })).toBeInViewport({ ratio: 1 })
  await expectFits(page, '.admin *')
  // The admin's own assignments, in the admin page's column. The last tab is reached by sliding the strip; it comes
  // into view when chosen.
  await page.getByRole('tab', { name: 'My work' }).tap()
  await expect(page.getByRole('tab', { name: 'My work' })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('heading', { name: 'Your assignments' })).toBeVisible()
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

/** The Feedback tab with the AI help on, read by a stand-in model. The desktop and the phone run share the switch
 * and the results that are kept, so this only does what is safe to do twice: it switches on, and never off; it
 * marks nothing, and forgets nothing. (Switching off, Forget, the limit and the failures are the Worker's and the
 * page's own tests.) */
async function readsAiFeedback(browser: Browser) {
  const page = await as(browser, 'admin')
  await page.goto('/#feedback')
  const panel = page.getByRole('tabpanel', { name: 'Feedback' })
  const ai = panel.getByRole('region', { name: 'AI help' })
  const toggle = ai.getByRole('switch', { name: 'AI help' })
  // The switch, and beside it, while it is off, what must be true before it is switched on for real. (The other
  // browser project may have switched it on already.)
  await expect(toggle).toBeEnabled()
  const note = ai.getByText(/the privacy policy must name the AI service, and the transfer of the text to it must be covered/)
  if (!(await toggle.isChecked())) {
    await expect(note).toBeVisible()
    await toggle.click()
  }
  await expect(toggle).toBeChecked()
  await expect(note).toHaveCount(0)
  await expect(ai.getByText(/^On: .+ \d+ of 200 calls used today\.$/)).toBeVisible()

  await panel.getByLabel('Kind').selectOption({ label: 'Other' })
  const items = panel.getByRole('list', { name: 'Feedback' }).getByRole('listitem')
  // German: the learner's words as they wrote them, then the translation, named as the AI's, its reading and its summary.
  const german = items.filter({ hasText: 'Der Ton eines Wortes' })
  await expect(german.locator('.feedback-message')).toContainText('Der Ton eines Wortes wird auf meinem Handy zweimal abgespielt.')
  await expect(german.getByText('Translation by the AI')).toBeVisible()
  await expect(german.locator('.feedback-translation')).toContainText('The sound of a word is played twice on my phone.')
  await expect(german.getByText('AI: Bug')).toBeVisible()
  await expect(german.getByText('Annoys')).toBeVisible()
  await expect(german.getByText('AI summary: The sound of a word plays twice on a phone.')).toBeVisible()
  // The learner's own kind stays in the head.
  await expect(german.getByRole('heading', { level: 3 })).toContainText('Other')
  const spanish = items.filter({ hasText: 'Me gustaría elegir' })
  await expect(spanish.locator('.feedback-translation')).toHaveText('I would like to choose how many new words I learn each day.')
  await expect(spanish.getByText('AI: Idea')).toBeVisible()
  // Bulgarian is read as it is: a reading, and no translation.
  const bulgarian = items.filter({ hasText: 'Благодаря за приложението' })
  await expect(bulgarian.getByText('AI: Praise')).toBeVisible()
  await expect(bulgarian.getByText('Translation by the AI')).toHaveCount(0)
  // Under Open the advertisement is folded away under the list, and opens.
  await expect(items.filter({ hasText: 'Cheap watches' })).toHaveCount(0)
  const fold = panel.locator('details.feedback-junk')
  await expect(fold.getByText('Cheap watches')).toBeHidden()
  await fold.getByText('1 message the AI reads as junk').click()
  await expect(fold.getByText('Cheap watches and fast loans!!!')).toBeVisible()
  await expect(fold.getByText('AI: Junk')).toBeVisible()
  await expectFits(page, '.admin *')
  // Under All it is in the list like any other.
  await panel.getByLabel('Show').selectOption({ label: 'All' })
  await expect(items.filter({ hasText: 'Cheap watches' })).toHaveCount(1)
  await expect(fold).toHaveCount(0)
  await expectFits(page, '.admin *')

  // What the stand-in model was sent: no address for an answer, no address or link from a text, no browser, no version.
  const { requests, tokens } = (await (await fetch('http://127.0.0.1:4184/_state')).json()) as { requests: { url: string; authorization: string; body: unknown }[]; tokens: { url: string; signed: boolean; given: string | null }[] }
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every((r) => r.url === 'http://127.0.0.1:4184/chat/completions')).toBe(true)
  // The Worker signed in as a service account does: a JWT signed with the key file's key, changed for a token, and
  // the model asked with a token the stand-in gave. (The real Worker runtime signs here, not Node.)
  expect(tokens.length).toBeGreaterThan(0)
  expect(tokens.every((t) => t.url === 'http://127.0.0.1:4184/token' && t.signed && t.given !== null)).toBe(true)
  expect(requests.every((r) => tokens.some((t) => r.authorization === `Bearer ${t.given}`))).toBe(true)
  const sent = JSON.stringify(requests.map((r) => r.body))
  for (const theirs of ['answer-me@example.com', 'learner@example.com', 'ideas@example.com', 'lerner@example.com', 'example.com/offer', 'Mozilla', 'B3kq9xZa', 'bg 6', 'PRIVATE KEY', 'gserviceaccount']) expect(sent).not.toContain(theirs)
  expect(sent).toContain('[email]')
  expect(sent).toContain('[link]')

  // A reload: what the AI said is kept, and is there with the list itself.
  // (Asked for by itself: a response the page was waiting for when it reloads has no body left to read.)
  await page.reload()
  const first = (await (await page.request.get('/api/admin/feedback?kind=&state=all')).json()) as { items: { id: number; ai: { category: string } | null }[] }
  expect(first.items.find((item) => item.id === 9)?.ai?.category).toBe('bug')
  await expect(toggle).toBeChecked()
  await expect(items.filter({ hasText: 'Der Ton eines Wortes' }).locator('.feedback-translation')).toBeVisible()
  await expectFits(page, '.admin *')
}

test('an admin switches the AI help on and reads translations, the AI’s categories and summaries, with junk folded away', async ({ browser }) => {
  await readsAiFeedback(browser)
})

test('@phone an admin reads the feedback with the AI help on a phone', async ({ browser }) => {
  await readsAiFeedback(browser)
})

/** The Feedback tab by topic (spec 2026-10-10 §3.2, §3.3), with the stand-in model's topics. The desktop and the
 * phone run share the topics, so each changes only its own: the desktop one the topic about the sound, the phone
 * one the topic about the number of words; nobody changes the third. Merging, and Done marking a topic's messages,
 * would change what the other tests count: they are the Worker's and the page's own tests. */
async function readsTopics(browser: Browser, mine: 'sound' | 'words') {
  const page = await as(browser, 'admin')
  await page.goto('/#feedback')
  const panel = page.getByRole('tabpanel', { name: 'Feedback' })
  const toggle = panel.getByRole('region', { name: 'AI help' }).getByRole('switch', { name: 'AI help' })
  // Enabled once the page knows how the help stands: only then does the switch show whether it is on.
  await expect(toggle).toBeEnabled()
  if (!(await toggle.isChecked())) await toggle.click()
  await expect(toggle).toBeChecked()
  // Every message, read by the AI: the topics are made as it reads, so they are all there before anything is changed.
  await panel.getByLabel('Show').selectOption({ label: 'All' })
  const items = panel.getByRole('list', { name: 'Feedback' }).getByRole('listitem')
  await expect(items).toHaveCount(9)
  await expect(items.locator('.feedback-ai')).toHaveCount(9)
  // A card names its message's topic, and offers the others to move it to; the advertisement is in none.
  const path = items.filter({ hasText: 'The path does not open after I finish a unit.' })
  await expect(path.getByText('Topic: Path stays white after a unit')).toBeVisible()
  await expect(path.getByLabel('Move to…')).toBeVisible()
  await expect(items.filter({ hasText: 'Cheap watches' }).getByText('Topic: none')).toBeVisible()

  const byTopic = async () => {
    await panel.getByLabel('View').selectOption({ label: 'By topic' })
    await panel.getByLabel('Show').selectOption({ label: 'All' })
    await expect(panel.getByRole('list', { name: 'Feedback' })).toHaveCount(0)
  }
  await byTopic()
  const topics = panel.getByRole('list', { name: 'Topics', exact: true }).locator('> li')
  await expect(topics).toHaveCount(3)
  // The topic nobody changes: one message, the worst a bug can be, no match.
  const untouched = topics.filter({ hasText: 'Path stays white after a unit' })
  await expect(untouched.getByText('1 message', { exact: true })).toBeVisible()
  await expect(untouched.getByText('Blocks study')).toBeVisible()
  await expect(untouched.getByRole('link')).toHaveCount(0)
  await expectFits(page, '.admin *')

  if (mine === 'sound') {
    const topic = topics.filter({ hasText: '#94' })
    await expect(topic.getByRole('button', { name: 'Sound plays twice on phones' })).toHaveAttribute('aria-expanded', 'false')
    await expect(topic.getByText('2 messages', { exact: true })).toBeVisible()
    await expect(topic.getByText('Annoys')).toBeVisible()
    // The match the AI proposed is a link to the issue; the coordinator confirms it.
    const proposed = topic.getByRole('link', { name: 'looks like #94' })
    await expect(proposed).toHaveAttribute('href', 'https://github.com/wordado/wordado/issues/94')
    await expect(proposed).toHaveAttribute('title', 'The sound of a word plays twice on a phone')
    await topic.getByRole('button', { name: 'Confirm' }).click()
    await expect(topic.getByRole('link', { name: '#94', exact: true })).toHaveAttribute('href', 'https://github.com/wordado/wordado/issues/94')
    await expect(topic.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
    // Opened: both messages, the German one with its translation.
    await topic.getByRole('button', { name: 'Sound plays twice on phones' }).click()
    const messages = topic.getByRole('list', { name: 'Messages of the topic' }).getByRole('listitem')
    await expect(messages).toHaveCount(2)
    await expect(messages.nth(0).locator('.feedback-message')).toHaveText('The sound of a word plays twice on my phone.')
    await expect(messages.nth(1).locator('.feedback-message')).toContainText('Der Ton eines Wortes wird auf meinem Handy zweimal abgespielt.')
    await expect(messages.nth(1).locator('.feedback-translation')).toContainText('The sound of a word is played twice on my phone.')
    await expect(topic.getByLabel('Merge into…')).toBeVisible()
    await expectFits(page, '.admin *')
    // Renamed: the title is a field, and Save keeps it.
    await topic.getByRole('button', { name: 'Rename' }).click()
    await topic.getByRole('textbox', { name: 'Title' }).fill('The sound of a word plays twice')
    await topic.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(topic.getByRole('button', { name: 'The sound of a word plays twice' })).toHaveAttribute('aria-expanded', 'true')
    await expect(messages).toHaveCount(2)
    // A reload: the new title, with its messages and its match.
    await page.reload()
    await byTopic()
    await expect(topics).toHaveCount(3)
    await expect(topic.getByRole('button', { name: 'The sound of a word plays twice' })).toBeVisible()
    await expect(topic.getByText('2 messages', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Sound plays twice on phones' })).toHaveCount(0)
    // A message's card names the topic as it is called now.
    await panel.getByLabel('View').selectOption({ label: 'Messages' })
    await expect(items.filter({ hasText: 'Der Ton eines Wortes' }).getByText('Topic: The sound of a word plays twice')).toBeVisible()
    await expectFits(page, '.admin *')
    return
  }

  const topic = topics.filter({ hasText: 'Choose the number of new words' })
  await expect(topic.getByText('2 messages', { exact: true })).toBeVisible()
  await expect(topic.getByRole('link', { name: 'looks like #95' })).toHaveAttribute('href', 'https://github.com/wordado/wordado/issues/95')
  await expect(topic.getByRole('button', { name: 'Remove' })).toBeVisible()
  await topic.getByRole('button', { name: 'Choose the number of new words' }).tap()
  const messages = topic.getByRole('list', { name: 'Messages of the topic' }).getByRole('listitem')
  await expect(messages).toHaveCount(2)
  await expect(messages.filter({ hasText: 'Me gustaría elegir' }).locator('.feedback-translation')).toHaveText('I would like to choose how many new words I learn each day.')
  await expectFits(page, '.admin *')
  // The topic's own note and state, as on a message.
  const mark = topic.getByRole('form', { name: 'The topic’s mark' })
  await mark.getByLabel('Topic note').fill('Planned with the settings.')
  await mark.getByRole('button', { name: 'Save note' }).tap()
  await expect(mark.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await mark.getByLabel('Topic state').selectOption({ label: 'Looked at' })
  await expect(mark.getByRole('status').filter({ hasText: 'Saved' })).toHaveCount(2)
  await expect(topic.locator('.topic-meta').getByText('Looked at')).toBeVisible()
  await expectFits(page, '.admin *')
  await page.reload()
  await byTopic()
  await expect(topic.locator('.topic-meta').getByText('Looked at')).toBeVisible()
  await topic.getByRole('button', { name: 'Choose the number of new words' }).tap()
  await expect(mark.getByLabel('Topic note')).toHaveValue('Planned with the settings.')
  await expect(mark.getByLabel('Topic state')).toHaveValue('seen')
  // Its messages were not marked with it.
  const message = messages.filter({ hasText: 'Me gustaría elegir' })
  await expect(message.locator('.feedback-head').getByText('New', { exact: true })).toBeVisible()
  // Its own mark is folded away under the topic's.
  await expect(message.getByLabel('State')).toBeHidden()
  await message.getByText('Mark this message').tap()
  await expect(message.getByLabel('State')).toHaveValue('new')
  await expectFits(page, '.admin *')
}

test('an admin reads the feedback by topic, confirms a proposed match, opens a topic and renames it', async ({ browser }) => {
  await readsTopics(browser, 'sound')
})

test('@phone an admin reads the feedback by topic on a phone, and notes and marks a topic', async ({ browser }) => {
  await readsTopics(browser, 'words')
})

/** The week at the top of the Feedback tab (spec 2026-10-10 §3.4) and the draft of an issue (§3.5), from the stand-in
 * model. Both runs read the week, which changes nothing. The desktop run drafts an issue for its own topic, the one
 * about the sound, changes the draft, looks at where Open on GitHub leads without going there, and pastes the
 * number of the filed issue; the phone run opens the draft of its own topic, about the number of words, and closes it. */
async function readsWeekAndDrafts(browser: Browser, mine: 'sound' | 'words') {
  const page = await as(browser, 'admin')
  await page.goto('/#feedback')
  const panel = page.getByRole('tabpanel', { name: 'Feedback' })
  const toggle = panel.getByRole('region', { name: 'AI help' }).getByRole('switch', { name: 'AI help' })
  await expect(toggle).toBeEnabled()
  if (!(await toggle.isChecked())) await toggle.click()
  await expect(toggle).toBeChecked()
  // Every message read by the AI: the week is counted from what it read.
  await panel.getByLabel('Show').selectOption({ label: 'All' })
  await expect(panel.getByRole('list', { name: 'Feedback' }).getByRole('listitem').locator('.feedback-ai')).toHaveCount(9)

  const week = panel.getByRole('region', { name: 'This week' })
  await expect(week.getByText('9 messages read by the AI in the last 7 days')).toBeVisible()
  await expect(week.getByText('Written by the AI')).toBeVisible()
  await expect(week.getByText(/^Most of the week’s messages were about the sound playing twice/)).toBeVisible()
  await expect(week.getByRole('list', { name: 'By the AI’s category' }).getByRole('listitem')).toHaveText(['Bug 3', 'Idea 3', 'Question 0', 'Praise 2', 'Junk 1'])
  const most = week.getByRole('list', { name: 'Most messages' }).getByRole('listitem')
  await expect(most).toHaveCount(3)
  await expect(most.filter({ hasText: 'Choose the number of new words' })).toHaveText('Choose the number of new words 2')
  await expect(week.getByRole('list', { name: 'Blocking bugs' }).getByRole('listitem')).toHaveText(['Path stays white after a unit 1'])
  await expect(week.getByRole('list', { name: 'New topics' }).getByRole('listitem')).toHaveCount(3)
  await expectFits(page, '.admin *')

  // What the stand-in model was sent for the paragraph: numbers and the topics' titles, and nothing a learner wrote.
  const { requests } = (await (await fetch('http://127.0.0.1:4184/_state')).json()) as { requests: { body: { messages: { role: string; content: string }[]; response_format: { json_schema: { name: string } } } }[] }
  const named = (name: string) => requests.filter((r) => r.body.response_format.json_schema.name === name)
  expect(named('feedback_week').length).toBeGreaterThan(0)
  for (const asked of named('feedback_week')) {
    const input = JSON.parse(asked.body.messages.find((m) => m.role === 'user')!.content) as Record<string, unknown>
    expect(Object.keys(input).sort()).toEqual(['blockingBugs', 'byCategory', 'messages', 'newTopics', 'topTopics'])
    for (const theirs of ['Der Ton', 'Me gustaría', 'my phone', 'played twice', 'white screen', 'example.com', '[email]']) expect(JSON.stringify(input)).not.toContain(theirs)
  }

  // A topic of the week opens By topic at that topic, with its messages.
  await most.filter({ hasText: 'Choose the number of new words' }).getByRole('button').click()
  await expect(panel.getByLabel('View')).toHaveValue('topics')
  const topics = panel.getByRole('list', { name: 'Topics', exact: true }).locator('> li')
  const words = topics.filter({ hasText: 'Choose the number of new words' })
  await expect(words.getByRole('list', { name: 'Messages of the topic' }).getByRole('listitem')).toHaveCount(2)
  const dialog = page.getByRole('dialog', { name: 'Draft an issue' })

  if (mine === 'words') {
    await words.getByRole('button', { name: 'Draft an issue' }).tap()
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Let learners set their daily amount of fresh vocabulary')
    await expect(dialog.getByLabel('Text')).toHaveValue(/^## What happens\nLearners ask for a setting/)
    await expect(dialog.getByText('Written by the AI from 2 messages. Read it before you file it: it becomes public under your name.')).toBeVisible()
    await expectFits(page)
    // Both fields can be reached and written in, and so can the way out.
    await dialog.getByLabel('Title', { exact: true }).fill('Daily amount of new words')
    await dialog.getByLabel('Text').fill('Changed on a phone.')
    await dialog.getByRole('link', { name: 'Open on GitHub' }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole('link', { name: 'Open on GitHub' })).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByLabel('When the issue is filed, paste its number or its address here')).toBeEditable()
    await expectFits(page)
    await dialog.getByRole('button', { name: 'Close' }).tap()
    await expect(dialog).toHaveCount(0)
    // Nothing was kept: the topic has the match it had.
    await expect(words.getByRole('link', { name: '#95', exact: true })).toHaveCount(0)
    return
  }

  // The desktop run's own topic, whatever it is called by now.
  const sound = topics.filter({ has: page.locator('.topic-title', { hasText: /sound/i }) })
  await sound.locator('.topic-open').click()
  await expect(sound.getByRole('list', { name: 'Messages of the topic' }).getByRole('listitem')).toHaveCount(2)
  await sound.getByRole('button', { name: 'Draft an issue' }).click()
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Audio for a word is heard two times on handsets')
  await expect(dialog.getByLabel('Text')).toHaveValue(/^## What happens\nLearners hear the audio for a word two times in a row\./)
  await expectFits(page)
  // The link follows the fields. It is looked at, not followed: GitHub is never asked.
  await dialog.getByLabel('Title', { exact: true }).fill('Audio of a word plays twice & more')
  const link = dialog.getByRole('link', { name: 'Open on GitHub' })
  const href = (await link.getAttribute('href'))!
  expect(href.startsWith('https://github.com/wordado/wordado/issues/new?')).toBe(true)
  expect(new URL(href).searchParams.get('title')).toBe('Audio of a word plays twice & more')
  expect(new URL(href).searchParams.get('body')).toContain('## How serious it sounds')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  // What is not an issue of this repository is refused in place.
  const filed = dialog.getByLabel('When the issue is filed, paste its number or its address here')
  await filed.fill('https://github.com/someone/else/issues/95')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('That is not the number or the address of an issue of wordado/wordado.')
  // The number of the filed issue becomes the topic's match.
  await filed.fill('#95')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(sound.getByRole('link', { name: '#95', exact: true })).toHaveAttribute('href', 'https://github.com/wordado/wordado/issues/95')
  await page.reload()
  await panel.getByLabel('View').selectOption({ label: 'By topic' })
  await panel.getByLabel('Show').selectOption({ label: 'All' })
  await expect(sound.getByRole('link', { name: '#95', exact: true })).toBeVisible()
  // The model was asked for the draft with the topic and its messages as it gets any message: no address for an answer.
  const after = (await (await fetch('http://127.0.0.1:4184/_state')).json()) as { requests: { body: { messages: { role: string; content: string }[]; response_format: { json_schema: { name: string } } } }[] }
  const drafts = after.requests.filter((r) => r.body.response_format.json_schema.name === 'feedback_draft').map((r) => r.body.messages.find((m) => m.role === 'user')!.content)
  expect(drafts.length).toBeGreaterThan(0)
  for (const sent of drafts) for (const theirs of ['answer-me@example.com', 'lerner@example.com', 'Mozilla', 'B3kq9xZa']) expect(sent).not.toContain(theirs)
}

test('an admin reads the week’s summary, drafts an issue for a topic, and pastes the filed issue’s number', async ({ browser }) => {
  await readsWeekAndDrafts(browser, 'sound')
})

test('@phone an admin reads the week’s summary and opens a draft on a phone', async ({ browser }) => {
  await readsWeekAndDrafts(browser, 'words')
})

/** The accounts the fake learner app server still has. */
const accountsLeft = async () => ((await (await fetch('http://127.0.0.1:4183/_state')).json()) as { accounts: string[] }).accounts

test('an admin opens what is behind the counts of accounts: a chart over time with its numbers as text, and a split by language (#209)', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await page.goto('/#accounts')
  const panel = page.getByRole('tabpanel', { name: 'Accounts' })
  const counts = panel.getByRole('list', { name: 'Accounts and their use' })
  // One count is pressed from the start, and the panel under the counts is about it.
  await expect(counts.getByRole('button', { pressed: true })).toHaveText(/^75\s*studied in the last 30 days$/)
  const studied = panel.getByRole('region', { name: 'Accounts that studied, per day' })
  await expect(studied.getByRole('img')).toHaveAccessibleName(/^Accounts that studied, per day, 90 days, .+: between 14 and 43, 14 at the end\./)
  // The numbers are text too, for whoever opens them: a row a day.
  await studied.getByText('The numbers').click()
  await expect(studied.getByRole('row')).toHaveCount(91)
  await expect(studied.getByRole('row').last()).toHaveText(/14$/)
  await studied.getByRole('button', { name: '30 days' }).click()
  await expect(studied.getByRole('row')).toHaveCount(31)
  // Pointing at the chart reads one day.
  await studied.getByRole('img').hover({ position: { x: 300, y: 80 } })
  await expect(studied.locator('.chart-at text')).toHaveText(/^.+: \d+$/)

  // Another count: it is the pressed one now, and the panel is its chart, with its own periods.
  await counts.getByRole('button', { name: /made in the last 7 days$/ }).click()
  await expect(counts.getByRole('button', { pressed: true })).toHaveText(/^4\s*made in the last 7 days$/)
  const made = panel.getByRole('region', { name: 'New accounts per week' })
  await expect(made.getByRole('button', { name: '12 weeks' })).toHaveAttribute('aria-pressed', 'true')
  await expect(made.locator('.chart-bar')).toHaveCount(12)
  await made.getByRole('button', { name: '26 weeks' }).click()
  await expect(made.locator('.chart-bar')).toHaveCount(26)
  await counts.getByRole('button', { name: /accounts$/ }).first().click()
  await expect(panel.getByRole('region', { name: 'Accounts in total' }).getByRole('img')).toHaveAccessibleName(/1,204 at the end/)

  // By language, in words: the largest first, the accounts whose language is not known last.
  await counts.getByRole('button', { name: /agreed to news$/ }).click()
  const news = panel.getByRole('region', { name: 'News by email, by language' }).getByRole('listitem')
  await expect(news).toHaveText([/^Bulgarian\s*673\s*31 agreed\s*2 withdrew\s*640 said nothing$/, /^English\s*211/, /^German\s*126/, /^Spanish\s*102/, /^Not known\s*92\s*0 agreed\s*0 withdrew\s*92 said nothing$/])
  await counts.getByRole('button', { name: /with reminders on$/ }).click()
  const reminders = panel.getByRole('region', { name: 'Reminders, by language' }).getByRole('listitem')
  await expect(reminders.first()).toHaveText(/^Bulgarian\s*14\s*11 sending\s*3 paused$/)
  await expect(reminders).toHaveCount(4)
  // The series and the splits were each asked for once, and nothing in what was asked names an account.
  const asked = ((await (await fetch('http://127.0.0.1:4183/_state')).json()) as { requests: string[] }).requests
  expect(asked.filter((r) => r === 'GET /v1/admin/accounts/series').length).toBeGreaterThanOrEqual(1)
  expect(asked.filter((r) => r.startsWith('GET /v1/admin/accounts/')).every((r) => !r.includes('?') && !r.includes('@'))).toBe(true)
})

test('an admin reads the counts of accounts and the sweep’s, looks an account up and deletes it after typing its address again (#187, #206)', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await page.goto('/#accounts')
  const panel = page.getByRole('tabpanel', { name: 'Accounts' })
  // How many accounts there are and how many are used: numbers, and when they were counted.
  const counts = panel.getByRole('list', { name: 'Accounts and their use' }).getByRole('listitem')
  await expect(counts).toHaveText([
    /^1,204\s*accounts$/,
    /^4\s*made in the last 7 days$/,
    /^31\s*made in the last 30 days$/,
    /^22\s*with reminders on$/,
    /^40\s*studied in the last 7 days$/,
    /^75\s*studied in the last 30 days$/,
    /^50\s*agreed to news$/,
    /^3\s*withdrew from news$/,
  ])
  await expect(panel.getByText(/1,151 accounts have said nothing about news yet\. Counted .+\./)).toBeVisible()
  const stats = panel.getByRole('list', { name: 'The sweep of inactive accounts' }).getByRole('listitem')
  await expect(stats).toHaveText([/^70\s*past 24 months now$/, /^50\s*the next run deletes$/, /^2\s*deleted by the last run$/, /^12\s*deleted so far$/])
  await expect(panel.getByText(/An account not signed in to for 24 months is deleted, at most 50 a day, with no mail first\. Last run: .+\./)).toBeVisible()
  await expect(panel.getByText('1 account has no date of a last sign-in: the sweep never takes it.')).toBeVisible()

  // An address nobody has.
  await panel.getByLabel('Email address').fill('nobody@example.com')
  await panel.getByRole('button', { name: 'Look up' }).click()
  await expect(panel.getByText('No account has the address nobody@example.com.')).toBeVisible()

  // The account: when it was made and last signed in, and how it is used (#209).
  await panel.getByLabel('Email address').fill('Leaving@example.com')
  await panel.getByLabel('Email address').press('Enter')
  const account = panel.getByRole('region', { name: 'The account' })
  await expect(account.getByRole('heading', { name: 'leaving@example.com' })).toBeVisible()
  await expect(account.locator('dl > div')).toHaveText([
    /^Created.*\d{4}$/,
    /^Last sign-in.*\d{4}$/,
    /^Last studied.*\d{4}$/,
    /^Days studied, last 3019$/,
    /^LanguageBulgarian$/,
    /^News by emailAgreed .*\d{4}, in Bulgarian$/,
    /^RemindersOn 19:30 \(UTC\+3\)Paused 08:00 \(UTC\+3\)$/,
    /^Devices2$/,
    /^Deleted for inactivitynot before \D+ \d{4}$/,
  ])

  // The question: closed, nothing is deleted.
  await account.getByRole('button', { name: 'Delete this account…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this account?' })
  await expect(dialog.getByText(/it cannot be brought back/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete the account' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  expect(await accountsLeft()).toContain('leaving@example.com')

  // Answered with another address, it stays closed to the button; with the account's own, the account goes.
  await account.getByRole('button', { name: 'Delete this account…' }).click()
  await dialog.getByLabel('Type the address again to delete the account').fill('staying@example.com')
  await expect(dialog.getByRole('button', { name: 'Delete the account' })).toBeDisabled()
  await dialog.getByLabel('Type the address again to delete the account').fill('leaving@example.com')
  await dialog.getByRole('button', { name: 'Delete the account' }).click()
  await expect(panel.getByText('The account of leaving@example.com was deleted.')).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(account).toBeHidden()
  const left = await accountsLeft()
  expect(left).not.toContain('leaving@example.com')
  expect(left).toContain('staying@example.com')
  await panel.getByLabel('Email address').fill('leaving@example.com')
  await panel.getByRole('button', { name: 'Look up' }).click()
  await expect(panel.getByText('No account has the address leaving@example.com.')).toBeVisible()
})

test('@phone an admin reads the Accounts tab and opens the question on a phone (#187)', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await page.goto('/#accounts')
  const panel = page.getByRole('tabpanel', { name: 'Accounts' })
  // The four numbers, two by two.
  const stats = panel.getByRole('list', { name: 'The sweep of inactive accounts' }).getByRole('listitem')
  await expect(stats).toHaveCount(4)
  const [first, second, third] = await Promise.all([0, 1, 2].map(async (i) => (await stats.nth(i).boundingBox())!))
  expect(second!.y).toBe(first!.y)
  expect(third!.y).toBeGreaterThan(first!.y)
  // The counts of accounts above them, two by two as well.
  const counts = panel.getByRole('list', { name: 'Accounts and their use' }).getByRole('listitem')
  await expect(counts).toHaveCount(8)
  const [one, two, three] = await Promise.all([0, 1, 2].map(async (i) => (await counts.nth(i).boundingBox())!))
  expect(two!.y).toBe(one!.y)
  expect(three!.y).toBeGreaterThan(one!.y)
  expect(first!.y).toBeGreaterThan(three!.y)
  await panel.getByLabel('Email address').fill('staying@example.com')
  await panel.getByRole('button', { name: 'Look up' }).tap()
  const account = panel.getByRole('region', { name: 'The account' })
  await expect(account.locator('dl > div').nth(1)).toHaveText('Last sign-innot recorded')
  await expect(account.locator('dl > div').last()).toHaveText('Deleted for inactivitynever: it has no date of a last sign-in')
  await expectFits(page, '.admin *')
  // What is behind a count, at the width of the phone: the chart, then a split, and nothing sticks out.
  const chart = panel.getByRole('region', { name: 'Accounts that studied, per day' }).getByRole('img')
  await expect(chart).toBeVisible()
  expect((await chart.boundingBox())!.width).toBeLessThanOrEqual(390)
  await chart.tap({ position: { x: 120, y: 80 } })
  await expect(panel.locator('.chart-at text')).toHaveText(/^.+: \d+$/)
  await expectFits(page, '.admin *')
  await panel.getByRole('button', { name: /agreed to news$/ }).tap()
  await expect(panel.getByRole('region', { name: 'News by email, by language' }).getByRole('listitem')).toHaveCount(5)
  await expectFits(page, '.admin *')
  // The question is the whole screen, and closing it deletes nothing.
  await account.getByRole('button', { name: 'Delete this account…' }).tap()
  const dialog = page.getByRole('dialog', { name: 'Delete this account?' })
  await expect(dialog.getByRole('button', { name: 'Delete the account' })).toBeDisabled()
  expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  await expectFits(page)
  await dialog.getByRole('button', { name: 'Cancel' }).tap()
  await expect(dialog).toBeHidden()
  expect(await accountsLeft()).toContain('staying@example.com')
})

test('the daily job reads the open issues of the app’s repository once a day, with no token', async () => {
  const asked = async () => ((await (await fetch('http://127.0.0.1:4182/_state')).json()) as { issueRequests: { authorization: string | null; page: number }[] }).issueRequests
  const before = (await asked()).length
  const fire = async () => expect(await (await fetch(`http://127.0.0.1:4181/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('0 5 * * *')}`)).text()).toBe('ok')
  await fire()
  const requests = await asked()
  expect(requests).toHaveLength(before + 1)
  expect(requests.at(-1)).toEqual({ authorization: null, page: 1 })
  // The same day again: the day is taken, so GitHub is not asked.
  await fire()
  expect(await asked()).toHaveLength(before + 1)
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

/** The announcements the fake learner app server has, and the test sends it was asked for. */
const announcementsState = async () =>
  (await (await fetch('http://127.0.0.1:4183/_state')).json()) as { announcements: { texts: { en: { subject: string } }; kind: string; status: string; version: number; testedVersion: number | null; recipients: number }[]; testSends: { email: string; version: number }[] }

test('an admin writes a service notice, previews it, sends a test, and sends it after typing the kind and the count (#185)', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await page.goto('/#announcements')
  // The tab is called Mail (#215), under the address it has had.
  const panel = page.getByRole('tabpanel', { name: 'Mail' })
  await expect(page.getByRole('tab', { name: 'Mail' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByText(/At most 50 announcement mails go out a day/)).toBeVisible()
  await panel.getByRole('button', { name: 'New announcement' }).click()
  const form = panel.getByRole('form', { name: 'Announcement' })
  // The kind is one box, a service notice unless chosen otherwise, with what it is for under it.
  await expect(form.getByLabel('Kind')).toHaveValue('service')
  await expect(form.getByText(/^For what is part of the service/)).toBeVisible()
  // One editor: English first, then Bulgarian by the language box. What was typed in English stays.
  const subject = form.getByLabel('Subject', { exact: true })
  const text = form.getByLabel('Text', { exact: true })
  const marks = form.getByRole('group', { name: 'Which languages have text' })
  await expect(marks.getByRole('button', { name: 'English: needed' })).toHaveAttribute('aria-pressed', 'true')
  await subject.fill('The terms change on 1 December')
  await text.fill('Hello,\n\nthe terms change on 1 December.\nRead them: https://wordado.com/en/terms/')
  await expect(form.getByText('30 / 150')).toBeVisible()
  await form.getByRole('combobox', { name: 'Language' }).selectOption('bg')
  await expect(subject).toHaveValue('')
  await subject.fill('Условията се променят на 1 декември')
  await text.fill('Здравейте.')
  await expect(marks.getByRole('button')).toHaveText(['English: written', 'Bulgarian: written', 'German: empty', 'Spanish: empty'])
  await marks.getByRole('button', { name: 'English: written' }).click()
  await expect(subject).toHaveValue('The terms change on 1 December')
  // Nothing to test or send before it is saved.
  await expect(form.getByRole('button', { name: 'Send test' })).toBeDisabled()
  await expect(form.getByRole('button', { name: 'Send…' })).toBeDisabled()
  await form.getByRole('button', { name: 'Save draft' }).click()
  await expect(form.getByText('Saved as version 1.')).toBeVisible()

  // The preview: each language as it is mailed, with why it came under the text.
  await form.getByRole('button', { name: 'Preview' }).click()
  const preview = form.getByRole('region', { name: 'Preview' })
  await expect(preview.getByText(/It would go to 3 accounts now/)).toBeVisible()
  await expect(preview.getByText('Условията се променят на 1 декември')).toBeVisible()
  await expect(preview.getByText(/You are receiving this notice because you have a Wordado account\./).first()).toBeVisible()

  // Not sendable until this version went as a test.
  await expect(form.getByText('This version has not been sent as a test yet.')).toBeVisible()
  await expect(form.getByRole('button', { name: 'Send…' })).toBeDisabled()
  await form.getByLabel('Send a test to').fill('owner@example.com')
  await form.getByRole('button', { name: 'Send test' }).click()
  await expect(form.getByText('The test of version 1 was sent: 2 mails. Read it before sending.')).toBeVisible()
  expect((await announcementsState()).testSends).toContainEqual({ id: expect.any(Number), version: 1, email: 'owner@example.com' })

  // The question: closed to the button until the kind and the count are typed as shown.
  await form.getByRole('button', { name: 'Send…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Send this announcement?' })
  await expect(dialog.getByText('A service notice, to 3 accounts.')).toBeVisible()
  const send = dialog.getByRole('button', { name: 'Send to 3 accounts' })
  await expect(send).toBeDisabled()
  await dialog.getByLabel('Type “service 3” to send').fill('service 30')
  await expect(send).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  expect((await announcementsState()).announcements.find((a) => a.texts.en.subject === 'The terms change on 1 December')).toMatchObject({ status: 'draft', testedVersion: 1 })
  await form.getByRole('button', { name: 'Send…' }).click()
  await dialog.getByLabel('Type “service 3” to send').fill('service 3')
  await send.click()
  await expect(dialog).toBeHidden()

  // Back on the list: it is being sent, and can be stopped.
  const row = panel.getByRole('list', { name: 'Announcements' }).getByRole('listitem').filter({ hasText: 'The terms change on 1 December' })
  await expect(row.getByText('Sending', { exact: true })).toBeVisible()
  await expect(row.getByText('0 of 3 sent · 3 waiting')).toBeVisible()
  expect((await announcementsState()).announcements.find((a) => a.texts.en.subject === 'The terms change on 1 December')).toMatchObject({ kind: 'service', status: 'sending', recipients: 3 })
  await row.getByRole('button', { name: 'Stop sending' }).click()
  await expect(row.getByText('Stopped', { exact: true })).toBeVisible()
  // Open, it is read and nothing of it can be changed.
  await row.getByRole('button', { name: 'Open' }).click()
  await expect(panel.getByText(/cannot be changed or sent again/)).toBeVisible()
  await expect(panel.getByRole('form', { name: 'Announcement' }).getByRole('button', { name: 'Save draft' })).toHaveCount(0)
  await expectFits(page)
})

/** Switches the AI help on, as the Feedback tab's switch does: Translate uses it. (Never off: the other browser project shares the switch.) */
const aiHelpOn = async (page: Page) => expect((await page.request.put('/api/admin/feedback/ai', { data: { on: true }, headers: { origin: 'http://127.0.0.1:4181' } })).status()).toBe(200)

test('an admin takes the prepared notice for a service notice, has the empty languages translated, and saves it; then it is not offered again (#215)', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await aiHelpOn(page)
  await page.goto('/#announcements')
  const panel = page.getByRole('tabpanel', { name: 'Mail' })
  await panel.getByRole('button', { name: 'New announcement' }).click()
  const form = panel.getByRole('form', { name: 'Announcement' })
  const subject = form.getByLabel('Subject', { exact: true })
  const text = form.getByLabel('Text', { exact: true })
  const marks = form.getByRole('group', { name: 'Which languages have text' })
  const translate = form.getByRole('button', { name: 'Translate from English into the empty languages' })
  // The notice the fake repository holds, read through the GitHub App: offered to a service notice, not to news.
  const offer = form.getByRole('region', { name: 'Prepared notice' })
  await expect(offer.getByText('A notice was prepared with the change of 11 October 2026')).toBeVisible()
  await expect(offer.getByText('New terms of use · English and Bulgarian · no announcement has used it yet')).toBeVisible()
  await form.getByLabel('Kind').selectOption('news')
  await expect(offer).toBeHidden()
  await form.getByLabel('Kind').selectOption('service')
  await expect(translate).toBeDisabled()
  // One press fills the languages it has. Nothing is saved by it.
  await offer.getByRole('button', { name: 'Use this text' }).click()
  await expect(form.getByText('English and Bulgarian filled from the prepared notice. Read each one, then save.')).toBeVisible()
  await expect(subject).toHaveValue('The terms of use have changed')
  await expect(marks.getByRole('button')).toHaveText(['English: written', 'Bulgarian: written', 'German: empty', 'Spanish: empty'])
  await expect(offer).toBeHidden()
  expect((await announcementsState()).announcements.some((a) => a.texts.en.subject === 'The terms of use have changed')).toBe(false)

  // Translate fills the two empty languages, and says a machine wrote them; Bulgarian is as the notice has it.
  await translate.click()
  await expect(form.getByText('Translated into German and Spanish. A machine wrote these: read each one before the test send.')).toBeVisible()
  await expect(marks.getByRole('button')).toHaveText(['English: written', 'Bulgarian: written', 'German: written, by a machine', 'Spanish: written, by a machine'])
  await expect(translate).toBeDisabled()
  // By the keyboard: a mark is a button, and shows its language.
  await marks.getByRole('button', { name: /^German:/ }).focus()
  await page.keyboard.press('Enter')
  await expect(subject).toHaveValue('[German] The terms of use have changed')
  await expect(text).toHaveValue(/^\[German\] Hello,/)
  await expect(form.getByText('A machine translated this from the English text. Read it before the test send.')).toBeVisible()
  await marks.getByRole('button', { name: /^Bulgarian:/ }).focus()
  await page.keyboard.press('Space')
  await expect(subject).toHaveValue('Условията за ползване са променени')
  // What the stand-in model was sent for a translation: the language and the announcement's own text, and nothing of anyone.
  const { requests } = (await (await fetch('http://127.0.0.1:4184/_state')).json()) as { requests: { body: { messages: { role: string; content: string }[]; response_format: { json_schema: { name: string } } } }[] }
  const asked = requests.filter((r) => r.body.response_format.json_schema.name === 'announcement_translation').map((r) => r.body.messages.find((m) => m.role === 'user')!.content)
  const mine = asked.filter((sent) => sent.includes('The terms of use have changed')).map((sent) => JSON.parse(sent) as Record<string, string>)
  expect(mine.map((input) => input['language']).sort()).toEqual(['German', 'Spanish'])
  for (const input of mine) expect(Object.keys(input).sort()).toEqual(['body', 'language', 'subject'])
  for (const sent of asked) expect(sent).not.toContain('admin@example.com')

  // It is a draft like one typed: saved, and to be tested before it can be sent.
  await expect(form.getByRole('button', { name: 'Send test' })).toBeDisabled()
  await form.getByRole('button', { name: 'Save draft' }).click()
  await expect(form.getByText('Saved as version 1.')).toBeVisible()
  await expect(form.getByText('This version has not been sent as a test yet.')).toBeVisible()
  await expect(form.getByRole('button', { name: 'Send…' })).toBeDisabled()
  expect((await announcementsState()).announcements.find((a) => a.texts.en.subject === 'The terms of use have changed')).toMatchObject({ kind: 'service', status: 'draft', version: 1, testedVersion: null })
  await expectFits(page)

  // An announcement has its English subject now: it is used, and a new announcement is offered nothing.
  await form.getByRole('button', { name: 'Back to the list' }).click()
  const read = page.waitForResponse((res) => res.url().endsWith('/api/admin/announcements/prepared'))
  await panel.getByRole('button', { name: 'New announcement' }).click()
  expect(await (await read).json()).toEqual({ notice: null })
  await expect(panel.getByRole('form', { name: 'Announcement' }).getByLabel('Kind')).toHaveValue('service')
  await expect(offer).toHaveCount(0)
})

test('@phone an admin writes news on a phone, has it translated, and the question to send it is the whole screen (#185, #215)', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await aiHelpOn(page)
  await page.goto('/#announcements')
  const panel = page.getByRole('tabpanel', { name: 'Mail' })
  await panel.getByRole('button', { name: 'New announcement' }).tap()
  const form = panel.getByRole('form', { name: 'Announcement' })
  await form.getByLabel('Kind').selectOption('news')
  await expect(form.getByText(/^For new features\. Every mail carries a link that stops it\./)).toBeVisible()
  // News is offered no prepared notice.
  await expect(form.getByRole('region', { name: 'Prepared notice' })).toHaveCount(0)
  await form.getByLabel('Subject', { exact: true }).fill('New: search the whole dictionary')
  await form.getByLabel('Text', { exact: true }).fill('You can now search every word: https://app.wordado.com/a-long-address-that-does-not-break-by-itself-anywhere-at-all')
  await expectFits(page, '.admin *')
  // Translate, then a language shown by its mark: the form still fits the screen with every mark at its longest.
  const marks = form.getByRole('group', { name: 'Which languages have text' })
  await form.getByRole('button', { name: 'Translate from English into the empty languages' }).tap()
  await expect(form.getByText('Translated into Bulgarian, German and Spanish. A machine wrote these: read each one before the test send.')).toBeVisible()
  await marks.getByRole('button', { name: /^Spanish:/ }).tap()
  await expect(form.getByLabel('Subject', { exact: true })).toHaveValue('[Spanish] New: search the whole dictionary')
  await expect(form.getByRole('combobox', { name: 'Language' })).toHaveValue('es')
  await expectFits(page, '.admin *')
  await form.getByRole('button', { name: 'Save draft' }).tap()
  await expect(form.getByText('Saved as version 1.')).toBeVisible()
  await form.getByRole('button', { name: 'Preview' }).tap()
  await expect(form.getByRole('region', { name: 'Preview' }).getByText(/To stop it, open:/)).toHaveCount(4)
  await expectFits(page, '.admin *')
  await form.getByLabel('Send a test to').fill('owner@example.com')
  await form.getByRole('button', { name: 'Send test' }).tap()
  await expect(form.getByText('The test of version 1 was sent: 4 mails. Read it before sending.')).toBeVisible()
  await form.getByRole('button', { name: 'Send…' }).tap()
  const dialog = page.getByRole('dialog', { name: 'Send this announcement?' })
  await expect(dialog.getByText('News, to 1 account.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Send to 1 account' })).toBeDisabled()
  expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  await expectFits(page)
  await dialog.getByRole('button', { name: 'Cancel' }).tap()
  await expect(dialog).toBeHidden()
  // Closed, nothing was sent.
  expect((await announcementsState()).announcements.find((a) => a.texts.en.subject === 'New: search the whole dictionary')).toMatchObject({ kind: 'news', status: 'draft' })
})
