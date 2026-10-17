import { expect, test, type Locator } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { answer, expectAccessible, finishSetup, finishSetupAt, forwardConsole, heading, sampleEntries, serveGlossedSample, serveTrialSample, serveTwoLevelSample, SETTLE_MS, studyNew, today } from './helpers'

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
  // The unit being studied was open already: the screen announces no unit.
  await expect(page.getByText(/^New unit open/)).toHaveCount(0)
  await page.getByRole('link', { name: 'Done', exact: true }).click()
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

// A phone's visible screen with the browser's bars on it (#269): the exercise is one screen, with nothing to scroll to.
test.describe('an exercise on a phone', () => {
  test.use({ viewport: { width: 390, height: 664 } })
  /** How far the page reaches below the screen: 0 when there is nothing to scroll to. */
  const below = (page: import('@playwright/test').Page) => page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight))

  test('a multiple-choice question, its result and Continue are on one screen, and the answers keep their place', async ({ page }) => {
    await page.goto('/')
    await finishSetup(page)
    await page.goto('/study?mode=multiple_choice')
    const prompt = page.locator('.card[data-phase="prompt"]')
    const options = page.locator('button.option')
    const sheet = page.locator('.feedback-sheet')
    const entries = sampleEntries()
    // A right answer, then a wrong one: which is which is read from the sample, so each is met once.
    for (const give of ['right', 'wrong'] as const) {
      await expect(prompt).toBeVisible()
      await page.waitForTimeout(SETTLE_MS)
      await expect(options).toHaveCount(4)
      expect(await below(page)).toBe(0)
      for (const option of await options.all()) await expect(option).toBeInViewport({ ratio: 1 })
      // Either direction: the word and its translation are the question and one of the answers.
      const asked = (await prompt.locator('.hw-word, .prompt-text .translation-word').textContent())!
      const texts = await options.locator('.option-text').evaluateAll((els) => els.map((el) => (el.querySelector('.translation-word') ?? el).textContent ?? ''))
      const right = texts.findIndex((text) => entries.some((e) => (e.headword === asked && e.translation === text) || (e.translation === asked && e.headword === text)))
      expect(right).toBeGreaterThanOrEqual(0)
      const chosen = options.nth(give === 'right' ? right : (right + 1) % 4)
      const before = (await options.first().boundingBox())!.y
      await chosen.click()
      await expect(sheet).toHaveClass(give === 'right' ? /is-correct/ : /is-incorrect/)
      // The result is under the answers, where its place was kept: they have not moved.
      expect(Math.abs((await options.first().boundingBox())!.y - before)).toBeLessThan(1)
      await expect(sheet).toBeInViewport({ ratio: 1 })
      expect(await below(page)).toBe(0)
      if (give === 'wrong') {
        const next = page.getByRole('button', { name: 'Continue' })
        await expect(next).toBeInViewport({ ratio: 1 })
        // Beside the message, not under it.
        const [message, button] = [(await sheet.locator('.feedback').boundingBox())!, (await next.boundingBox())!]
        expect(button.x).toBeGreaterThanOrEqual(message.x + message.width - 1)
        expect(button.height).toBeGreaterThanOrEqual(44)
      }
    }
  })

  test('a flashcard, its answer and the four ratings are on one screen', async ({ page }) => {
    await page.goto('/')
    await finishSetup(page)
    await page.goto('/study?mode=flashcard')
    await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
    await page.waitForTimeout(SETTLE_MS)
    expect(await below(page)).toBe(0)
    await page.getByRole('button', { name: 'Show answer' }).click()
    await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
    for (const rating of await page.locator('button.rating').all()) await expect(rating).toBeInViewport({ ratio: 1 })
    expect(await below(page)).toBe(0)
  })
})

test('listening cards play on one audio element, which the first tap started (issue 266)', async ({ page }) => {
  // A phone lets a clip start by itself only on an element a tap has started: every play is recorded with its element.
  await page.addInitScript(() => {
    const seen: HTMLMediaElement[] = []
    const plays: { element: number; silence: boolean }[] = []
    ;(window as unknown as { plays: typeof plays }).plays = plays
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!seen.includes(this)) seen.push(this)
      plays.push({ element: seen.indexOf(this), silence: this.src.startsWith('data:audio/wav') })
      return play.call(this)
    }
  })
  await page.goto('/')
  await finishSetup(page)
  const plays = () => page.evaluate(() => (window as unknown as { plays: { element: number; silence: boolean }[] }).plays)
  // The setup's own taps started the element, on silence, before any clip.
  expect((await plays())[0]).toEqual({ element: 0, silence: true })
  // By the app's own link: a new document would start over.
  await page.getByRole('link', { name: 'Listening' }).click()
  await expect(page.locator('.card')).toHaveAttribute('data-mode', 'listening_select')
  await answer(page)
  await answer(page)
  await expect.poll(async () => (await plays()).filter((p) => !p.silence).length).toBeGreaterThanOrEqual(2)
  expect(new Set((await plays()).map((p) => p.element))).toEqual(new Set([0]))
})

