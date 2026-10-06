import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

const tokens = () => JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '.e2e', 'tokens.json'), 'utf8')) as { admin: string; reviewer: string; phone: string }
/** A page signed in as one of the fixture's people, with the running project's screen (a context made by hand does not get it by itself). */
const as = async (browser: Browser, who: 'admin' | 'reviewer' | 'phone') => {
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

/** One finger across the screen at height `y`, as real touch input. */
async function swipe(page: Page, fromX: number, toX: number, y: number) {
  const cdp = await page.context().newCDPSession(page)
  const at = (x: number) => [{ x, y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(fromX) })
  for (let i = 1; i <= 5; i += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(fromX + ((toX - fromX) * i) / 5) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
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
  // The header keeps the row list and Submit; what is reviewed and the name have gone into the row list.
  await expect(page.getByRole('banner').getByText('Petra')).toBeHidden()
  await expect(page.getByRole('button', { name: /Submit 0 decisions/ })).toBeVisible()

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
  await page.getByRole('button', { name: 'My assignments' }).click()
  await expect(page.getByRole('heading', { name: 'Your assignments' })).toBeVisible()
  await expect(page).not.toHaveURL(/#/)
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
