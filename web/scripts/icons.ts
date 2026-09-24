import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

/** Renders public/icon.svg to the PNGs iOS and the manifest need (6a contract). Run: pnpm --filter @wordado/web icons */
const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  // iOS shows a transparent icon on black: the paper colour sits behind it.
  await page.setContent(`<html><body style="margin:0;background:#f6f7fb">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`)
  writeFileSync(new URL(`../public/${name}`, import.meta.url), await page.screenshot({ type: 'png' }))
  await page.close()
}
await browser.close()
