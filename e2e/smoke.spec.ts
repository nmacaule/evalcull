import { test, expect } from '@playwright/test'

test('page loads and shows heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /evalcull/i })).toBeVisible()
})
