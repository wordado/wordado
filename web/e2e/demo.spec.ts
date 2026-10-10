import { expect, test, type Locator } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { answer, expectAccessible, finishSetup, finishSetupAt, forwardConsole, heading, serveGlossedSample, serveTwoLevelSample, SETTLE_MS, studyNew, today } from './helpers'

test.beforeEach(async ({ context }) => {
  forwardConsole(context)
  // English, so the assertions read plainly; the Bulgarian default is covered by the unit suite.
  await context.addInitScript(() => {
    if (localStorage.getItem('wordado.locale') === null) localStorage.setItem('wordado.locale', 'en')
  })
})

test('studies the demo by keyboard from the first visit to a completed day', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await expect(heading(page)).toHaveText('10 new words')
  await page.getByRole('link', { name: 'Start studying' }).click()
  for (let i = 0; i < 40 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
  await expect(heading(page)).toHaveText('Session complete')
  await expect(page.getByText('Today counts toward your streak.')).toBeVisible()
  await page.getByRole('link', { name: 'Back to today' }).click()
  await expect(heading(page)).toHaveText('Nothing left for today.')
  await expect(page.getByText('1-day streak Today counts.')).toBeVisible()
})

for (const mode of ['flashcard', 'multiple_choice', 'listening_select']) {
  test(`answers a ${mode} item by keyboard`, async ({ page }) => {
    await page.goto('/')
    await finishSetup(page)
    await page.goto(`/study?mode=${mode}`)
    await expect(page.locator('.card')).toHaveAttribute('data-mode', mode)
    expect(await answer(page)).toBe(mode)
  })
}

