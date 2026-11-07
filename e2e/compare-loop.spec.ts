import { test, expect } from '@playwright/test'
import { DIST_URL, downloadExport } from './helpers'

// WP 7c: LIVE_URL runs this spec against the deployed page instead of the file from disk
const URL = process.env.LIVE_URL ?? DIST_URL

// PRD §5 Compare loop; WP 7 gate (c): a four-candidate knockout with the
// judgements of tests/fixtures/pairs/knockout-four-candidates.json, and the
// undo/redo cursor (WP 3 c, WP 6c c and d).
const FILE =
  [
    '{"prompt":"Greet a new colleague","responses":["Hi","Hello","Hey there","Good morning"]}',
    '{"prompt":"Q","responses":["x","y"]}',
    '{"prompt":"R","responses":["m","n"]}',
    '{"prompt":"S","responses":["s1","s2"]}',
    '{"prompt":"T","responses":["t1","t2"]}',
  ].join('\n') + '\n'

test('knockout, undo/redo cursor, digits, strength and the pairs export', async ({ page }) => {
  await page.goto(URL)
  await page.getByLabel('JSONL file').setInputFiles({ name: 'knockout.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(FILE) })
  await expect(page.getByText('Prompt 1 of 5')).toBeVisible()
  await expect(page.getByText('Pair 1 of 3')).toBeVisible()

  // Tab moves the focus marker to the other card (D-007); E edits the focused candidate
  const cards = page.getByRole('group')
  await expect(cards.nth(0)).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Tab')
  await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('e')
  await expect(page.getByLabel('Edit content')).toHaveValue('Hello')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await expect(cards.nth(0)).toHaveAttribute('aria-current', 'true')

  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Pair 2 of 3')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('Pair 3 of 3')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Prompt 2 of 5')).toBeVisible()

  await page.keyboard.press('u')
  await expect(page.getByText('Prompt 1 of 5')).toBeVisible()
  await expect(page.getByText('Pair 3 of 3')).toBeVisible()
  await page.keyboard.press('Shift+U')
  await expect(page.getByText('Prompt 1 of 5')).toBeVisible()
  await expect(page.getByText('Judged: right preferred')).toBeVisible()

  await page.keyboard.press('j')
  await expect(page.getByText('Prompt 2 of 5')).toBeVisible()
  await page.keyboard.press('1')
  await expect(page.getByText('Prompt 3 of 5')).toBeVisible()
  await page.keyboard.press('Shift+Digit2')
  await expect(page.getByText('Prompt 3 of 5')).toBeVisible()
  await page.keyboard.press('0')
  await expect(page.getByText('Prompt 4 of 5')).toBeVisible()
  await page.keyboard.press('x')
  await expect(page.getByText('Prompt 5 of 5')).toBeVisible()
  await page.keyboard.press('2')

  await expect(page.getByTestId('progress-text')).toHaveText(
    '5 / 5 prompts · 2 left · 3 right · 1 tie · 1 both bad · 0 kept · 0 rejected · 0 skipped · 0 edited'
  )

  await page.getByRole('button', { name: 'Export' }).click()
  await expect(
    page
      .getByRole('region', { name: 'pairs.jsonl' })
      .getByText(
        '5 pairs. 1 tie and 1 both-unacceptable pair were left out: a DPO row needs one chosen and one rejected completion for the same prompt. Strength is carried in all.decisions.jsonl only.'
      )
  ).toBeVisible()

  const pairs = (await downloadExport(page, 'pairs.jsonl')).toString('utf8').trimEnd().split('\n').map((l) => JSON.parse(l))
  expect(pairs).toEqual([
    { prompt: 'Greet a new colleague', chosen: 'Hello', rejected: 'Hi' },
    { prompt: 'Greet a new colleague', chosen: 'Hey there', rejected: 'Hello' },
    { prompt: 'Greet a new colleague', chosen: 'Good morning', rejected: 'Hey there' },
    { prompt: 'Q', chosen: 'x', rejected: 'y' },
    { prompt: 'T', chosen: 't2', rejected: 't1' },
  ])

  const all = (await downloadExport(page, 'all.decisions.jsonl')).toString('utf8').trimEnd().split('\n').map((l) => JSON.parse(l))
  expect(all[1]._triage.compare).toEqual([{ left: '1:0', right: '1:1', preference: 'left', strength: 2 }])
  // No bare digit sets a score (§5)
  expect('score' in all[1]._triage).toBe(false)
})