test('a screen opens at its top, with the way to sign in in view: after the setup and after each tab (#262)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/')
  await finishSetup(page)
  const signIn = page.getByRole('link', { name: 'Sign in', exact: true })
  const atTop = async () => {
    await expect(signIn).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  }
  await atTop()
  for (const [tab, title] of [
    ['Path', 'Your path'],
    ['Themes', 'Themes'],
    ['Progress', 'Progress'],
    ['Settings', 'Settings'],
  ] as const) {
    // From further down the screen before, as a learner who has read it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: tab }).click()
    await expect(heading(page)).toHaveText(title)
    // The screen still takes focus, as a page load would (spec §11.1).
    await expect(page.locator('main')).toBeFocused()
    await atTop()
  }
})

test('a flashcard’s answer: the gloss on its own row under the translation, without brackets', async ({ browser }) => {
  const GLOSS = 'for the test'
  const context = await browser.newContext({ serviceWorkers: 'block' })
  forwardConsole(context)
  await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
  await serveGlossedSample(context, GLOSS)
  try {
    const page = await context.newPage()
    await page.goto('/')
    await finishSetup(page)
    await page.goto('/study?mode=flashcard')
    await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
    await page.waitForTimeout(SETTLE_MS)
    await page.keyboard.press('Space')
    const word = page.locator('.revealed .translation-word')
    const gloss = page.locator('.revealed .sense')
    await expect(gloss).toHaveText(GLOSS)
    await expect(page.locator('.revealed .prompt-text')).not.toContainText('(')
    const wordBox = (await word.boundingBox())!
    const glossBox = (await gloss.boundingBox())!
    expect(glossBox.y).toBeGreaterThanOrEqual(wordBox.y + wordBox.height - 1)
    // Both centred in the card, one over the other.
    expect(Math.abs(wordBox.x + wordBox.width / 2 - (glossBox.x + glossBox.width / 2))).toBeLessThan(2)
    await expectAccessible(page, { dark: true })
  } finally {
    await context.close()
  }
})

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
      // Asked again, the same word draws its direction afresh. Answering would use the session up: ten words, and a
      // run of one direction has ended it before the checks below (seen once in CI, on Firefox).
      if (seen.size < 2) await page.goto('/study?mode=multiple_choice')
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
    await page.getByRole('link', { name: 'Done', exact: true }).click()
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

test('starts the session from the current unit’s play mark on the path', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/path')
  await expectAccessible(page, { dark: true })
  const mark = page.locator('li.unit-current .unit-track a.unit-marker')
  // As large as any control (2.5.8).
  const box = (await mark.boundingBox())!
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44)
  await mark.click()
  await expect(page).toHaveURL(/\/study$/)
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toBeVisible()
})

test('practises one unit from the path, finishes, and comes back to the path', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await studyNew(page, 5)
  await page.goto('/path')
  await page.getByRole('link', { name: 'Practise this unit: People and greetings' }).click()
  await expect(heading(page)).toHaveText('Practice')
  await expect(page.getByText('Unit: People and greetings')).toBeVisible()
  // The unit is practised whole: five of its words are started, the rest are not.
  await expect(page.getByText('This covers the whole unit, including words you have not started.')).toBeVisible()
  await page.getByRole('link', { name: 'Flashcards' }).click()
  await expect(page).toHaveURL(/\/practice\/words\?unit=[^&]+&mode=flashcard$/)
  // A full run, drawn from all the unit's words.
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuemax', '10')
  for (let i = 0; i < 20 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
  await expect(heading(page)).toHaveText('Practice complete')
  await expect(page.getByText('You answered 10 words.')).toBeVisible()
  await page.getByRole('link', { name: 'Practise more' }).click()
  await expect(page.getByText('Unit: People and greetings')).toBeVisible()
  await page.getByRole('link', { name: 'Back to the path' }).click()
  await expect(heading(page)).toHaveText('Your path')
  // Five of the day's ten new words are still to come, so the path still offers the session.
  await expect(page.getByRole('link', { name: 'Start studying' })).toBeVisible()
})

