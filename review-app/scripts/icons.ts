import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

/* The icon for an iPhone's home screen, drawn from public/icon.svg: `pnpm --filter @wordado/review-app icons`, after
 * a change to the SVG; the PNG is committed. iOS rounds the corners itself, so the square is drawn without its own
 * rounding: the rose fills the whole picture, the W and the dot keep their place. */

const dir = join(import.meta.dirname, '..', 'public')
const SIZE = 180

async function main(): Promise<void> {
  const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')
  const square = svg.replace(' rx="14"', '')
  if (square === svg) throw new Error('icon.svg: the square with rx="14" was not found')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
    await page.setContent(`<style>html, body { margin: 0 } svg { display: block; width: ${SIZE}px; height: ${SIZE}px }</style>${square}`)
    await page.screenshot({ path: join(dir, 'apple-touch-icon.png') })
  } finally {
    await browser.close()
  }
}

await main()
