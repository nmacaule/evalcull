import { test, expect } from '@playwright/test'
import { DIST_URL, downloadExport } from './helpers'

// WP 7 gate (a): kept.jsonl through the real reader's readRawRange is byte-exact
// (D-006), with a BOM file kept and stripped and a run of unedited lines that
// starts at line 0. Distinct prompts, so single mode; a, a, r auto-advance (WP 3 d).
const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const LINES =
  '{"instruction":"p0","output":"a"}\r\n{"instruction":"p1","output":"b"}\n{"instruction":"p2","output":"c"}\n'
const KEPT = '{"instruction":"p0","output":"a"}\r\n{"instruction":"p1","output":"b"}\n'

test.beforeEach(async ({ page }) => {
  await page.goto(DIST_URL)
  await page.getByLabel('JSONL file').setInputFiles({
    name: 'bom.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.concat([BOM, Buffer.from(LINES)]),
  })
  await expect(page.getByText('Record 1 of 3')).toBeVisible()
  await page.keyboard.press('a')
  await expect(page.getByText('Record 2 of 3')).toBeVisible()
  await page.keyboard.press('a')
  await expect(page.getByText('Record 3 of 3')).toBeVisible()
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Export' }).click()
})

test('kept.jsonl with BOM keep is the BOM and lines 0–1 byte for byte', async ({ page }) => {
  expect(await downloadExport(page, 'kept.jsonl')).toEqual(Buffer.concat([BOM, Buffer.from(KEPT)]))
})

test('kept.jsonl with BOM strip', async ({ page }) => {
  await page.getByLabel('strip').check()
  expect(await downloadExport(page, 'kept.jsonl')).toEqual(Buffer.from(KEPT))
})
