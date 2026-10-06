import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser } from '@playwright/test'

const tokens = () => JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '.e2e', 'tokens.json'), 'utf8')) as { admin: string; reviewer: string }
const as = async (browser: Browser, who: 'admin' | 'reviewer') => (await browser.newContext({ extraHTTPHeaders: { 'cf-access-jwt-assertion': tokens()[who] } })).newPage()

test('a reviewer decides rows with the keys and submits a pull request', async ({ browser }) => {
  const page = await as(browser, 'reviewer')
  await page.goto('/')
  await page.getByRole('button', { name: /translation-bg/ }).click()
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
  await page.getByRole('button', { name: /Submit 2 decisions/ }).click()
  await expect(page.getByRole('link', { name: /pull request 1/ })).toBeVisible()
  const state = (await (await fetch('http://127.0.0.1:4182/_state')).json()) as { pulls: { title: string }[] }
  expect(state.pulls[0]!.title).toBe('translation-bg: 2 decisions by Rita')
})

test('an admin invites a reviewer and assigns files; an overlap is refused', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin' }).click()
  const invite = page.getByRole('form', { name: 'Invite a reviewer' })
  await invite.getByLabel('Email').fill('new@example.com')
  await invite.getByLabel('Name').fill('Nora')
  await invite.getByLabel('Spanish').check()
  await invite.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByText('new@example.com', { exact: true })).toBeVisible()
  const assign = page.getByRole('form', { name: 'Assign' })
  await assign.getByLabel('Reviewer').selectOption('hans@example.com')
  await assign.getByLabel('Queue').selectOption('translation-bg')
  await assign.getByLabel('All files').check()
  await assign.getByRole('button', { name: 'Assign' }).click()
  await expect(page.locator('p.notice')).toContainText(/already assigned to Rita/)
})
