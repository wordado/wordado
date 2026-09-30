import { expect, test } from '@playwright/test'
import { answer, expectAccessible, heading, SETTLE_MS, studyNew } from './helpers'

test.beforeEach(async ({ context }) => {
  // English, so the assertions read plainly; the Bulgarian default is covered by the unit suite.
  await context.addInitScript(() => {
    if (localStorage.getItem('wordado.locale') === null) localStorage.setItem('wordado.locale', 'en')
  })
})

test('studies the demo by keyboard from the first visit to a completed day', async ({ page }) => {
  await page.goto('/')
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
    await page.goto(`/study?mode=${mode}`)
    await expect(page.locator('.card')).toHaveAttribute('data-mode', mode)
    expect(await answer(page)).toBe(mode)
  })
}

test('keeps progress offline after the first visit, and after reconnecting', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright’s WebKit fails page.goto while offline ("WebKit encountered an internal error"); Safari offline is on the release checklist (docs/deploy.md)')
  await page.goto('/')
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

test('a second tab says Wordado is open elsewhere, and can take over', async ({ page, context }) => {
  await page.goto('/')
  await expect(heading(page)).toHaveText('10 new words')
  const second = await context.newPage()
  await second.goto('/')
  await expect(heading(second)).toHaveText('Wordado is open in another tab.')
  await second.getByRole('button', { name: 'Use Wordado here' }).click()
  await expect(heading(second)).toHaveText('10 new words')
  await expect(heading(page)).toHaveText('Wordado is open in another tab.')
})

test('plays a matching board once five words are known', async ({ page }) => {
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

test('serves the privacy policy, not the app, once the service worker controls the page', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  await page.goto('/privacy')
  await expect(heading(page)).toHaveText('Privacy policy')
  await expect(page.locator('.nav')).toHaveCount(0)
  await expectAccessible(page, { dark: true })
})

test('Settings › About says the demo’s word list is Wordado’s own, from the bundled sample’s credits', async ({ page }) => {
  await page.goto('/settings/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expect(page.getByText('This word list was prepared by Wordado.')).toBeVisible()
})

test('meets WCAG 2.2 A and AA on every screen (spec §11.1)', async ({ page }) => {
  await page.goto('/')
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

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/study?mode=multiple_choice')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await expectAccessible(page)

  for (const path of ['/settings', '/settings/study', '/settings/languages', '/signin', '/settings/placement']) {
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
  try {
    const page = await context.newPage()
    await page.goto('/')
    await expect(heading(page)).toHaveText('10 neue Wörter')

    // Forcing the mode (as the mode-matrix tests above do) sidesteps the mode/direction randomness for a brand-new
    // word (core/src/modeSelection.ts): a flashcard always reveals the translation.
    await page.goto('/study?mode=flashcard')
    await expect(page.locator('.card')).toHaveAttribute('data-mode', 'flashcard')
    await page.waitForTimeout(SETTLE_MS)
    await page.keyboard.press('Space')
    await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
    await expect(page.getByText('hallo')).toBeVisible()
  } finally {
    await context.close()
  }
})

test('changing the native language in Settings keeps progress and switches translations', async ({ page }) => {
  // A word studied before the change (the demo's first word, "hello") stays counted afterwards.
  await studyNew(page, 1)
  await page.goto('/path')
  await expect(page.getByText('1 of 20 started')).toBeVisible()

  await page.goto('/settings/languages')
  await page.getByRole('group', { name: 'Native language' }).getByRole('radio', { name: 'Deutsch' }).click()
  const dialog = page.getByRole('dialog', { name: 'Native language' })
  await expect(dialog).toContainText('Your progress stays. The words switch to German translations.')
  await dialog.getByRole('button', { name: 'Change' }).click()
  await expect(dialog).toBeHidden()

  // The interface was English, not the old native language, so it stays English (spec §8.6): only the pack
  // switches, in the background (`web/src/app/l1Watch.ts`). Nothing in the UI flags that install as it runs, so
  // the only reliable signal is the translation itself: retry a fresh flashcard of the next new word ("goodbye")
  // until it reveals the German pack's translation.
  await expect
    .poll(
      async () => {
        // No throwing `expect` in here: a throw ends the poll at once instead of retrying it.
        await page.goto('/study?mode=flashcard')
        await page.locator('.card[data-phase="prompt"]').waitFor()
        await page.waitForTimeout(SETTLE_MS)
        await page.keyboard.press('Space')
        const revealed = await page
          .locator('.card[data-phase="revealed"]')
          .waitFor({ timeout: 2_000 })
          .then(() => true)
          .catch(() => false)
        return revealed ? page.locator('.card .translation').innerText() : null
      },
      { timeout: 15_000 },
    )
    .toBe('auf Wiedersehen')

  // Progress from before the change is still here: studying the new word above didn't rate it, so the count
  // of started words in the first unit is unchanged.
  await page.goto('/path')
  await expect(page.getByText('1 of 20 started')).toBeVisible()
})
