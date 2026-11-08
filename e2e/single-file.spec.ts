import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DIST_URL, SINGLE_FILE, downloadExport, dropFile, watchCsp, watchCspExceptWebKitSelect, writeTmp } from './helpers'

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

// DR-026 (owner, 7 Nov 2026): WebKit's report from its own native select is the one
// report ignored; every other report in every engine fails the test
test('zero CSP violations through the whole loop', async ({ page, browserName }) => {
  const watched = await watchCspExceptWebKitSelect(page, browserName)
  const violations = async () => (await watched()).violations
  await page.goto(URL)
  await page.getByRole('button', { name: 'Open sample: candidates' }).click()
  await expect(page.getByText('Comparison 1 of 3 · 4 responses')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('Comparison 2 of 3 · 4 responses')).toBeVisible()

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

// DR-026: the ignore fires only in WebKit, and an author style attribute on a select
// is still reported in Chromium and Firefox. In WebKit the select's own report and an
// author attribute on a select look alike (style-src-attr, a select, no sample), so
// both are ignored there: the risk DR-026 records
test('DR-026: the WebKit select ignore is WebKit only; an author style on a select still fails elsewhere', async ({ page, browserName }) => {
  const watched = await watchCspExceptWebKitSelect(page, browserName)
  await page.goto(URL)
  await page.evaluate(() => {
    const select = document.createElement('select')
    select.setAttribute('style', 'color: rgb(255, 0, 0)')
    document.body.appendChild(select)
  })
  // WebKit: one report for the select it creates, one for the author attribute
  const expected = browserName === 'webkit' ? { styleAttrReported: false, ignored: 2 } : { styleAttrReported: true, ignored: 0 }
  await expect
    .poll(async () => {
      const { violations, ignored } = await watched()
      return { styleAttrReported: violations.includes('style-src-attr inline'), ignored }
    })
    .toEqual(expected)
})

// D-105 (WP 7c): served over http, Firefox asks for /favicon.ico, which img-src data: blocks;
// the page declares its own icon. vite preview serves the build:single output in dist-single
test('D-105: no CSP violation from the browser icon request over http', async ({ page }) => {
  const violations = await watchCsp(page)
  await page.goto(process.env.LIVE_URL ?? '/')
  await page.waitForLoadState('networkidle')
  expect(await violations()).toEqual([])
})

// PRD §5 Persistence (WP 7c): the storage indicator's word after one decision. Observed
// 7 Nov 2026 from file:// in Playwright Chromium, WebKit 27.2 and Firefox 157.0: "Saved" in each
test('Persistence: a decision is saved, and the indicator says so', async ({ page }) => {
  const DISTINCT = ['{"instruction":"p0","output":"a"}', '{"instruction":"p1","output":"b"}'].join('\n') + '\n'
  await page.goto(URL)
  await page.getByLabel('JSONL file').setInputFiles({ name: 'persist.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(DISTINCT) })
  await expect(page.getByRole('status').filter({ hasText: 'No unsaved changes' })).toBeVisible()
  await page.keyboard.press('a')
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
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

// WP 7d (plan step 2.7; §5 CSP and Privacy): the new surfaces in use raise no CSP report and make
// no request: the first-use hint, the single-key switch, the action bar and the resume line
test('the learnability surfaces raise no CSP violation and make no request', async ({ page, browserName }) => {
  const watched = await watchCspExceptWebKitSelect(page, browserName)
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.goto(URL)
  await page.getByRole('button', { name: 'Open sample: candidates' }).click()
  await expect(page.locator('[data-hint]')).toBeVisible()
  await page.getByRole('button', { name: 'Got it' }).click()
  await page.getByRole('button', { name: /^Keyboard shortcuts/ }).click()
  await page.getByLabel('Single-key shortcuts').uncheck()
  await page.getByLabel('Single-key shortcuts').check()
  await page.keyboard.press('Escape')
  const bar = page.getByRole('region', { name: 'Review actions' })
  await bar.getByRole('button', { name: /^Left is better/ }).click()
  await bar.getByRole('button', { name: /^Better/ }).click()
  await bar.getByRole('button', { name: /^Details/ }).click()
  await expect(page.locator('[role="status"]:not([data-resume-status])').filter({ hasText: /^Saved$/ })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Open sample: candidates' }).click()
  await expect(page.locator('[data-resume-line]')).toBeVisible()
  expect((await watched()).violations).toEqual([])
  const allowed = process.env.LIVE_URL ? [new globalThis.URL(URL).href] : []
  expect(requests.filter((u) => !/^(file|blob|data):/.test(u) && !allowed.includes(u))).toEqual([])
})

test('first card within 5 s', async ({ page }) => {
  const start = Date.now()
  await page.goto(URL)
  await page.getByRole('button', { name: 'Open sample: candidates' }).click()
  await expect(page.getByRole('group').first()).toBeVisible()
  expect(Date.now() - start).toBeLessThan(5000)
  // A card, not another group: the action region is a region (DR-028)
  await expect(page.getByRole('group').first()).toHaveAttribute('data-candidate-ref', /.+/)
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
    await expect(cand.getByText('Comparison 1 of 3 · 4 responses')).toBeVisible()
    await cand.close()
  })

  // D-100 (WP 7c): Safari never indexed the file from file://. The sample is an
  // in-memory File; the second page opens a file from disk, the read the console's
  // "I/O read operation failed" names
  test('D-100: the single file from file:// indexes', async ({ browser }) => {
    const messages: string[] = []
    const collect = (page: Page) => {
      page.on('console', (m) => messages.push(`console ${m.type()}: ${m.text()}`))
      page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`))
      page.on('worker', (w) => messages.push(`worker: ${w.url()}`))
    }

    const sample = await browser.newPage()
    collect(sample)
    await sample.goto(DIST_URL)
    await sample.getByRole('button', { name: 'Open sample: candidates' }).click()
    const sampleOpened = sample.getByText('Comparison 1 of 3 · 4 responses').waitFor({ timeout: 10_000 }).then(() => true, () => false)

    const disk = await browser.newPage()
    collect(disk)
    await disk.goto(DIST_URL)
    await disk.getByLabel('JSONL file').setInputFiles(writeTmp('d100.jsonl', CANDIDATES))
    const diskOpened = disk.getByText('Comparison 1 of 3 · 4 responses').waitFor({ timeout: 10_000 }).then(() => true, () => false)

    const opened = { sample: await sampleOpened, disk: await diskOpened }
    process.stdout.write(`D-100 collected (${test.info().project.name}):\n${messages.join('\n')}\n`)
    expect({ opened, errors: messages.filter((m) => /NotReadableError|Cannot load blob:/.test(m)) }).toEqual({
      opened: { sample: true, disk: true },
      errors: [],
    })
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
    const html = readFileSync(SINGLE_FILE)
    const text = html.toString('utf8')
    const body = text.indexOf('<body>')
    const comment = text.indexOf('<!--', body)
    expect(body).toBeGreaterThan(-1)
    expect(comment).toBeGreaterThan(body)
    expect(text.indexOf('react@19.3.1', comment)).toBeGreaterThan(comment)
    expect(html.indexOf('<meta charset="UTF-8"')).toBeLessThan(1024)
  })
})