test('a multiple-choice question: the gloss on its own row, a right answer moves on by itself, a wrong one waits (spec §8.1)', async ({ browser }) => {
  test.slow()
  const GLOSS = 'for the test'
  const context = await browser.newContext({ serviceWorkers: 'block' })
  forwardConsole(context)
  await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
  const entries = await serveGlossedSample(context, GLOSS)
  try {
    const page = await context.newPage()
    await page.goto('/')
    await finishSetup(page)
    await page.goto('/study?mode=multiple_choice')
    const prompt = page.locator('.card[data-phase="prompt"]')
    const options = page.locator('button.option')
    const progress = page.getByRole('progressbar', { name: 'Session progress' })
    /** The question on screen, once it can be answered: its direction, and the text of its right and of a wrong option. */
    const question = async () => {
      await expect(prompt).toBeVisible()
      await page.waitForTimeout(SETTLE_MS)
      const word = prompt.locator('.hw-word')
      if ((await word.count()) > 0) {
        const headword = await word.textContent()
        const texts = await options.locator('.translation-word').allTextContents()
        const right = entries.find((e) => e.headword === headword && texts.includes(e.translation))!.translation
        return { direction: 'en_to_l1', right, wrong: texts.find((text) => text !== right)! } as const
      }
      const shown = await prompt.locator('.prompt-text .translation-word').textContent()
      const texts = await options.locator('.option-text').allTextContents()
      const right = entries.find((e) => e.translation === shown && texts.includes(e.headword))!.headword
      return { direction: 'l1_to_en', right, wrong: texts.find((text) => text !== right)! } as const
    }
    const option = (text: string) => options.filter({ has: page.getByText(text, { exact: true }) })

    // Both directions come within a few questions: each shows its gloss on a row of its own.
    const seen = new Set<string>()
    for (let i = 0; i < 20 && seen.size < 2; i += 1) {
      const q = await question()
      if (q.direction === 'en_to_l1') {
        // The translation and its gloss are two rows of one option, read as "word, gloss"; no brackets.
        const first = options.first()
        const word = first.locator('.translation-word')
        const gloss = first.locator('.sense')
        await expect(gloss).toHaveText(GLOSS)
        expect((await gloss.boundingBox())!.y).toBeGreaterThanOrEqual((await word.boundingBox())!.y + (await word.boundingBox())!.height - 1)
        // The comma is only heard; a row of its own puts a space before it in the computed name, which is not spoken.
        await expect(first).toHaveAccessibleName(`${await word.textContent()} , ${GLOSS}`)
        // The flashcard's listen button, beside the headword, where this browser plays the clips.
        if (await page.evaluate(() => new Audio().canPlayType('audio/mp4') !== '')) await expect(prompt.getByRole('button', { name: 'Play the word' })).toBeVisible()
      } else {
        const word = prompt.locator('.prompt-text .translation-word')
        const gloss = prompt.locator('.prompt-text .sense')
        await expect(gloss).toHaveText(GLOSS)
        expect((await gloss.boundingBox())!.y).toBeGreaterThanOrEqual((await word.boundingBox())!.y + (await word.boundingBox())!.height - 1)
        // Hearing the word would give the answer away.
        await expect(prompt.getByRole('button', { name: 'Play the word' })).toHaveCount(0)
      }
      if (!seen.has(q.direction)) await expectAccessible(page, { dark: true })
      seen.add(q.direction)
      if (seen.size < 2) await answer(page)
    }
    expect([...seen].sort()).toEqual(['en_to_l1', 'l1_to_en'])

    // A right answer: the green line, no Continue, and the next question without a click.
    let q = await question()
    let before = Number(await progress.getAttribute('aria-valuenow'))
    await option(q.right).click()
    await expect(page.locator('.feedback-sheet.is-correct')).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Correct')
    await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
    await expect(progress).toHaveAttribute('aria-valuenow', String(before + 1))
    await expect(prompt).toBeVisible()
    // The keyboard goes on working on the new question.
    await expect(prompt).toBeFocused()

    // A wrong answer waits for Continue, however long.
    q = await question()
    await option(q.wrong).click()
    await expect(page.locator('.feedback-sheet.is-incorrect')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
    await page.waitForTimeout(2_000)
    await expect(page.locator('.card[data-phase="feedback"]')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(prompt).toBeVisible()

    // Switched off in Settings, a right answer waits for Continue too, as it always did.
    await page.goto('/settings/study')
    const auto = page.getByRole('checkbox', { name: 'Continue automatically after a right answer' })
    await expect(auto).toBeChecked()
    await expectAccessible(page, { dark: true })
    await auto.uncheck()
    await page.goto('/study?mode=multiple_choice')
    q = await question()
    before = Number(await progress.getAttribute('aria-valuenow'))
    await option(q.right).click()
    await expect(page.locator('.feedback-sheet.is-correct')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
    await page.waitForTimeout(2_000)
    await expect(page.locator('.card[data-phase="feedback"]')).toBeVisible()
    await expect(progress).toHaveAttribute('aria-valuenow', String(before + 1))
    await page.keyboard.press('Enter')
    await expect(prompt).toBeVisible()
  } finally {
    await context.close()
  }
})

test('keeps progress offline after the first visit, and after reconnecting', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright’s WebKit fails page.goto while offline ("WebKit encountered an internal error"); Safari offline is on the release checklist (docs/deploy.md)')
  await page.goto('/')
  await finishSetup(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await studyNew(page, 3)
  await context.setOffline(true)
  await page.goto('/')
  await expect(heading(page)).toHaveText('7 new words')
  await page.goto('/path')
  await expect(page.getByText('3 of 20 started')).toBeVisible()

  await page.goto('/study')
  await answer(page)
  await page.getByRole('button', { name: 'Stop for now' }).click()
  await expect(page.locator('.done')).toBeVisible()

  await context.setOffline(false)
  await page.goto('/')
  await expect(heading(page)).toHaveText('6 new words')
})

test('a new version waits while a run is in progress, then the app updates itself once and says so (spec §9.1)', async ({ page }) => {
  // The preview serves `dist` as it is on disk: a byte more in sw.js is a new version to the browser.
  const worker = fileURLToPath(new URL('../dist/sw.js', import.meta.url))
  const built = readFileSync(worker)
  try {
    await page.goto('/')
    await finishSetup(page)
    await page.evaluate(() => navigator.serviceWorker.ready)
    // The first worker took no page over; from this load on it controls the page, so a second one is an update.
    await page.reload()
    await expect(today(page)).toBeVisible()
    let loads = 0
    page.on('load', () => (loads += 1))

    await page.getByRole('link', { name: 'Start studying' }).click()
    await answer(page)
    writeFileSync(worker, Buffer.concat([built, Buffer.from(`\n// e2e: a newer version, ${Date.now()}\n`)]))
    await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!
      await registration.update()
      const installing = registration.installing
      if (installing) await new Promise<void>((resolve) => installing.addEventListener('statechange', () => installing.state === 'installed' && resolve()))
      if (!registration.waiting) throw new Error('no worker is waiting')
    })
    // The new version waits, however long the run takes: longer here than the app's own poll for a safe moment.
    await answer(page)
    await page.waitForTimeout(5_000)
    await answer(page)
    expect(loads).toBe(0)
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting != null)).toBe(true)

    // Leaving the run is the safe moment.
    await page.getByRole('button', { name: 'Stop for now' }).click()
    await expect(page.locator('.done')).toBeVisible()
    await page.waitForTimeout(3_000)
    expect(loads).toBe(0)
    await page.getByRole('link', { name: 'Back to today' }).click()
    await expect(page.getByText('Wordado was updated.')).toBeVisible()
    await expect(today(page)).toBeVisible()
    // Once: the answers are there, nothing reloads again, and the line is not said twice.
    await page.waitForTimeout(5_000)
    expect(loads).toBe(1)
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null)).toBeNull()
    await page.reload()
    await expect(today(page)).toBeVisible()
    await expect(page.getByText('Wordado was updated.')).toHaveCount(0)
  } finally {
    writeFileSync(worker, built)
  }
})

test('a second tab says Wordado is open elsewhere, and can take over', async ({ page, context }) => {
  await page.goto('/')
  await finishSetup(page)
  await expect(heading(page)).toHaveText('10 new words')
  const second = await context.newPage()
  await second.goto('/')
  await expect(heading(second)).toHaveText('Wordado is open in another tab.')
  await second.getByRole('button', { name: 'Use Wordado here' }).click()
  await expect(heading(second)).toHaveText('10 new words')
  await expect(heading(page)).toHaveText('Wordado is open in another tab.')
})

