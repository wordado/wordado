import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export const heading = (page: Page) => page.getByRole('heading', { level: 1 })

// StudyRun ignores a choose/reveal/rate/next that lands within ITEM_SETTLE_MS (250,
// client-data/src/run.ts) of the item, reveal or feedback it would act on — a stray
// double press must not land on the next thing shown. A real learner's keystrokes are
// never that fast; these e2e presses are, so every one of them waits past it first.
export const SETTLE_MS = 300

/** Answers the item on screen by keyboard, as a learner would (spec §11.1); returns its mode. */
export async function answer(page: Page): Promise<string> {
  const prompt = page.locator('.card[data-phase="prompt"]')
  await expect(prompt).toBeVisible()
  const mode = (await prompt.getAttribute('data-mode'))!
  const before = Number(((await page.locator('.study-bar p').textContent()) ?? '0').split(' ')[0])
  await page.waitForTimeout(SETTLE_MS)
  if (mode === 'flashcard') {
    await page.keyboard.press('Space')
    await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
    await page.waitForTimeout(SETTLE_MS)
    await page.keyboard.press('3')
  } else {
    await page.keyboard.press('1')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
    await page.waitForTimeout(SETTLE_MS)
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('.study-bar p', { hasText: new RegExp(`^${before + 1} done`) }).or(page.locator('.done'))).toBeVisible()
  return mode
}

export async function studyNew(page: Page, count: number): Promise<void> {
  await page.goto('/study')
  for (let i = 0; i < count; i += 1) await answer(page)
  await page.getByRole('button', { name: 'Stop for now' }).click()
  await expect(page.locator('.done')).toBeVisible()
}

/** Scans the page for WCAG 2.2 A and AA (spec §11.1); `dark` repeats the scan in the dark theme. */
export async function expectAccessible(page: Page, options: { readonly dark?: boolean } = {}): Promise<void> {
  for (const colorScheme of options.dark ? (['light', 'dark'] as const) : (['light'] as const)) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map((v) => `${colorScheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: null })
}
