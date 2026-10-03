import { expect, test } from '@playwright/test'
import { answer, expectAccessible, finishSetup, forwardConsole, heading, SETTLE_MS, studyNew, today } from './helpers'

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