test('plays a matching board once five words are known', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await studyNew(page, 5)
  await page.goto('/practice/matching')
  const left = page.locator('[data-side="left"] button')
  await expect(left).toHaveCount(5)
  for (const entry of await left.evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).dataset.entry!))) {
    await page.locator(`[data-side="left"] button[data-entry="${entry}"]`).click()
    await page.locator(`[data-side="right"] button[data-entry="${entry}"]`).click()
  }
  await expect(page.getByRole('status')).toHaveText('✓ All pairs matched.')
})

test('practises one unit from the path, finishes, and comes back to the path', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await studyNew(page, 5)
  await page.goto('/path')
  await page.getByRole('link', { name: 'Practise this unit: People and greetings' }).click()
  await expect(heading(page)).toHaveText('Practice')
  await expect(page.getByText('Unit: People and greetings')).toBeVisible()
  await page.getByRole('link', { name: 'Flashcards' }).click()
  await expect(page).toHaveURL(/\/practice\/words\?unit=[^&]+&mode=flashcard$/)
  // The unit's five started words, and no more.
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuemax', '5')
  for (let i = 0; i < 10 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
  await expect(heading(page)).toHaveText('Practice complete')
  await expect(page.getByText('You answered 5 words.')).toBeVisible()
  await page.getByRole('link', { name: 'Practise more' }).click()
  await expect(page.getByText('Unit: People and greetings')).toBeVisible()
  await page.getByRole('link', { name: 'Back to the path' }).click()
  await expect(heading(page)).toHaveText('Your path')
  // Five of the day's ten new words are still to come, so the path still offers the session.
  await expect(page.getByRole('link', { name: 'Start studying' })).toBeVisible()
})

test('practises a unit of a level the learner placed above, and the level stays skipped', async ({ browser }) => {
  // The app's service worker would serve the bundled all-A1 sample; this one has an A2 to declare.
  const context = await browser.newContext({ serviceWorkers: 'block' })
  forwardConsole(context)
  await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
  await serveTwoLevelSample(context)
  try {
    const page = await context.newPage()
    await page.goto('/')
    await finishSetupAt(page, 'A2 · Elementary')
    await expect(heading(page)).toHaveText('10 new words')
    await page.goto('/path')
    // A1 is folded: skipped, with nothing started in it.
    const a1 = page.getByRole('button', { name: /^A1/ })
    await expect(a1).toContainText('Skipped: you placed above this level.')
    await expect(a1).toHaveAttribute('aria-expanded', 'false')
    await a1.click()
    const unit = page.locator('li.unit', { has: page.getByRole('heading', { name: 'People and greetings' }) })
    await expect(unit.getByText('0 of 20 started')).toBeVisible()
    await expect(unit.getByRole('link', { name: 'Start studying' })).toHaveCount(0)
    await unit.getByRole('link', { name: 'Practise this unit: People and greetings' }).click()
    await expect(heading(page)).toHaveText('Practice')
    await expect(page.getByText('Unit: People and greetings')).toBeVisible()
    await expect(page.getByText('From a level you skipped: these words may be new to you.')).toBeVisible()
    await page.getByRole('link', { name: 'Flashcards' }).click()
    // A full run, from words that were never started.
    await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuemax', '10')
    for (let i = 0; i < 20 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
    await expect(heading(page)).toHaveText('Practice complete')
    await expect(page.getByText('You answered 10 words.')).toBeVisible()
    await expect(page.getByText(/^New unit open/)).toHaveCount(0)
    await page.getByRole('link', { name: 'Back to the path' }).click()
    await expect(heading(page)).toHaveText('Your path')
    // Nothing was started: the level reads as skipped, the unit as untouched, and the day's new words are all still to come.
    await expect(a1).toContainText('Skipped: you placed above this level.')
    await a1.click()
    await expect(unit.getByText('0 of 20 started')).toBeVisible()
    await expect(unit.getByRole('link', { name: 'Practise this unit: People and greetings' })).toBeVisible()
    await page.goto('/')
    await expect(heading(page)).toHaveText('10 new words')
  } finally {
    await context.close()
  }
})

test('chooses Learn this word while practising a skipped unit, and the next session starts with that word', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  forwardConsole(context)
  await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
  await serveTwoLevelSample(context)
  try {
    const page = await context.newPage()
    await page.goto('/')
    await finishSetupAt(page, 'A2 · Elementary')
    await page.goto('/path')
    await page.getByRole('button', { name: /^A1/ }).click()
    await page.getByRole('link', { name: 'Practise this unit: People and greetings' }).click()
    await page.getByRole('link', { name: 'Multiple choice' }).click()
    await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
    await page.waitForTimeout(SETTLE_MS)
    await page.keyboard.press('1')
    // The feedback step offers the word; its name says which one.
    const learn = page.getByRole('button', { name: /^Learn this word: / })
    await expect(learn).toBeVisible()
    const word = (await learn.getAttribute('aria-label'))!.replace('Learn this word: ', '')
    await expectAccessible(page, { dark: true })
    await learn.click()
    await expect(page.getByRole('button', { name: `Will be learned: ${word}` })).toBeVisible()
    await expectAccessible(page, { dark: true })
    await page.waitForTimeout(SETTLE_MS)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
    await page.getByRole('button', { name: 'Stop for now' }).click()
    await expect(heading(page)).toHaveText('Practice complete')
    await expect(page.getByText('1 word will come up in your next sessions.')).toBeVisible()
    // On the path the word is marked, and its level is still skipped.
    await page.getByRole('link', { name: 'Back to the path' }).click()
    const a1 = page.getByRole('button', { name: /^A1/ })
    await expect(a1).toContainText('Skipped: you placed above this level.')
    await a1.click()
    const unit = page.locator('li.unit', { has: page.getByRole('heading', { name: 'People and greetings' }) })
    await unit.getByText('20 words').click()
    const row = unit.locator('.unit-words li', { has: page.getByText(word, { exact: true }) })
    await expect(row.locator('.word-status')).toHaveText('To learn')
    await expectAccessible(page, { dark: true })
    // The word list takes the mark back and makes it again, without a round of practice.
    await row.getByRole('button', { name: `Word actions: ${word}` }).click()
    await expectAccessible(page, { dark: true })
    await row.getByRole('button', { name: `Don’t learn this word: ${word}` }).click()
    await expect(row.locator('.word-status')).toHaveCount(0)
    await row.getByRole('button', { name: `Word actions: ${word}` }).click()
    await row.getByRole('button', { name: `Learn this word: ${word}` }).click()
    await expect(row.locator('.word-status')).toHaveText('To learn')
    // Still ten new words today: the chosen one first, then the path's.
    await page.goto('/')
    await expect(heading(page)).toHaveText('10 new words')
    await page.goto('/study?mode=flashcard')
    await expect(page.locator('.card[data-mode="flashcard"] .hw-word')).toHaveText(word)
    await answer(page)
    await page.getByRole('button', { name: 'Stop for now' }).click()
    await page.goto('/path')
    await a1.click()
    await expect(a1).toContainText('Skipped: you placed above this level.')
    await expect(unit.getByText('1 of 20 started')).toBeVisible()
  } finally {
    await context.close()
  }
})

