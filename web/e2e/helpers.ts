import AxeBuilder from '@axe-core/playwright'
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bg } from '../src/i18n/bg'
import { de } from '../src/i18n/de'
import { en, type Messages } from '../src/i18n/en'
import { es } from '../src/i18n/es'

export const heading = (page: Page) => page.getByRole('heading', { level: 1 })

/** What `forwardConsole` needs of a BrowserContext. */
interface ConsoleSource {
  browser(): { browserType(): { name(): string } } | null
  on(event: 'console', listener: (message: { type(): string; text(): string }) => void): unknown
}

/** Console lines every run gives, which say nothing about a stall. */
const EXPECTED = [
  // The demo's country lookup has no API to ask.
  'Failed to load resource: the server responded with a status of',
  // Contexts made with `serviceWorkers: 'block'`.
  'Service Worker registration blocked by Playwright',
]

/**
 * In WebKit, prints the pages' console warnings and errors into the run's output, so a CI log shows what a
 * stalled page said: WebKit on CI now and then stalls for a reason not yet found (e2e/projects.ts), and a retry
 * that gets past it keeps only a trace. The other engines stay quiet: Playwright's Firefox cannot play the m4a
 * clips on Linux, and the offline tests cut the network, both on every run.
 */
export function forwardConsole(context: ConsoleSource): void {
  if (context.browser()?.browserType().name() !== 'webkit') return
  context.on('console', (message) => {
    const type = message.type()
    if (type !== 'warning' && type !== 'error') return
    const text = message.text()
    if (EXPECTED.some((start) => text.startsWith(start))) return
    console.log(`[browser ${type}] ${text}`)
  })
}

// StudyRun ignores a choose/reveal/rate/next that lands within ITEM_SETTLE_MS (250,
// client-data/src/run.ts) of the item, reveal or feedback it would act on — a stray
// double press must not land on the next thing shown. A real learner's keystrokes are
// never that fast; these e2e presses are, so every one of them waits past it first.
export const SETTLE_MS = 300

const TABLES: Readonly<Record<string, Messages>> = { en, bg, de, es }

/** Today's heading: the screen the setup ends on, whatever its text says. */
export const today = (page: Page) => page.locator('h1#today')

/**
 * Through the first-run setup (plan 11) that a new demo or a new account opens in: `l1` is the native language's
 * endonym, as its radio is named. Its strings come from the interface's own table (the page's `lang`), so a German
 * browser's setup is gone through the same way. After the language, Start studying ends it on the next step.
 */
export async function finishSetup(page: Page, l1 = 'Български'): Promise<void> {
  const title = page.getByRole('heading', { level: 2 }).and(page.locator('#language-step-title'))
  await expect(title).toBeVisible()
  const t = TABLES[(await page.locator('html').getAttribute('lang')) ?? 'en'] ?? en
  await expect(title).toHaveText(t['setup.language.title'])
  await page.getByRole('radio', { name: l1 }).check()
  await page.getByRole('button', { name: t['setup.continue'] }).click()
  await page.getByRole('button', { name: t['setup.start'] }).click()
  await expect(today(page)).toBeVisible()
}

