import { expect, test } from '@playwright/test'

test('a reviewer accepts a fix, keeps a row and imports', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/Your name/).fill('Tester')
  await page.getByRole('button', { name: 'Start' }).click()
  // One row at a time; the list is behind All rows.
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Keep/ })).toBeEnabled()
  const first = await page.getByRole('article').getAttribute('aria-label')
  await page.getByRole('button', { name: 'All rows' }).click()
  const list = page.getByRole('list', { name: 'Rows' })
  await expect(list.getByRole('button').first()).toBeVisible()
  await expect(list.getByText('report').first()).toBeVisible()
  await page.keyboard.press('2')                          // the keys are off while the list is open
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(page.getByRole('article')).toHaveAttribute('aria-label', first!)
  await page.keyboard.press('2')                          // keep the reported row
  await expect(page.getByRole('article')).not.toHaveAttribute('aria-label', first!)
  await page.keyboard.press('l')
  await list.getByRole('button', { name: /bank-/ }).first().click()
  await expect(list).toBeHidden()
  await expect(page.getByRole('article')).toHaveAttribute('aria-label', /Row bank-/)
  await page.getByRole('button', { name: /Accept fix/ }).click()
  await page.getByRole('button', { name: 'Import decisions' }).click()
  await expect(page.locator('p.notice')).toContainText(/Imported 2/)
})