test('practises one theme from Themes, and comes back with the study theme as it was', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  // Five of the theme's words, brought forward by studying the theme for a while; then back to the path.
  await page.goto('/themes')
  const group = (name: string) => page.getByRole('region', { name })
  await expect(group('Studying now').getByText('No theme chosen. New words follow your path.')).toBeVisible()
  await group('Not started').getByRole('button', { name: 'Study this next: Daily life' }).click()
  // The card moves up to the first group, and focus goes with it.
  await expect(group('Studying now').getByRole('heading', { name: 'Daily life' })).toBeFocused()
  await expect(page.locator('.themes-page [role="status"]')).toHaveText('Now studying: Daily life')
  await expectAccessible(page, { dark: true })
  await studyNew(page, 5)
  await page.goto('/themes')
  await group('Studying now').getByRole('button', { name: 'Back to the path' }).click()
  await expect(group('Studied').getByRole('heading', { name: 'Daily life' })).toBeFocused()
  await expectAccessible(page, { dark: true })
  await page.getByRole('link', { name: 'Practise this theme: Daily life' }).click()
  await expect(heading(page)).toHaveText('Practice')
  await expect(page.getByText('Theme: Daily life')).toBeVisible()
  await page.getByRole('link', { name: 'Flashcards' }).click()
  await expect(page).toHaveURL(/\/practice\/words\?theme=daily-life&mode=flashcard$/)
  // A full run from the whole theme, though only five of its words are started.
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuemax', '10')
  for (let i = 0; i < 20 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
  await expect(heading(page)).toHaveText('Practice complete')
  await page.getByRole('link', { name: 'Practise more' }).click()
  await expect(page.getByText('Theme: Daily life')).toBeVisible()
  await page.getByRole('link', { name: 'Back to themes' }).click()
  await expect(heading(page)).toHaveText('Themes')
  // Practising a theme does not choose it.
  await expect(page.getByRole('region', { name: 'Studied' }).getByRole('button', { name: 'Study this next: Daily life' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Studying now' }).getByRole('heading', { level: 3 })).toHaveCount(0)
})

test('searches the themes for a word, and chooses a theme from what it finds', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/themes')
  const search = page.getByRole('searchbox', { name: 'Search themes' })
  await search.fill('key')
  const results = page.getByRole('region', { name: '1 theme found' })
  const card = results.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Daily life' }) })
  await expect(card.locator('.theme-matches')).toHaveText('key ключ')
  await expect(card.getByText('Not started')).toBeVisible()
  await expect(page.locator('.themes-page [role="status"]')).toHaveText('1 theme found')
  await expectAccessible(page, { dark: true })
  // Choosing from the results leaves them as they are; the card now says it is the one being studied.
  await card.getByRole('button', { name: 'Study this next: Daily life' }).click()
  await expect(results.getByRole('heading', { name: 'Daily life' })).toBeFocused()
  await expect(card.getByText('Studying now')).toBeVisible()
  // A word of the course that is in no theme is named all the same.
  await search.fill('teach')
  await expect(page.getByRole('heading', { name: 'No theme has “teach”.' })).toBeVisible()
  await expect(page.getByText('Also in the course, in no theme: teacher учител')).toBeVisible()
  await page.getByRole('button', { name: 'Show all themes' }).click()
  await expect(search).toHaveValue('')
  await expect(page.getByRole('region', { name: 'Studying now' }).getByRole('heading', { name: 'Daily life' })).toBeVisible()
})

test('practises a whole theme that is not started, chooses a word to learn, and takes the theme up from the done screen', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/themes')
  const group = (name: string) => page.getByRole('region', { name })
  const progress = page.getByRole('progressbar', { name: 'Session progress' })
  // Nothing is started: the theme can be chosen, or practised as it is.
  await expect(group('Not started').getByRole('button', { name: 'Study this next: Daily life' })).toBeVisible()
  await expect(group('Not started').getByText('0 of 25 words started')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await group('Not started').getByRole('link', { name: 'Practise this theme: Daily life' }).click()
  await expect(heading(page)).toHaveText('Practice')
  await expect(page.getByText('Theme: Daily life')).toBeVisible()
  await expect(page.getByText('This covers the whole theme, including words you have not started.')).toBeVisible()
  await expect(page.getByText('0 of 25 words seen')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByRole('link', { name: 'Flashcards' }).click()
  await expect(progress).toHaveAttribute('aria-valuemax', '10')
  // A word the learner never started says so, and can be chosen once its answer shows.
  await expect(page.locator('.card[data-phase="prompt"]').getByText('New to you')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.waitForTimeout(SETTLE_MS)
  await page.keyboard.press('Space')
  const learn = page.getByRole('button', { name: /^Learn this word: / })
  await expect(learn).toBeVisible()
  const word = (await learn.getAttribute('aria-label'))!.replace('Learn this word: ', '')
  await learn.click()
  await expect(page.getByRole('button', { name: `Will be learned: ${word}` })).toBeVisible()
  await expect(page.locator('.card[data-phase="revealed"]').getByText('New to you')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.waitForTimeout(SETTLE_MS)
  await page.keyboard.press('3')
  for (let i = 0; i < 20 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
  await expect(heading(page)).toHaveText('Practice complete')
  await expect(page.getByText('You answered 10 words.')).toBeVisible()
  await expect(page.getByText('1 word will come up in your next sessions.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Study this theme: Daily life' })).toBeVisible()
  await expectAccessible(page, { dark: true })
  // Practice started nothing and chose nothing: the theme stands where it stood.
  await page.getByRole('link', { name: 'Back to themes' }).click()
  await expect(group('Not started').getByText('0 of 25 words started')).toBeVisible()
  await expect(group('Studying now').getByRole('heading', { level: 3 })).toHaveCount(0)
  // The visit remembers the words it showed. The chosen word is one of today's new words now, which practice leaves to the session.
  await group('Not started').getByRole('link', { name: 'Practise this theme: Daily life' }).click()
  await expect(page.getByText('9 of 24 words seen · 1 in today’s session')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByRole('link', { name: 'Flashcards' }).click()
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await page.getByRole('button', { name: 'Stop for now' }).click()
  await expect(heading(page)).toHaveText('Practice complete')
  // "Study this theme" does what "Study this next" does, and the learner stays where they are.
  await page.getByRole('button', { name: 'Study this theme: Daily life' }).click()
  await expect(page.getByText('Now studying: Daily life')).toBeFocused()
  await expect(page.getByRole('button', { name: /^Study this theme/ })).toHaveCount(0)
  await expect(heading(page)).toHaveText('Practice complete')
  await expectAccessible(page, { dark: true })
  await page.getByRole('link', { name: 'Back to themes' }).click()
  await expect(group('Studying now').getByRole('heading', { name: 'Daily life' })).toBeVisible()
  await expect(group('Studying now').getByText('0 of 25 words started')).toBeVisible()
  await expect(group('Studying now').getByRole('link', { name: 'Practise this theme: Daily life' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Not started' })).toHaveCount(0)
  await expectAccessible(page, { dark: true })
  // Ten new words today, all the theme's; the chosen word comes first, and only once.
  await page.goto('/')
  await expect(heading(page)).toHaveText('10 new words')
  await page.goto('/study?mode=flashcard')
  await expect(page.locator('.card[data-mode="flashcard"] .hw-word')).toHaveText(word)
  const served = [word]
  await answer(page)
  for (let i = 1; i < 10; i += 1) {
    served.push((await page.locator('.card[data-phase="prompt"] .hw-word').textContent())!)
    await answer(page)
  }
  expect(new Set(served).size).toBe(10)
  await expect(heading(page)).toHaveText('Session complete')
})

test('Settings › About links to the privacy policy on the website, in the interface language', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/settings/about')
  await expect(page.getByRole('link', { name: 'Privacy policy', exact: true })).toHaveAttribute('href', 'https://wordado.com/en/privacy/')
})

test('Settings › About says the demo’s word list is Wordado’s own, from the bundled sample’s credits', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/settings/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expect(page.getByText('This word list was prepared by Wordado.')).toBeVisible()
})

// The demo has no server: the feedback request is answered here, first with a failure and then with success.
// Service workers are blocked, on the page's own context so a phone project keeps its screen: WebKit does not
// show a request the app's service worker passes on to `page.route`.
test.describe('feedback about the app (spec §8.12)', () => {
  test.use({ serviceWorkers: 'block' })

  test('is sent from the demo’s banner; a failed send keeps the text', async ({ page }) => {
    await page.goto('/')
    await finishSetup(page)
    await page.goto('/progress')
    const bodies: unknown[] = []
    let failing = true
    await page.route('**/v1/feedback', (route) => {
      if (failing) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"internal"}' })
      bodies.push(route.request().postDataJSON())
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
    })
    /** A finger's room (spec §11.1): at least 44 px each way. */
    const expectTapTarget = async (target: Locator) => {
      const box = (await target.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
    const open = page.getByRole('link', { name: 'Feedback', exact: true })
    await expectTapTarget(open)
    await open.click()
    await expect(heading(page)).toHaveText('Send feedback')
    // Nothing is sent unseen: the screen it was opened from is listed with the rest.
    const details = page.getByRole('list', { name: 'Sent with your message' })
    await expect(details.getByRole('listitem')).toHaveCount(5)
    await expect(details.getByText('Opened from: /progress')).toBeVisible()
    await expectAccessible(page, { dark: true })
    for (const kind of ['Something isn’t working', 'I have an idea', 'Something else']) await expectTapTarget(page.locator('.feedback-form .choices label', { hasText: kind }))
    await expectTapTarget(page.getByLabel('Your message', { exact: true }))
    await expectTapTarget(page.getByLabel('Email, if you’d like an answer (optional)'))
    const send = page.getByRole('button', { name: 'Send', exact: true })
    await expectTapTarget(send)
    // The field no person fills in takes no room and no focus.
    await expect(page.locator('input[name="website"]')).toHaveAttribute('tabindex', '-1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    await page.getByRole('radio', { name: 'I have an idea' }).check()
    await page.getByLabel('Your message', { exact: true }).fill('A dark theme, please.')
    await send.click()
    await expect(page.locator('.feedback-form [role="alert"]')).toHaveText('Wordado isn’t answering properly right now. Try again later.')
    await expect(page.getByLabel('Your message', { exact: true })).toHaveValue('A dark theme, please.')
    await expect(page.getByRole('radio', { name: 'I have an idea' })).toBeChecked()
    await expectAccessible(page, { dark: true })

    failing = false
    await send.click()
    const thanks = page.locator('.feedback-form [role="status"]')
    await expect(thanks).toHaveText('Thank you! We’ve got your message.')
    await expect(thanks).toBeFocused()
    expect(bodies).toEqual([
      {
        kind: 'idea',
        message: 'A dark theme, please.',
        email: '',
        appVersion: expect.stringMatching(/^[A-Za-z0-9_-]{6,}$/),
        corpusVersion: expect.stringMatching(/^bg-\d+$/),
        language: 'en',
        screen: '/progress',
        userAgent: await page.evaluate(() => navigator.userAgent),
        website: '',
      },
    ])
    await expectAccessible(page, { dark: true })
    const back = page.getByRole('link', { name: 'Back', exact: true })
    await expectTapTarget(back)
    await back.click()
    await expect(heading(page)).toHaveText('Progress')
  })
})

test('Settings › About leads to feedback about the app', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/settings/about')
  await page.getByRole('link', { name: 'Send feedback about the app' }).click()
  await expect(heading(page)).toHaveText('Send feedback')
  await expect(page.getByText('Opened from: /settings/about')).toBeVisible()
})

// Every screen is scanned, in two tests: one walk through every screen outgrew the 30 s test budget in Firefox
// on CI (each scan takes about a second there, light and dark). The study walk, the longer one, also keeps the
// slow timeout from #51 as a margin.
test('meets WCAG 2.2 A and AA on the study screens (spec §11.1)', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await finishSetup(page)
  await expect(heading(page)).toHaveText('10 new words')
  await expectAccessible(page)

  await page.goto('/study?mode=multiple_choice')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await expectAccessible(page)
  await page.waitForTimeout(SETTLE_MS)
  await page.keyboard.press('1')
  await expect(page.locator('.card[data-phase="feedback"]')).toBeVisible()
  await expectAccessible(page)
  await page.getByRole('button', { name: 'More' }).click()
  await expectAccessible(page)
  await page.getByRole('button', { name: 'Report a problem' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // The suggestion is asked for the translation, the field chosen first; it is as tall as any control (2.5.8).
  const suggestion = page.getByRole('textbox', { name: 'What should it be? (optional)' })
  await suggestion.fill('a better word')
  expect((await suggestion.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expectAccessible(page)
  await page.getByRole('radio', { name: 'Bad audio' }).check()
  await expect(suggestion).toBeHidden()
  await expectAccessible(page)
  await page.keyboard.press('Escape')

  await page.goto('/study?mode=flashcard')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await page.waitForTimeout(SETTLE_MS)
  await page.keyboard.press('Space')
  await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
  await expectAccessible(page)

  await studyNew(page, 5)
  await expectAccessible(page)
  for (const path of ['/path', '/themes', '/progress', '/practice', '/practice/matching']) {
    await page.goto(path)
    await expect(heading(page)).toBeVisible()
    await expectAccessible(page)
  }
  // Practice kept to one unit, as the path opens it.
  await page.goto('/path')
  await page.getByRole('link', { name: 'Practise this unit: People and greetings' }).click()
  await expect(page.getByText('Unit: People and greetings')).toBeVisible()
  await expectAccessible(page, { dark: true })

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/study?mode=multiple_choice')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await expectAccessible(page)
})

test('meets WCAG 2.2 A and AA on settings and sign-in, light and dark (spec §11.1)', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  for (const path of ['/settings', '/settings/study', '/settings/languages', '/settings/native-language', '/signin', '/settings/placement']) {
    await page.goto(path)
    await expect(heading(page)).toBeVisible()
    await expectAccessible(page, { dark: true })
  }
})

// Plan 10: a second L1 (German) beside Bulgarian, and changing the native language in Settings.

test('a German browser opens the demo in German, and a studied word’s translation is German', async ({ browser }) => {
  // A fresh context, not the English one `beforeEach` forces: no saved locale, so the interface follows
  // the browser's German (spec §11.2, plan 10 Decision 4), and the demo's L1 follows the interface.
  const context = await browser.newContext({ locale: 'de-DE' })
  forwardConsole(context)
  try {
    const page = await context.newPage()
    await page.goto('/')
    // The setup asks in German too, and preselects German; choosing it keeps the demo's words German.
    await expect(page.getByRole('radio', { name: 'Deutsch' })).toBeChecked()
    await finishSetup(page, 'Deutsch')
    await expect(heading(page)).toHaveText('10 neue Wörter')

    // Forcing the mode (as the mode-matrix tests above do) sidesteps the mode/direction randomness for a brand-new
    // word (core/src/modeSelection.ts): a flashcard always reveals the translation.
    await page.goto('/study?mode=flashcard')
    await expect(page.locator('.card')).toHaveAttribute('data-mode', 'flashcard')
    await page.waitForTimeout(SETTLE_MS)
    await page.keyboard.press('Space')
    await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
    await expect(page.locator('.card[data-phase="revealed"] .translation')).toHaveText('hallo')
  } finally {
    await context.close()
  }
})

test('changing the native language later, on its own page, keeps progress and switches translations', async ({ page }) => {
  // A word studied before the change (the demo's first word, "hello") stays counted afterwards.
  await page.goto('/')
  await finishSetup(page)
  await studyNew(page, 1)
  await page.goto('/path')
  await expect(page.getByText('1 of 20 started')).toBeVisible()

  // Settings › Languages › Change opens the setup's language page, as a Settings sub-page.
  await page.goto('/settings/languages')
  await page.getByRole('link', { name: 'Change native language' }).click()
  await expect(page).toHaveURL('/settings/native-language')
  // A navigation focuses the new screen, as every routed page does (App.tsx); the setup's steps focus their heading.
  await expect(page.locator('#main')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Native language', level: 2 })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Български' })).toBeChecked()
  await page.getByRole('radio', { name: 'Deutsch' }).check()
  await expect(page.getByText('Your progress stays. The words switch to German translations.')).toBeVisible()
  await page.getByRole('button', { name: 'Change', exact: true }).click()

  // The page installs the German pack before it returns, so the very next flashcard is German. The interface was
  // English, not the old native language, so it stays English (spec §8.6).
  await expect(page).toHaveURL('/settings/languages')
  await expect(page.getByRole('region', { name: 'Native language' }).getByText('Deutsch', { exact: true })).toBeVisible()
  // Forcing the mode sidesteps the mode/direction randomness for a new word: a flashcard always reveals the
  // translation. The next new word is "goodbye".
  await page.goto('/study?mode=flashcard')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await page.waitForTimeout(SETTLE_MS)
  await page.keyboard.press('Space')
  await expect(page.locator('.card[data-phase="revealed"] .translation')).toHaveText('auf Wiedersehen')

  // Progress from before the change is still here: studying the new word above didn't rate it, so the count
  // of started words in the first unit is unchanged.
  await page.goto('/path')
  await expect(page.getByText('1 of 20 started')).toBeVisible()
})

// Plan 12: a third L1 (Spanish) beside Bulgarian and German, and changing to it in Settings.

test('a Spanish browser opens the demo in Spanish, and a studied word’s translation is Spanish', async ({ browser }) => {
  // A fresh context, not the English one `beforeEach` forces: no saved locale, so the interface follows
  // the browser's Spanish (spec §11.2, plan 10 Decision 4), and the demo's L1 follows the interface.
  const context = await browser.newContext({ locale: 'es-ES' })
  forwardConsole(context)
  try {
    const page = await context.newPage()
    await page.goto('/')
    // The setup asks in Spanish too, and preselects Spanish.
    await expect(page.getByRole('heading', { name: '¿Qué idioma hablas?', level: 2 })).toBeFocused()
    await expect(page.getByRole('radio', { name: 'Español' })).toBeChecked()
    await expectAccessible(page)
    await finishSetup(page, 'Español')
    await expect(heading(page)).toHaveText('10 palabras nuevas')

    // Forcing the mode (as the mode-matrix tests above do) sidesteps the mode/direction randomness for a brand-new
    // word (core/src/modeSelection.ts): a flashcard always reveals the translation.
    await page.goto('/study?mode=flashcard')
    await expect(page.locator('.card')).toHaveAttribute('data-mode', 'flashcard')
    await page.waitForTimeout(SETTLE_MS)
    await page.keyboard.press('Space')
    await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
    await expect(page.locator('.card[data-phase="revealed"] .translation')).toHaveText('hola')
  } finally {
    await context.close()
  }
})

test('changing the native language to Spanish keeps progress, switches translations, and narrows the language menu', async ({ page }) => {
  // A word studied before the change (the demo's first word, "hello") stays counted afterwards.
  await page.goto('/')
  await finishSetup(page)
  await studyNew(page, 1)
  await page.goto('/path')
  await expect(page.getByText('1 of 20 started')).toBeVisible()

  // Settings › Languages › Change opens the setup's language page, as a Settings sub-page.
  await page.goto('/settings/languages')
  await page.getByRole('link', { name: 'Change native language' }).click()
  await expect(page).toHaveURL('/settings/native-language')
  await expect(page.locator('#main')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Native language', level: 2 })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Български' })).toBeChecked()
  await page.getByRole('radio', { name: 'Español' }).check()
  await expect(page.getByText('Your progress stays. The words switch to Spanish translations.')).toBeVisible()
  await page.getByRole('button', { name: 'Change', exact: true }).click()

  // The page installs the Spanish pack before it returns, so the very next flashcard is Spanish. The interface
  // was English, not the old native language, so it stays English (spec §8.6).
  await expect(page).toHaveURL('/settings/languages')
  await expect(page.getByRole('region', { name: 'Native language' }).getByText('Español', { exact: true })).toBeVisible()
  // Forcing the mode sidesteps the mode/direction randomness for a new word: a flashcard always reveals the
  // translation. The next new word is "goodbye".
  await page.goto('/study?mode=flashcard')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await page.waitForTimeout(SETTLE_MS)
  await page.keyboard.press('Space')
  await expect(page.locator('.card[data-phase="revealed"] .translation')).toHaveText('adiós')

  // Progress from before the change is still here: studying the new word above didn't rate it, so the count
  // of started words in the first unit is unchanged.
  await page.goto('/path')
  await expect(page.getByText('1 of 20 started')).toBeVisible()

  // The header's language menu now offers only the learner's L1 (Español) and English.
  await page.goto('/')
  await page.getByRole('button', { name: 'Interface language: English (EN)' }).click()
  await expect(page.getByRole('button', { name: 'Español', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deutsch', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Български', exact: true })).toHaveCount(0)
})

// Plan 11: a new demo opens in the first-run setup.

test('a first visit opens the setup; choosing German ends on Home with German translations', async ({ page }) => {
  await page.goto('/')
  await expect(heading(page)).toHaveText('Set up Wordado')
  const language = page.getByRole('heading', { name: 'Which language do you speak?', level: 2 })
  await expect(language).toBeFocused()
  // Preselected from the interface's language; an English interface has no L1 of its own, so Bulgarian.
  await expect(page.getByRole('radio', { name: 'Български' })).toBeChecked()
  // The setup is no place to wander off from: no navigation until it is done.
  await expect(page.locator('.nav')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Deutsch' }).check()
  await page.getByRole('button', { name: 'Continue' }).click()

  // The demo has one level, so the Level step is skipped and the Theme step follows.
  await expect(page.getByRole('heading', { name: 'What do you want English for?', level: 2 })).toBeFocused()
  await expect(page.getByText(/^Step 2 of \d$/)).toBeVisible()
  await page.getByRole('button', { name: 'Start studying' }).click()

  await expect(page).toHaveURL('/')
  await expect(today(page)).toHaveText('10 new words')
  await expect(page.locator('.nav')).toBeVisible()
  await page.goto('/study?mode=flashcard')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await page.waitForTimeout(SETTLE_MS)
  await page.keyboard.press('Space')
  await expect(page.locator('.card[data-phase="revealed"] .translation')).toHaveText('hallo')
})

test('after the setup, a reload opens Home, not the setup', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.reload()
  await expect(today(page)).toHaveText('10 new words')
  await expect(page.getByRole('heading', { name: 'Set up Wordado' })).toHaveCount(0)
})

test('“I already have an account” leads from the setup to Sign in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Which language do you speak?' })).toBeVisible()
  await page.getByRole('link', { name: 'I already have an account' }).click()
  await expect(page).toHaveURL('/signin')
  await expect(heading(page)).toHaveText('Create an account or sign in')
})

test('the setup’s Language and Theme steps meet WCAG 2.2 A and AA, light and dark (spec §11.1)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Which language do you speak?' })).toBeFocused()
  await expectAccessible(page, { dark: true })
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'What do you want English for?' })).toBeFocused()
  await expectAccessible(page, { dark: true })
})

for (const width of [390, 1280]) {
  test(`the language pages never scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await finishSetup(page)
    for (const path of ['/settings/languages', '/settings/native-language']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Native language', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true)
    }
  })
}