/** Answers the item on screen by keyboard, as a learner would (spec §11.1); returns its mode. */
export async function answer(page: Page): Promise<string> {
  const prompt = page.locator('.card[data-phase="prompt"]')
  await expect(prompt).toBeVisible()
  const mode = (await prompt.getAttribute('data-mode'))!
  const progress = page.getByRole('progressbar', { name: 'Session progress' })
  const before = Number(await progress.getAttribute('aria-valuenow'))
  await page.waitForTimeout(SETTLE_MS)
  if (mode === 'flashcard') {
    await page.keyboard.press('Space')
    await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
    await page.waitForTimeout(SETTLE_MS)
    await page.keyboard.press('3')
  } else {
    await page.keyboard.press('1')
    // The answer is recorded; then a right one moves on by itself, and a wrong one waits for Continue (spec §8.1).
    await expect(page.locator(`[role="progressbar"][aria-valuenow="${before + 1}"]`).or(page.locator('.done'))).toBeVisible()
    await expect(page.locator('.feedback-sheet.moves-on')).toHaveCount(0)
    const next = page.getByRole('button', { name: 'Continue' })
    if (await next.isVisible()) {
      await expect(next).toBeFocused()
      await page.waitForTimeout(SETTLE_MS)
      await page.keyboard.press('Enter')
    }
  }
  await expect(page.locator(`[role="progressbar"][aria-valuenow="${before + 1}"]`).or(page.locator('.done'))).toBeVisible()
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

// From the string form of import.meta.url: the unit suite loads this file under happy-dom, which replaces the global URL class.
const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'samples', 'a1')

/**
 * Serves the Bulgarian sample with its first unit as A1 and the rest as A2, so the demo has a level to place above:
 * the bundled sample is all A1, and nothing can be skipped in it. Only the levels change; the manifest's checksum
 * follows the new bytes. The context must block service workers, or the app's own would answer instead.
 */
export async function serveTwoLevelSample(context: BrowserContext): Promise<void> {
  interface Leveled {
    level: string
    unit_id?: string
  }
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as { units: Leveled[]; entries: Leveled[] }
  const first = pack.units[0]!.unit_id
  for (const unit of pack.units) if (unit.unit_id !== first) unit.level = 'A2'
  for (const entry of pack.entries) if (entry.unit_id !== first) entry.level = 'A2'
  const body = Buffer.from(JSON.stringify(pack))
  const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as { packs: { pack_id: string; sha256: string; bytes: number }[] }
  for (const p of manifest.packs) {
    if (p.pack_id !== 'corpus-bg') continue
    p.sha256 = createHash('sha256').update(body).digest('hex')
    p.bytes = body.length
  }
  await context.route('**/content/sample/manifest.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }))
  await context.route('**/content/sample/corpus-v0-bg.pack', (route) => route.fulfill({ contentType: 'application/json', body }))
}

/** The Bulgarian sample's entries, as the pack has them. */
export interface SampleEntry {
  readonly headword: string
  readonly translation: string
  sense: string
}

/**
 * Serves the Bulgarian sample with a sense gloss on every entry (the bundled one has a single gloss), and returns its
 * entries, so a test knows the right answer to a question. The context must block service workers, as above.
 */
export async function serveGlossedSample(context: BrowserContext, gloss: string): Promise<readonly SampleEntry[]> {
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as { entries: SampleEntry[] }
  for (const entry of pack.entries) entry.sense = gloss
  const body = Buffer.from(JSON.stringify(pack))
  const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as { packs: { pack_id: string; sha256: string; bytes: number }[] }
  for (const p of manifest.packs) {
    if (p.pack_id !== 'corpus-bg') continue
    p.sha256 = createHash('sha256').update(body).digest('hex')
    p.bytes = body.length
  }
  await context.route('**/content/sample/manifest.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }))
  await context.route('**/content/sample/corpus-v0-bg.pack', (route) => route.fulfill({ contentType: 'application/json', body }))
  return pack.entries
}

/** Through the setup of a sample with more than one level (`serveTwoLevelSample`), declaring `level` on its Level step. */
export async function finishSetupAt(page: Page, level: string): Promise<void> {
  await page.getByRole('radio', { name: 'Български' }).check()
  await page.getByRole('button', { name: en['setup.continue'] }).click()
  await expect(page.getByRole('heading', { name: en['setup.level.title'] })).toBeVisible()
  // The radio is checked once the level is saved, a moment after the click: `check()` would not wait for it.
  await page.getByRole('radio', { name: level }).click()
  await expect(page.getByRole('radio', { name: level })).toBeChecked()
  await page.getByRole('button', { name: en['setup.start'] }).click()
  await expect(today(page)).toBeVisible()
}
