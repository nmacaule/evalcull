import { test, expect } from '@playwright/test'

// WP 6b gate (plan.md): export dialog text and progress counts, through the
// real reader and worker. Prompts P (lines 0, 1, 2) and Q (line 3).
const FOUR = [
  '{"instruction":"P","output":"a"}',
  '{"instruction":"P","output":"b"}',
  '{"instruction":"P","output":"c"}',
  '{"instruction":"Q","output":"d"}',
].join('\n') + '\n'

test('progress counts and the export dialog text', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSONL file').setInputFiles({
    name: 'four.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from(FOUR),
  })

  const progress = page.getByTestId('progress-text')
  await expect(progress).toHaveText(
    '0 / 2 prompts · 0 left · 0 right · 0 tie · 0 both bad · 0 kept · 0 rejected · 0 skipped · 0 edited'
  )

  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('=')
  await expect(page.getByText('Prompt 2 of 2')).toBeVisible()
  await page.keyboard.press('a')

  await expect(progress).toHaveText(
    '2 / 2 prompts · 1 left · 0 right · 1 tie · 0 both bad · 1 kept · 0 rejected · 0 skipped · 0 edited'
  )
  await expect(page.getByRole('status').first()).toHaveText('Saved')

  await page.getByRole('button', { name: 'Export' }).click()
  const pairs = page.getByRole('region', { name: 'pairs.jsonl' })
  await expect(
    pairs.getByText(
      '1 pair. 1 tie and 0 both-unacceptable pairs were left out: a DPO row needs one chosen and one rejected completion for the same prompt. Strength is carried in all.decisions.jsonl only.'
    )
  ).toBeVisible()
  const edits = page.getByRole('region', { name: 'pairs.edits.jsonl' })
  await expect(
    edits.getByText(
      'Edit pairs are off-policy: the chosen side was written by a person, not sampled from the model. DPO is sensitive to that distribution shift, and human-written chosen text can teach a length or style bias. Use them knowingly.'
    )
  ).toBeVisible()
})
