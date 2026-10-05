import { expect, test } from '@playwright/test'

test('a reviewer accepts a fix, keeps a row and imports', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/Your name/).fill('Tester')
  await page.getByRole('button', { name: 'Start' }).click()
  const list = page.getByRole('list', { name: 'Rows' })
  await expect(list.getByRole('button').first()).toBeVisible()
  await expect(list.getByText('report').first()).toBeVisible()
  await page.keyboard.press('2')                          // keep the reported row
  await list.getByRole('button', { name: /bank-/ }).first().click()
  await page.getByRole('button', { name: /Accept fix/ }).click()
  await page.getByRole('button', { name: 'Import decisions' }).click()
  // Several row cells are native <output> elements, which also carry the implicit "status" role;
  // the notice is the one with the "notice" class, not any getByRole('status') in the row panel.
  await expect(page.locator('p.notice')).toContainText(/Imported 2/)
})
