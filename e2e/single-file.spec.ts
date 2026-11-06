import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DIST_URL, downloadExport, dropFile, watchCsp, writeTmp } from './helpers'

// WP 7 (plan.md WP 7 gate; PRD §3.9, §5 CSP, Privacy, TTFV): the single file
// opened from file://. LIVE_URL runs the CSP, privacy and TTFV tests against
// the deployed page instead.
const URL = process.env.LIVE_URL ?? DIST_URL

// Lines 0 and 1 share prompt P: three lines in two groups
const FLAT = ['{"instruction":"P","output":"a"}', '{"instruction":"P","output":"b"}', '{"instruction":"Q","output":"c"}'].join('\n') + '\n'
const CANDIDATES = ['{"prompt":"A","responses":["1","2","3","4"]}', '{"prompt":"B","responses":["5","6"]}'].join('\n') + '\n'

const HASH = "'sha256-[A-Za-z0-9+/]{43}='"
const POLICY = new RegExp(
  `^default-src 'none'; script-src( ${HASH})+; worker-src blob:; style-src( ${HASH})+; img-src data:; connect-src 'none'$`
)

test('carries the meta policy', async ({ page }) => {
  await page.goto(URL)
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(policy).toMatch(POLICY)
})

test('zero CSP violations through the whole loop', async ({ page }) => {
  const violations = await watchCsp(page)
  await page.goto(URL)
  await page.getByRole('button', { name: 'Open sample: candidates' }).click()
  await expect(page.getByText('Pair 1 of 3')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('Pair 2 of 3')).toBeVisible()

  const openAndClose = async (open: () => Promise<void>) => {
    await open()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  await openAndClose(() => page.getByRole('button', { name: 'Configure format' }).click())
  await openAndClose(() => page.keyboard.press('g'))
  await openAndClose(() => page.keyboard.press('l'))
  await openAndClose(() => page.keyboard.press('n'))
  await openAndClose(() => page.keyboard.press('Shift+?'))

  await page.getByRole('button', { name: 'Export' }).click()
  await downloadExport(page, 'kept.jsonl')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.keyboard.press('e')
  await expect(page.getByLabel('Edit content')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Edit content')).toHaveCount(0)

  await dropFile(page, 'second.jsonl', FLAT)
  await expect(page.getByRole('dialog', { name: 'Open another file' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  expect(await violations()).toEqual([])
})

test('makes no request outside the file', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.goto(URL)
  await page.getByRole('button', { name: 'Open sample: preference' }).click()
  await expect(page.getByText('Prompt 1 of 6')).toBeVisible()
  await page.getByRole('button', { name: 'Export' }).click()
  await downloadExport(page, 'pairs.jsonl')
  const allowed = process.env.LIVE_URL ? [new globalThis.URL(URL).href] : []
  const others = requests.filter((u) => !/^(file|blob|data):/.test(u) && !allowed.includes(u))
  expect(others).toEqual([])
})

test('first card within 5 s', async ({ page }) => {
  const start = Date.now()
  await page.goto(URL)
  await page.getByRole('button', { name: 'Open sample: candidates' }).click()
  await expect(page.getByRole('group').first()).toBeVisible()
  expect(Date.now() - start).toBeLessThan(5000)
})

test.describe('the shipped file', () => {
  test.skip(!!process.env.LIVE_URL, 'file:// checks of the local build (WP 7)')

  test('worker path: lines, groups, candidates', async ({ browser }) => {
    const flat = await browser.newPage()
    await flat.goto(DIST_URL)
    await flat.getByLabel('JSONL file').setInputFiles({ name: 'flat.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(FLAT) })
    await expect(flat.getByText('Prompt 1 of 2')).toBeVisible()
    await flat.getByRole('button', { name: 'Export' }).click()
    await expect(flat.getByRole('region', { name: 'all.decisions.jsonl' }).getByText('3 lines.')).toBeVisible()
    await flat.close()

    // The file input exists only on the empty page, so the second file opens in a fresh page
    const cand = await browser.newPage()
    await cand.goto(DIST_URL)
    await cand.getByLabel('JSONL file').setInputFiles({ name: 'cand.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(CANDIDATES) })
    await expect(cand.getByText('Prompt 1 of 2')).toBeVisible()
    await expect(cand.getByText('Pair 1 of 3')).toBeVisible()
    await cand.close()
  })

  test('a drop opens the file', async ({ page }) => {
    await page.goto(DIST_URL)
    await dropFile(page, 'flat.jsonl', FLAT)
    await expect(page.getByText('Prompt 1 of 2')).toBeVisible()
  })

  test('download session, reopen, load session restores decisions', async ({ browser }) => {
    const file = writeTmp('session-roundtrip.jsonl', FLAT)
    const first = await browser.newContext()
    const page = await first.newPage()
    await page.goto(DIST_URL)
    await page.getByLabel('JSONL file').setInputFiles(file)
    await expect(page.getByTestId('progress-text')).toContainText('0 / 2 prompts · 0 left')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('progress-text')).toContainText('1 / 2 prompts · 1 left')
    await page.getByRole('button', { name: 'Export' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download session' }).click(),
    ])
    // A context's downloads are deleted when it closes
    const saved = resolve('node_modules/.tmp/e2e-session.json')
    await download.saveAs(saved)
    await first.close()

    // A new context: IndexedDB is empty, so only the session file can restore the decision
    const second = await browser.newContext()
    const again = await second.newPage()
    await again.goto(DIST_URL)
    await again.getByLabel('JSONL file').setInputFiles(file)
    await expect(again.getByTestId('progress-text')).toContainText('0 / 2 prompts · 0 left')
    await again.getByRole('button', { name: 'Export' }).click()
    await again.getByLabel('Session file').setInputFiles(saved)
    await expect(again.getByTestId('progress-text')).toContainText('1 / 2 prompts · 1 left')
    await second.close()
  })

  test('notices are embedded', async () => {
    const html = readFileSync(resolve('dist/index.html'))
    const text = html.toString('utf8')
    const body = text.indexOf('<body>')
    const comment = text.indexOf('<!--', body)
    expect(body).toBeGreaterThan(-1)
    expect(comment).toBeGreaterThan(body)
    expect(text.indexOf('react@19.3.1', comment)).toBeGreaterThan(comment)
    expect(html.indexOf('<meta charset="UTF-8"')).toBeLessThan(1024)
  })
})