test('practises a unit that is still locked, and it stays locked', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/path')
  const unit = page.locator('li.unit', { has: page.getByRole('heading', { level: 3, name: 'Food and drink' }) })
  await expect(unit.getByText('Locked')).toBeVisible()
  await unit.getByRole('link', { name: 'Practise this unit: Food and drink' }).click()
  await expect(heading(page)).toHaveText('Practice')
  await expect(page.getByText('Unit: Food and drink')).toBeVisible()
  await expect(page.getByText('This covers the whole unit, including words you have not started.')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByRole('link', { name: 'Flashcards' }).click()
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuemax', '10')
  // None of its words is started: each card says so.
  await expect(page.getByText('New to you')).toBeVisible()
  for (let i = 0; i < 20 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
  await expect(heading(page)).toHaveText('Practice complete')
  await expect(page.getByText(/^New unit open/)).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to the path' }).click()
  // Practice started nothing and opened nothing.
  await expect(unit.getByText('Locked')).toBeVisible()
  await expect(page.getByText('0 of 60 words learned well')).toBeVisible()
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
  // The first option may be the right one, and a right answer moves on after a second (#264): too soon to look the
  // card over here. With the setting off, the answer waits either way.
  await context.addInitScript(() => localStorage.setItem('wordado.autoContinue', 'off'))
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

test('searches the whole course from the top row, and goes from a result to its unit and back', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.getByRole('link', { name: 'Search', exact: true }).click()
  await expect(heading(page)).toHaveText('Search')
  const field = page.getByRole('searchbox', { name: 'Search the course' })
  await expect(field).toBeFocused()
  // Pressed again on the empty search, the button gives the cursor back to the field.
  await field.blur()
  await page.getByRole('link', { name: 'Search', exact: true }).click()
  await expect(field).toBeFocused()
  // Typing rewrites the address and never takes the cursor from the field.
  await field.pressSequentially('teach')
  await expect(field).toBeFocused()
  await expect(page).toHaveURL(/\/search\?q=teach$/)
  await expect(page.locator('.search-page [role="status"]')).toHaveText('1 word')
  const row = page.locator('.search-words > li').filter({ hasText: 'teacher' })
  await expect(row).toHaveCount(1)
  await expectAccessible(page, { dark: true })
  // The unit link opens the path at that unit, its words open and its heading focused.
  const unitLink = row.locator('.word-where a').first()
  const title = (await unitLink.textContent())!.trim()
  await unitLink.click()
  await expect(heading(page)).toHaveText('Your path')
  await expect(page).toHaveURL(/\/path\?unit=/)
  const unit = page.getByRole('heading', { level: 3, name: title })
  await expect(unit).toBeFocused()
  const words = page.locator('li.unit', { has: unit }).locator('details')
  await expect(words).toHaveAttribute('open', '')
  // Folded, left for the plain path and come back to: the same unit opens a second time.
  await words.locator('summary').click()
  await expect(words).not.toHaveAttribute('open', '')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Path' }).click()
  await expect(page).toHaveURL(/\/path$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/path\?unit=/)
  await expect(words).toHaveAttribute('open', '')
  await expect(unit).toBeFocused()
  await expect(unit).toBeInViewport()
  // Back: the same query and the same result.
  await page.goBack()
  await expect(field).toHaveValue('teach')
  await expect(row).toHaveCount(1)
})

test('reports a problem with a word from a list: the search and a unit’s words on the path (spec §8.10)', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/search?q=key')
  const found = page.locator('.search-words > li').filter({ hasText: 'ключ' })
  const menu = found.getByRole('button', { name: 'Word actions: key' })
  await menu.click()
  // Last in the menu, after the choices about learning the word.
  await expect(found.locator('.menu-panel button').last()).toHaveText('Report this word')
  await expectAccessible(page, { dark: true })
  await found.getByRole('button', { name: 'Report this word: key' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Report a problem with “key”')
  await expectAccessible(page, { dark: true })
  await dialog.getByRole('radio', { name: 'Wrong level' }).check()
  await dialog.getByRole('button', { name: 'Send report' }).click()
  await expect(dialog.getByText('Report saved. Thank you.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Continue' }).click()
  // The dialog gives focus back to the word's ⋯ button.
  await expect(dialog).toHaveCount(0)
  await expect(menu).toBeFocused()

  await page.goto('/path')
  const unit = page.locator('li.unit', { has: page.getByRole('heading', { name: 'People and greetings' }) })
  await unit.getByText('20 words').click()
  const row = unit.locator('.unit-words li').first()
  await row.getByRole('button', { name: /^Word actions: / }).click()
  await row.getByRole('button', { name: /^Report this word: / }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(row.getByRole('button', { name: /^Word actions: / })).toBeFocused()
})

test('marks a found word to learn, follows its theme, and says when the sample has no such word', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/search?q=key')
  const row = page.locator('.search-words > li').filter({ hasText: 'ключ' })
  await row.getByRole('button', { name: 'Word actions: key' }).click()
  await row.getByRole('button', { name: 'Learn this word: key' }).click()
  // The mark is on the row before the menu is opened again.
  await expect(row.locator('.word-status')).toHaveText('To learn')
  await row.getByRole('button', { name: 'Word actions: key' }).click()
  await expect(row.getByRole('button', { name: 'Don’t learn this word: key' })).toBeVisible()
  await page.keyboard.press('Escape')
  await row.getByRole('link', { name: 'Daily life' }).click()
  await expect(heading(page)).toHaveText('Daily life')
  await page.goto('/search?q=zebra')
  await expect(page.locator('.search-page [role="status"]')).toHaveText('No word in the course matches “zebra”.')
  await expect(page.getByText('The sample has 60 words. Sign in to search the whole course.')).toBeVisible()
})

test('the demo banner’s three actions sit on one line of text', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  const middles = await page.locator('.banner-actions > *').evaluateAll((actions) =>
    actions.map((action) => {
      // The text itself, not the box around it: one of the three has a finger's room around its word.
      const range = document.createRange()
      range.selectNodeContents(action)
      const r = range.getBoundingClientRect()
      return (r.top + r.bottom) / 2
    }),
  )
  expect(middles).toHaveLength(3)
  for (const middle of middles) expect(Math.abs(middle - middles[0]!)).toBeLessThanOrEqual(1)
})

test('fits the top row on a narrow phone while signed out', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 })
  await page.goto('/')
  await finishSetup(page)
  const row = page.locator('.masthead-top')
  const box = (await row.boundingBox())!
  // One line of controls: the row is no taller than a control and its padding, and nothing reaches past its edge.
  expect(box.height).toBeLessThan(80)
  for (const control of [page.getByRole('link', { name: 'Search', exact: true }), page.getByRole('button', { name: 'Help', exact: true }), page.getByRole('link', { name: 'Sign in' })]) {
    const b = (await control.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(box.x)
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
    expect(b.height).toBeLessThan(50)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.goto('/search?q=te')
  await expectAccessible(page)
})

test('does not scroll sideways in the first-run setup in Spanish on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 })
  await page.goto('/')
  await page.getByRole('button', { name: /^Interface language/ }).click()
  await page.getByRole('button', { name: 'Español', exact: true }).click()
  await expect(page.getByRole('heading', { name: '¿Qué idioma hablas?', level: 2 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

for (const [locale, l1] of [
  ['es-ES', 'Español'],
  ['de-DE', 'Deutsch'],
] as const) {
  test(`fits the top row on a narrow phone while signed out, in ${l1}`, async ({ browser }) => {
    const context = await browser.newContext({ locale, viewport: { width: 360, height: 720 } })
    forwardConsole(context)
    try {
      const page = await context.newPage()
      await page.goto('/')
      await finishSetup(page, l1)
      const box = (await page.locator('.masthead-top').boundingBox())!
      expect(box.height).toBeLessThan(80)
      for (const control of [page.locator('.search-circle'), page.locator('.help-circle'), page.locator('.account-signin')]) {
        const b = (await control.boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(box.x)
        expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
        expect(b.height).toBeLessThan(50)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      // On a wider phone too, where the name is shown once there is room for it: "Sign in" keeps a margin (#275).
      for (const width of [400, 412, 430, 456]) {
        await page.setViewportSize({ width, height: 720 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        const signIn = (await page.locator('.account-signin').boundingBox())!
        expect(signIn.x + signIn.width).toBeLessThanOrEqual(width - 8)
      }
      await page.setViewportSize({ width: 360, height: 720 })
      // Help is not the last button: its panel stays on the screen beside the long "Sign in" of this language (#243).
      await page.locator('.help-circle').click()
      const panel = (await page.locator('.help-panel').boundingBox())!
      expect(panel.x).toBeGreaterThanOrEqual(0)
      expect(panel.x + panel.width).toBeLessThanOrEqual(360)
      // The tab bar's labels stay apart, on the tab with the longest label too, where it is bold (#247).
      await page.goto('/settings')
      await expect(page.locator('.nav a[aria-current="page"] span')).toBeVisible()
      for (const width of [360, 320]) {
        await page.setViewportSize({ width, height: 720 })
        const labels = await page.locator('.nav a span').evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })))
        // A long note on a Settings row is cut short; it does not widen the page.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        expect(labels).toHaveLength(5)
        expect(labels[0]!.left).toBeGreaterThanOrEqual(0)
        expect(labels[4]!.right).toBeLessThanOrEqual(width)
        for (let i = 1; i < labels.length; i++) expect(labels[i]!.left - labels[i - 1]!.right).toBeGreaterThanOrEqual(4)
      }
    } finally {
      await context.close()
    }
  })
}

test('opens a theme’s page from Themes, reads its words, finds one and chooses the theme', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/themes')
  await page.getByRole('link', { name: 'Daily life', exact: true }).click()
  await expect(page).toHaveURL(/\/themes\/daily-life$/)
  await expect(heading(page)).toHaveText('Daily life')
  // Still under Themes in the menu.
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Themes' })).toHaveAttribute('aria-current', 'page')
  const level = page.getByRole('button', { name: /^A1/ })
  await expect(level).toHaveAttribute('aria-expanded', 'true')
  await expect(level).toContainText('0 of 25 words started')
  const rows = page.locator('.theme-words > li')
  await expect(rows).toHaveCount(25)
  await expect(rows.first()).toContainText('breakfast')
  await expectAccessible(page, { dark: true })
  // A word far along the path can be marked to learn from here.
  const key = rows.filter({ hasText: 'ключ' })
  await key.getByRole('button', { name: 'Word actions: key' }).click()
  await key.getByRole('button', { name: 'Learn this word: key' }).click()
  // The row's mark says so; the menu closes on the change, and names the standing too while it is still open.
  await expect(key.locator('.word-status[data-status="to-learn"]')).toHaveText('To learn')
  await expect(key.getByRole('button', { name: 'Learn this word: key' })).toHaveCount(0)
  // The word search gives one list in place of the levels.
  const search = page.getByRole('searchbox', { name: 'Find a word in this theme' })
  await search.fill('маса')
  await expect(page.getByRole('heading', { name: '1 word found' })).toBeVisible()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('table')
  await expectAccessible(page, { dark: true })
  await search.press('Escape')
  await expect(rows).toHaveCount(25)
  await page.getByRole('button', { name: 'Study this next' }).click()
  await expect(heading(page)).toBeFocused()
  await expect(page.locator('.theme-page [role="status"]')).toHaveText('Now studying: Daily life')
  await page.getByRole('link', { name: 'Back to themes' }).click()
  await expect(page.getByRole('region', { name: 'Studying now' }).getByRole('heading', { name: 'Daily life' })).toBeVisible()
  // An address that names no theme on offer shows the themes.
  await page.goto('/themes/nonsense')
  await expect(heading(page)).toHaveText('Themes')
})

test('practises a whole theme that is not started, chooses a word to learn, and takes the theme up from the done screen', async ({ page }) => {
  // The longest test of the suite: three sessions of ten answers and eight accessibility scans. It takes 19 s on a
  // Mac and came to the 30 s limit on CI's Firefox and WebKit, still answering, with no step stuck (issue #194:
  // 12 s of it are the waits before each key, 6 s the scans). So it has twice the time, not less to check.
  test.setTimeout(60_000)
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

test('Settings has a Help row that opens the guide on the website in a new tab; offline it is no link (#224)', async ({ page, context }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/settings')
  const help = page.getByRole('link', { name: /^Help/ })
  await expect(help).toHaveAttribute('href', 'https://wordado.com/en/guide/')
  await expect(help).toHaveAttribute('target', '_blank')
  await context.setOffline(true)
  await expect(page.getByText('Help needs an internet connection')).toBeVisible()
  await expect(help).toHaveCount(0)
  await context.setOffline(false)
  await expect(help).toBeVisible()
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
    const open = page.getByRole('link', { name: 'Write to us', exact: true })
    await expectTapTarget(open)
    await open.click()
    await expect(heading(page)).toHaveText('Write to us')
    // Nothing is sent unseen: the screen it was opened from is listed with the rest.
    const details = page.getByRole('list', { name: 'Sent with your message' })
    await expect(details.getByRole('listitem')).toHaveCount(5)
    await expect(details.getByText('Opened from: /progress')).toBeVisible()
    await expect(page.getByText('Please don’t write personal details about yourself or other people.')).toBeVisible()
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

test('Help in the top row leads to the guide’s page about the screen and to the form (#243)', async ({ page }) => {
  await page.goto('/')
  // Not during the setup: the language button stands there instead.
  await expect(page.getByRole('button', { name: /^Interface language/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toHaveCount(0)
  await finishSetup(page)
  await expect(page.getByRole('button', { name: /^Interface language/ })).toHaveCount(0)
  const help = page.getByRole('button', { name: 'Help', exact: true })
  await help.click()
  const about = page.getByRole('link', { name: 'About this screen Your first session' })
  await expect(about).toHaveAttribute('href', 'https://wordado.com/en/guide/first-session/')
  await expect(about).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('link', { name: 'All help topics' })).toHaveAttribute('href', 'https://wordado.com/en/guide/')
  await expect(page.getByRole('list', { name: 'Interface language' }).getByRole('button')).toHaveText(['Български', 'English'])
  // The open panel alone: on a phone it lies over part of the banner's small buttons, and what is left of one
  // under it is no target to measure.
  await expectAccessible(page, { dark: true, within: '.help' })
  await page.locator('.help-panel').getByRole('link', { name: 'Write to us', exact: true }).click()
  await expect(heading(page)).toHaveText('Write to us')
  await expect(page.getByText('Opened from: /')).toBeVisible()
  await expect(page.locator('.help-panel')).toHaveCount(0)
})

test('Settings › About leads to feedback about the app', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/settings/about')
  await page.getByRole('link', { name: 'Write to us about the app' }).click()
  await expect(heading(page)).toHaveText('Write to us')
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
  await page.getByRole('button', { name: 'Report this word' }).click()
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

  // The Help menu's languages now are only the learner's L1 (Español) and English.
  await page.goto('/')
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Español', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deutsch', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Български', exact: true })).toHaveCount(0)
})

// Plan 11: a new demo opens in the first-run setup.

test('the setup’s level step offers the placement test; its result comes back to the step as the chosen level (spec §7.2)', async ({ browser }, testInfo) => {
  // The app's service worker would serve the bundled all-A1 sample, which has no level to choose and no test.
  const context = await browser.newContext({ serviceWorkers: 'block', ...(testInfo.project.use.viewport ? { viewport: testInfo.project.use.viewport } : {}) })
  forwardConsole(context)
  await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
  await serveTwoLevelSample(context)
  try {
    const page = await context.newPage()
    await page.goto('/')
    await page.getByRole('radio', { name: 'Български' }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    const step = page.getByRole('heading', { name: 'Your English level' })
    await expect(step).toBeVisible()
    await expect(page.getByText('Not sure? A short test of about twenty words finds your level.')).toBeVisible()
    await expectAccessible(page, { dark: true })
    await page.getByRole('button', { name: 'Find your level with a short test' }).click()
    // The whole screen, as from Settings: no top row, and the way back is the setup.
    await expect(page.getByRole('heading', { name: 'Find your level' })).toBeVisible()
    await expect(page.locator('.masthead')).toHaveCount(0)
    // On a phone the question, its four answers and "I don’t know" are one screen (#269).
    if ((page.viewportSize()?.width ?? 1280) < 640) {
      await expect(page.getByRole('button', { name: 'I don’t know' })).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)
    }
    await page.getByRole('button', { name: 'Back to the setup' }).click()
    await expect(step).toBeFocused()
    await expect(page.getByRole('radio', { name: 'A1 · Beginner' })).toBeChecked()
    // Again, to the end: knowing no word places at A1, over the A2 that was chosen by hand.
    await page.getByRole('radio', { name: 'A2 · Elementary' }).click()
    await expect(page.getByRole('radio', { name: 'A2 · Elementary' })).toBeChecked()
    await page.getByRole('button', { name: 'Find your level with a short test' }).click()
    const result = page.getByRole('heading', { name: 'Your level: A1' })
    for (let i = 0; i < 40 && !(await result.isVisible()); i += 1) {
      const count = await page.locator('.study-count').textContent()
      // An answer given before the question has settled is not taken.
      await page.waitForTimeout(SETTLE_MS)
      await page.getByRole('button', { name: 'I don’t know' }).click()
      await expect(page.locator('.study-count').or(result).first()).not.toHaveText(count ?? '')
    }
    await expect(result).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keep A2' })).toBeVisible()
    await page.getByRole('button', { name: 'Use A1' }).click()
    await expect(step).toBeFocused()
    await expect(page.locator('.masthead')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'A1 · Beginner' })).toBeChecked()
    await expect(page.getByRole('status').filter({ hasText: 'The test placed you at A1. You can still change it.' })).toBeVisible()
    await expectAccessible(page, { dark: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Start studying' }).click()
    await expect(today(page)).toBeVisible()
  } finally {
    await context.close()
  }
})

test('the test’s own address leads a new visitor through the language into the test, then to the level step; later it opens the test (#213)', async ({ browser }, testInfo) => {
  // The app's service worker would serve the bundled all-A1 sample, which has no level to choose and no test.
  const context = await browser.newContext({ serviceWorkers: 'block', ...(testInfo.project.use.viewport ? { viewport: testInfo.project.use.viewport } : {}) })
  forwardConsole(context)
  await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
  await serveTwoLevelSample(context)
  try {
    const page = await context.newPage()
    await page.goto('/level-test')
    // The language first: the test needs its words.
    await expect(page.getByRole('heading', { name: 'Set up Wordado' })).toBeVisible()
    await page.getByRole('radio', { name: 'Български' }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    // Then the test at once, over the whole screen, without the level choice.
    await expect(page.getByRole('heading', { name: 'Find your level' })).toBeVisible()
    await expect(page.locator('.masthead')).toHaveCount(0)
    const result = page.getByRole('heading', { name: 'Your level: A1' })
    for (let i = 0; i < 40 && !(await result.isVisible()); i += 1) {
      const count = await page.locator('.study-count').textContent()
      // An answer given before the question has settled is not taken.
      await page.waitForTimeout(SETTLE_MS)
      await page.getByRole('button', { name: 'I don’t know' }).click()
      await expect(page.locator('.study-count').or(result).first()).not.toHaveText(count ?? '')
    }
    await expect(result).toBeVisible()
    await page.getByRole('button', { name: /^(Use|Keep) A1$/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Your English level' })).toBeFocused()
    await expect(page.getByRole('radio', { name: 'A1 · Beginner' })).toBeChecked()
    await page.getByRole('button', { name: 'Start studying' }).click()
    await expect(today(page)).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    // With the setup done, the same address is the test, as from Settings.
    await page.goto('/level-test')
    await expect(page.getByRole('heading', { name: 'Find your level' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to settings' })).toBeVisible()
  } finally {
    await context.close()
  }
})

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
  // What an account gives, and what the email is for, before the age gate (#289).
  await expect(page.getByRole('list', { name: 'With an account' })).toContainText('Your email is used only to send you a sign-in code.')
  await expectAccessible(page, { dark: true })
})

// Sign-in with the email first, and the age step only for a new account (#293). The demo has no server: the
// sign-in routes answer as the server does, and each test records what the page sent.

/** Answers the sign-in routes: a code is sent; `NEW` is an address with no account, anything else has one. */
async function serveSignIn(page: import('@playwright/test').Page, createAccount: { status: number; body: unknown } = { status: 400, body: { code: 'INVALID_TICKET' } }) {
  const sent: { path: string; body: Record<string, unknown> }[] = []
  const answer = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    sent.push({ path, body })
    if (path.endsWith('/email-otp/send-verification-otp')) return route.fulfill(answer(200, { success: true }))
    if (path.endsWith('/sign-in/email-otp')) {
      return route.fulfill(body['email'] === NEW ? answer(202, { code: 'NEW_ACCOUNT', message: 'm', ticket: 'tk' }) : answer(200, { token: 't', user: { id: 'u1' } }))
    }
    if (path.endsWith('/email-otp/create-account')) return route.fulfill(answer(createAccount.status, createAccount.body))
    return route.fulfill(answer(404, { error: 'not_found' }))
  })
  return sent
}
const NEW = 'new-learner@example.com'

async function emailAndCode(page: import('@playwright/test').Page, email: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByLabel('Code').fill('123456')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('sign-in starts with the email, and an address with an account gets no age step (#293)', async ({ page }) => {
  const sent = await serveSignIn(page)
  const me = page.waitForRequest('**/v1/me')
  await page.goto('/')
  await page.getByRole('link', { name: 'I already have an account' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'How do you want to sign in?' })).toBeVisible()
  await expect(page.getByText('Step 1 of 2')).toBeVisible()
  await expect(page.getByLabel('Country where you live')).toHaveCount(0)
  await expect(page.getByText(/^New here or coming back, start with your email\./)).toBeVisible()
  await page.getByLabel('Email').fill('back@example.com')
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await expect(page.getByText('Step 2 of 2')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Code').fill('123456')
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Signed in: the app asks who it is, and no age is asked.
  await me
  await expect(page.getByRole('heading', { name: 'Create your account' })).toHaveCount(0)
  await expect(page.getByLabel('Country where you live')).toHaveCount(0)
  expect(sent.map((s) => s.path)).toEqual(['/api/auth/email-otp/send-verification-otp', '/api/auth/sign-in/email-otp'])
  expect(sent[1]!.body).toEqual({ email: 'back@example.com', otp: '123456' })
})

test('a new address gets the age step after the code; below the age, nothing is created and the ticket is dropped (#293)', async ({ page }) => {
  const sent = await serveSignIn(page)
  await page.goto('/signin')
  await emailAndCode(page, NEW)
  await expect(page.getByRole('heading', { level: 2, name: 'Create your account' })).toBeFocused()
  await expect(page.getByText('New account')).toBeVisible()
  await expect(page.getByText(`There is no account with ${NEW} yet.`, { exact: false })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /^I would like to receive news about Wordado/ })).not.toBeChecked()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Country where you live').selectOption('DE')
  await page.getByRole('button', { name: 'I’m younger than 16' }).click()
  await expect(heading(page)).toHaveText('Sorry, you can’t create an account yet')
  await expect.poll(() => sent.at(-1)).toEqual({ path: '/api/auth/email-otp/create-account', body: { email: NEW, ticket: 'tk', ageConfirmed: false } })
})

test('the age step creates the account with the ticket and the news wording, and a lapsed ticket goes back to the email (#293)', async ({ page }) => {
  const sent = await serveSignIn(page)
  await page.goto('/signin')
  await emailAndCode(page, NEW)
  await page.getByLabel('Country where you live').selectOption('BG')
  await page.getByRole('checkbox', { name: 'I’m 14 or older' }).check()
  await page.getByRole('checkbox', { name: /^I would like to receive news about Wordado/ }).check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toHaveText('Creating the account took too long. Ask for a new code and try again.')
  await expect(page.getByLabel('Email')).toHaveValue(NEW)
  // The country stayed on the device: nothing sent names it.
  expect(sent.at(-1)).toEqual({ path: '/api/auth/email-otp/create-account', body: { email: NEW, ticket: 'tk', ageConfirmed: true, newsConsent: 'news-1.en' } })
  expect(JSON.stringify(sent)).not.toContain('BG')
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

// The website's dates are answered here: the demo has no website beside it. Service workers are blocked, on the
// page's own context, as for feedback above: WebKit does not show a request the app's worker passes on to `page.route`.
test.describe('a notice when the terms or the privacy policy change (#184)', () => {
  test.use({ serviceWorkers: 'block' })

  test('tells nothing at the first visit; a later change is announced once, read by a link and dismissed by keyboard', async ({ page }) => {
    const every = (date: string) => ({ bg: date, de: date, en: date, es: date })
    let dates: unknown = { schema_version: 1, terms: every('2026-10-11'), privacy: every('2026-10-11') }
    let asked = 0
    await page.route('https://wordado.com/legal.json', (route) => {
      asked += 1
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(dates) })
    })
    const stored = () => page.evaluate(() => localStorage.getItem('wordado.legal'))
    const notice = page.getByText('The terms of use have changed.')

    await page.goto('/')
    await finishSetup(page)
    await expect.poll(stored).toContain('"seen":{"terms":"2026-10-11","privacy":"2026-10-11"}')
    await expect(notice).toHaveCount(0)

    // The terms change. The same day the app does not look again; a day later it does.
    dates = { schema_version: 1, terms: every('2026-11-01'), privacy: every('2026-10-11') }
    await page.reload()
    await expect(today(page)).toBeVisible()
    expect(asked).toBe(1)
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('wordado.legal')!) as { checkedAt: number }
      localStorage.setItem('wordado.legal', JSON.stringify({ ...saved, checkedAt: saved.checkedAt - 24 * 60 * 60_000 }))
    })
    await page.reload()
    await expect(notice).toBeVisible()
    await expect(page.getByRole('status').filter({ has: notice })).toHaveCount(1)
    await expect(page.getByText('The privacy policy has changed.')).toHaveCount(0)
    const link = page.getByRole('link', { name: 'Read the terms' })
    await expect(link).toHaveAttribute('href', 'https://wordado.com/en/terms/')
    await expectAccessible(page, { dark: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // It waits across a visit, and offline: it is shown from what the device kept.
    await page.unroute('https://wordado.com/legal.json')
    await page.route('https://wordado.com/legal.json', (route) => route.abort())
    await page.reload()
    await expect(notice).toBeVisible()

    // By keyboard: the link and Dismiss both take focus (Safari's Tab passes links by unless its user asks, so the
    // test places the focus itself), and Enter dismisses.
    await link.focus()
    await expect(link).toBeFocused()
    const dismiss = page.getByRole('button', { name: 'Dismiss' }).and(page.locator('[aria-describedby="legal-terms-changed"]'))
    await dismiss.focus()
    await expect(dismiss).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(notice).toHaveCount(0)
    await page.reload()
    await expect(today(page)).toBeVisible()
    await expect(notice).toHaveCount(0)
  })

  test('says nothing, and shows no error, when the website cannot be reached', async ({ page }) => {
    await page.route('https://wordado.com/legal.json', (route) => route.abort())
    await page.goto('/')
    await finishSetup(page)
    await expect(page.getByText(/have changed|has changed/)).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('wordado.legal'))).toBeNull()
  })
})

// The trial (spec 2026-10-12): a visitor chooses a level or takes the test, and studies the one unit of it.
test.describe('the trial at the visitor’s level', () => {
  test('studies the unit of the chosen level, and the path says so', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ serviceWorkers: 'block', ...(testInfo.project.use.viewport ? { viewport: testInfo.project.use.viewport } : {}) })
    forwardConsole(context)
    await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
    const entries = await serveTrialSample(context)
    try {
      const page = await context.newPage()
      await page.goto('/')
      await finishSetupAt(page, 'B1 · Intermediate')
      await page.goto('/study?mode=flashcard')
      const card = page.locator('.card[data-phase="prompt"]')
      await expect(card).toBeVisible()
      // The side shown is the English word or its translation, whole: a substring would find "no" in other words.
      const shown = ((await card.locator('.hw-word, .translation').first().textContent()) ?? '').trim()
      const has = (list: readonly { headword: string; translation: string }[]) => list.some((e) => e.headword === shown || e.translation === shown)
      expect(has(entries.B1)).toBe(true)
      expect(has([...entries.A1, ...entries.A2])).toBe(false)
      await page.goto('/path')
      await expect(page.locator('li.unit')).toHaveCount(1)
      await expect(page.getByText('This is the demo: one unit of B1.')).toBeVisible()
      await expect(page.locator('#main').getByRole('link', { name: 'Create an account' })).toBeVisible()
      // Said above the unit, where it is seen first (#289).
      const note = await page.getByRole('region', { name: 'This is the demo: one unit of B1.' }).boundingBox()
      const unit = await page.locator('li.unit').boundingBox()
      expect(note!.y).toBeLessThan(unit!.y)
      await expectAccessible(page, { dark: true })
      // The Themes screen shows what the whole course offers, to look at: a trial studies no theme (#244).
      await page.goto('/themes')
      await expect(page.getByText('Themes come with the whole course: pick one and its words come first.')).toBeVisible()
      const cards = page.locator('.theme-grid > li')
      await expect(cards).toHaveCount(2)
      await expect(cards.filter({ hasText: 'Daily life' })).toContainText('240 words')
      await expect(cards.getByText('With an account')).toHaveCount(2)
      await expect(cards.getByRole('link')).toHaveCount(0)
      await expect(page.locator('#main').getByRole('button')).toHaveCount(0)
      await expectAccessible(page, { dark: true })
    } finally {
      await context.close()
    }
  })

  test('the setup’s test places the visitor, and the level comes back selected', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ serviceWorkers: 'block', ...(testInfo.project.use.viewport ? { viewport: testInfo.project.use.viewport } : {}) })
    forwardConsole(context)
    await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
    await serveTrialSample(context)
    try {
      const page = await context.newPage()
      await page.goto('/')
      await page.getByRole('radio', { name: 'Български' }).check()
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByRole('heading', { name: 'Your English level' })).toBeVisible()
      await page.getByRole('radio', { name: 'B1 · Intermediate' }).click()
      await expect(page.getByRole('radio', { name: 'B1 · Intermediate' })).toBeChecked()
      await page.getByRole('button', { name: 'Find your level with a short test' }).click()
      const result = page.getByRole('heading', { name: 'Your level: A1' })
      for (let i = 0; i < 40 && !(await result.isVisible()); i += 1) {
        const count = await page.locator('.study-count').textContent()
        await page.waitForTimeout(SETTLE_MS)
        await page.getByRole('button', { name: 'I don’t know' }).click()
        await expect(page.locator('.study-count').or(result).first()).not.toHaveText(count ?? '')
      }
      await expect(result).toBeVisible()
      await page.getByRole('button', { name: 'Use A1' }).click()
      await expect(page.getByRole('radio', { name: 'A1 · Beginner' })).toBeChecked()
      await page.getByRole('button', { name: 'Start studying' }).click()
      await expect(today(page)).toBeVisible()
      await page.goto('/path')
      await expect(page.getByText('This is the demo: one unit of A1.')).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('ends on the invitation once every word of the unit is started', async ({ browser }, testInfo) => {
    test.slow()
    const context = await browser.newContext({ serviceWorkers: 'block', ...(testInfo.project.use.viewport ? { viewport: testInfo.project.use.viewport } : {}) })
    forwardConsole(context)
    await context.addInitScript(() => localStorage.setItem('wordado.locale', 'en'))
    await serveTrialSample(context)
    try {
      const page = await context.newPage()
      await page.goto('/')
      await finishSetupAt(page, 'B1 · Intermediate')
      // The unit holds twenty words: a day's limit that covers it.
      await page.goto('/settings/study')
      await page.getByLabel('New words a day', { exact: true }).fill('20')
      await page.getByLabel('New words a day', { exact: true }).press('Enter')
      // By the nav, not a reload: the setting is saved a moment after Enter.
      await page.locator('.nav').getByRole('link', { name: 'Study' }).click()
      await expect(today(page)).toHaveText('20 new words')
      await page.goto('/study?mode=flashcard')
      for (let i = 0; i < 40 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
      await expect(page.locator('.done')).toBeVisible()
      await expect(page.getByText('You have started every word of the demo.')).toBeVisible()
      await expect(page.getByText('Create an account to go on with the whole course.')).toBeVisible()
      await expect(page.getByRole('list', { name: 'With an account' })).toContainText('every device you sign in on')
      await page.goto('/')
      await expect(page.getByText('You have started every word of the demo.')).toBeVisible()
      await expect(page.locator('#main').getByRole('link', { name: 'Create an account' })).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
