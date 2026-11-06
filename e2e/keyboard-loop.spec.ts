import { test, expect } from '@playwright/test'
import { DIST_URL } from './helpers'

// PRD §5 Keyboard loop (single): J/K/A/R/S/E/Mod+Enter/Esc/U/Shift+U/T/W/M/G/F;
// typing a or r in the editor never decides; Enter inserts a newline.
// Distinct prompts, so single mode; decisions auto-advance (WP 3 d).
const FILE = ['{"instruction":"p0","output":"a "}', '{"instruction":"p1","output":"b"}', '{"instruction":"p2","output":"c"}'].join('\n') + '\n'

test('the single-mode keyboard loop', async ({ page }) => {
  await page.goto(DIST_URL)
  await page.getByLabel('JSONL file').setInputFiles({ name: 'keys.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(FILE) })
  const position = (n: number) => page.getByText(`Record ${n} of 3`)
  const card = page.getByRole('group').first()
  const content = card.locator('[data-card-content]')
  // E acts on the loaded record of the focused card, so wait for it after a move (D-092)
  const showing = (text: string) => expect(content).toHaveText(text)

  await expect(position(1)).toBeVisible()
  await page.keyboard.press('j')
  await expect(position(2)).toBeVisible()
  await page.keyboard.press('k')
  await expect(position(1)).toBeVisible()

  await page.keyboard.press('a')
  await expect(position(2)).toBeVisible()
  await page.keyboard.press('k')
  await expect(position(1)).toBeVisible()
  await expect(card).toContainText('kept')

  await page.keyboard.press('r')
  await expect(position(2)).toBeVisible()
  await page.keyboard.press('u')
  await expect(position(1)).toBeVisible()
  await expect(card).toContainText('kept')
  await page.keyboard.press('Shift+U')
  await expect(position(1)).toBeVisible()
  await expect(card).toContainText('rejected')

  await page.keyboard.press('s')
  await expect(position(2)).toBeVisible()
  await page.keyboard.press('k')
  await expect(card).toContainText('skipped')

  // The editor: letters type, Enter is a newline, Esc cancels
  await page.keyboard.press('j')
  await expect(position(2)).toBeVisible()
  await showing('b')
  await page.keyboard.press('e')
  const editor = page.getByLabel('Edit content')
  await expect(editor).toHaveValue('b')
  await editor.press('End')
  await page.keyboard.type('ar')
  await page.keyboard.press('Enter')
  await expect(editor).toHaveValue('bar\n')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(position(2)).toBeVisible()
  await expect(card).toContainText('b')
  await expect(card).not.toContainText(/kept|rejected|skipped/)

  // T toggles the raw line (a pre), and back to the rendered response
  await page.keyboard.press('t')
  await expect(content.locator('pre')).toHaveText('{"instruction":"p1","output":"b"}')
  await page.keyboard.press('t')
  await expect(content.locator('pre')).toHaveCount(0)
  await showing('b')

  // Mod+Enter saves and shows the confirmation; Esc dismisses it, keeping the edit
  // as its Dismiss (Esc) button does (WP 6a i, D-093)
  await page.keyboard.press('e')
  await editor.press('ControlOrMeta+a')
  await page.keyboard.type('crimson')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByRole('heading', { name: 'Confirm Edit' })).toBeVisible()
  await expect(page.getByText('crimson')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Confirm Edit' })).toHaveCount(0)
  await showing('crimson')

  // W reveals the trailing space of record 1 (D-025)
  await page.keyboard.press('k')
  await expect(position(1)).toBeVisible()
  await page.keyboard.press('w')
  await expect(card).toContainText('a·')

  await page.keyboard.press('m')
  await expect(page.getByRole('region', { name: 'Metadata' })).toBeVisible()

  await page.keyboard.press('g')
  await page.getByLabel('Record number').fill('3')
  await page.getByLabel('Record number').press('Enter')
  await expect(position(3)).toBeVisible()

  await page.keyboard.press('f')
  await page.keyboard.press('f')
  await expect(page.getByText('Filter: kept')).toBeVisible()
})
