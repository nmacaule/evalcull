import { test, expect, type Browser, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, openSync, statSync, utimesSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { DIST_URL, TMP, bytesOf, writeTmp } from './helpers'

// WP 7 measurements (plan Q5, Q6, Q8): run with npm run e2e:perf, never in CI.
// Bounds: PRD §5 Performance, and the owner's export thresholds: under 5 s; for an
// export downloaded from the browser, a peak RSS increase under 5 times the export's
// output size, median of three runs (owner, 6 Nov 2026, PRD §5, DR-013, DR-014): Chromium
// holds the output in the page, its blob store and the download pipeline, plus the read
// windows, so about 4 times the output is the floor of an in-memory download (E10: 3.86
// and 4.17 times). D-006's 3 times was a Node measurement and does not apply here.
// Memory method (owner, 6 Nov 2026): a forced-GC baseline. Before each run, a garbage
// collection through CDP (HeapProfiler.collectGarbage) and 2 s; then the RSS summed over
// every Chromium process (ps over the ids from SystemInfo.getProcessInfo), sampled every
// 100 ms from the click to the download event.

const MB100 = 100 * 1024 * 1024
// A fixed mtime, so the test knows each file's fingerprint (name:size:lastModified)
const MTIME_S = 1_794_700_800

function generate(name: string, lineCount: number, lineAt: (i: number) => string): string {
  const file = join(TMP, name)
  if (!existsSync(file)) {
    writeTmp(name, '')
    const fd = openSync(file, 'w')
    let chunk = ''
    for (let i = 0; i < lineCount; i++) {
      chunk += lineAt(i)
      if (chunk.length > 8 * 1024 * 1024) {
        writeSync(fd, chunk)
        chunk = ''
      }
    }
    writeSync(fd, chunk)
    closeSync(fd)
  }
  utimesSync(file, MTIME_S, MTIME_S)
  return file
}

// §5's input: 100 MB in 100,000 distinct flat records
const LINES_100K = 100_000
const PAD = Math.floor(MB100 / LINES_100K) - '{"instruction":"p000000","output":""}\n'.length
const line100k = (i: number) => `{"instruction":"p${String(i).padStart(6, '0')}","output":"${'x'.repeat(PAD)}"}\n`

// The Node bench's file (scripts/bench-indexer.mjs:34): the 92-byte line, 1,139,760 times
const BENCH_LINE = '{"id":12345,"text":"This is a sample line for benchmarking the JSONL indexer performance."}\n'
const BENCH_LINES = 1_139_760
const BENCH_BYTES = 104_857_920
const EDITED_LINE = '{"id":12345,"text":"edited"}\n'

function note(label: string, value: unknown) {
  test.info().annotations.push({ type: label, description: JSON.stringify(value) })
  process.stdout.write(`${label}: ${JSON.stringify(value)}\n`)
}

async function measures(page: Page) {
  return page.evaluate(() => {
    const m = (n: string) => performance.getEntriesByName(n)[0] as PerformanceEntry | undefined
    const start = m('evalcull:index:start')!.startTime
    return {
      firstPass: m('evalcull:first-pass')!.duration,
      secondPass: m('evalcull:second-pass')!.duration,
      indexTotal: m('evalcull:second-pass:end')!.startTime - start,
      longTasks: (window as unknown as { __longTasks: number[] }).__longTasks,
    }
  })
}

async function watchLongTasks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(e.duration)
    }).observe({ type: 'longtask', buffered: true })
  })
}

/** Summed RSS in bytes of every Chromium process, read with ps by the ids CDP reports. */
async function rss(browser: Browser): Promise<number> {
  const cdp = await browser.newBrowserCDPSession()
  const { processInfo } = (await cdp.send('SystemInfo.getProcessInfo')) as { processInfo: { id: number }[] }
  await cdp.detach()
  const out = execFileSync('ps', ['-o', 'rss=', '-p', processInfo.map((p) => p.id).join(',')], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean).reduce((sum, kb) => sum + Number(kb.trim()) * 1024, 0)
}

test('@perf M1 100 MB / 100k lines indexes under 3 s, with M2 record open and M3 long tasks', async ({ page }) => {
  const file = generate('perf-100k.jsonl', LINES_100K, line100k)
  await watchLongTasks(page)
  await page.goto(DIST_URL)
  await page.getByLabel('JSONL file').setInputFiles(file)
  await expect(page.getByText(`Record 1 of ${LINES_100K}`)).toBeVisible({ timeout: 60_000 })
  const m = await measures(page)
  note('M1 100k-line file', { bytes: statSync(file).size, ...m, longTasks: undefined })
  note('M3 long tasks during load (ms)', m.longTasks)
  expect(m.indexTotal).toBeLessThan(3000)
  expect(m.longTasks.filter((d) => d > 100)).toEqual([])

  // M2: twenty J presses, each timed in the page from keydown to the card's text changing
  const times: number[] = []
  for (let i = 0; i < 20; i++) {
    // The listeners are installed and this evaluate has returned before the key is pressed
    await page.evaluate(() => {
      const w = window as unknown as { __open: Promise<number> }
      const before = document.querySelector('section[aria-label="Prompt"]')?.textContent
      w.__open = new Promise<number>((resolve) => {
        let t0 = 0
        document.addEventListener('keydown', () => (t0 = performance.now()), { capture: true, once: true })
        // The prompt header renders the loaded record's own instruction; every record's output is the same filler
        const observer = new MutationObserver(() => {
          const now = document.querySelector('section[aria-label="Prompt"]')?.textContent
          if (t0 && now !== undefined && now !== before) {
            observer.disconnect()
            resolve(performance.now() - t0)
          }
        })
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        setTimeout(() => {
          observer.disconnect()
          resolve(Number.POSITIVE_INFINITY)
        }, 10_000)
      })
    })
    await page.keyboard.press('j')
    times.push(await page.evaluate(() => (window as unknown as { __open: Promise<number> }).__open))
    await expect(page.getByText(`Record ${i + 2} of ${LINES_100K}`)).toBeVisible()
  }
  note('M2 record open (ms)', times)
  expect(times.filter((t) => t >= 50)).toEqual([])
})

test('@perf M1b the bench file, beside the Node bench', async ({ page }) => {
  const file = generate('bench.jsonl', BENCH_LINES, () => BENCH_LINE)
  expect(statSync(file).size).toBe(BENCH_BYTES)
  await watchLongTasks(page)
  await page.goto(DIST_URL)
  await page.getByLabel('JSONL file').setInputFiles(file)
  await expect(page.getByText(`of ${BENCH_LINES}`)).toBeVisible({ timeout: 120_000 })
  const m = await measures(page)
  note('M1b bench file (Node bench: first 435 ms, second 668 ms)', { ...m, longTasks: m.longTasks.length })
})

test('@perf M5 million-line export: kept.jsonl and all.decisions.jsonl', async ({ page, browser }) => {
  const file = generate('bench.jsonl', BENCH_LINES, () => BENCH_LINE)
  const name = 'bench.jsonl'
  const fingerprint = createHash('sha256').update(`${name}:${BENCH_BYTES}:${MTIME_S * 1000}`).digest('hex')

  // Every line kept, every 100th line edited: 11,398 edits
  const parts: string[] = []
  for (let i = 0; i < BENCH_LINES; i++) {
    parts.push(
      i % 100 === 0
        ? `"${i}":{"status":"kept","edits":{"text":"edited"},"updatedAt":1}`
        : `"${i}":{"status":"kept","updatedAt":1}`
    )
  }
  const session = writeTmp(
    'm5-session.json',
    `{"version":3,"fingerprint":"${fingerprint}","sourceName":"${name}","sourceKind":"jsonl",` +
      `"format":{"kind":"unknown"},"decisions":{${parts.join(',')}},"cursor":0,"history":[],"savedAt":1}`
  )

  await page.goto(DIST_URL)
  await page.getByLabel('JSONL file').setInputFiles(file)
  await expect(page.getByText(`of ${BENCH_LINES}`)).toBeVisible({ timeout: 120_000 })
  // An unknown format opens the mapping modal once; Cancel keeps it closed (D-069)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByLabel('Session file').setInputFiles(session)
  await expect(page.getByRole('region', { name: 'kept.jsonl' }).getByText(`${BENCH_LINES.toLocaleString('en-US')} lines.`)).toBeVisible({
    timeout: 120_000,
  })
  // Let the import's own allocations settle, so the RSS baseline is the export's (D-094)
  await page.waitForTimeout(2000)

  const expectedKept = createHash('sha256')
  for (let i = 0; i < BENCH_LINES; i++) expectedKept.update(i % 100 === 0 ? EDITED_LINE : BENCH_LINE)
  const keptSize = BENCH_BYTES + 11_398 * (EDITED_LINE.length - BENCH_LINE.length)

  const keptHash = expectedKept.digest('hex')
  const cdp = await page.context().newCDPSession(page)
  // all.decisions.jsonl, by hand: an unedited line keeps its 90 bytes up to the closing
  // brace, then ,"_triage": (11), {"status":"kept","edited":false,"updatedAt":1} (46),
  // } and LF: 149 bytes; an edited line {"id":12345,"text":"edited" (27), ,"_triage":
  // (11), the edited:true triage (45), } and LF: 85 bytes (DR-014)
  const allSize = (BENCH_LINES - 11_398) * 149 + 11_398 * 85
  // Memory bound, median of three runs: 5 times each export's output (owner, 6 Nov 2026)
  const bounds = { 'kept.jsonl': { size: keptSize, memory: 5 * keptSize }, 'all.decisions.jsonl': { size: allSize, memory: 5 * allSize } }
  const medians: Record<string, { median: number; bound: number }> = {}
  for (const [exportName, bound] of Object.entries(bounds)) {
    const increases: number[] = []
    for (let run = 1; run <= 3; run++) {
      // Collect the previous export's garbage first, so the baseline is this run's: without
      // it the baseline climbs by about one export per run (probe, 6 Nov 2026: RSS fell from
      // 1,522 MB to 1,091 MB on a forced collection, the JS heap steady at 195 MB)
      await cdp.send('HeapProfiler.collectGarbage')
      await page.waitForTimeout(2000)
      const before = await rss(browser)
      let peak = before
      let sampling = true
      const sampler = (async () => {
        while (sampling) {
          peak = Math.max(peak, await rss(browser))
          await new Promise((r) => setTimeout(r, 100))
        }
      })()
      const t0 = Date.now()
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120_000 }),
        page.getByRole('button', { name: `Download ${exportName}` }).click(),
      ])
      const ms = Date.now() - t0
      sampling = false
      await sampler
      const increase = peak - before
      increases.push(increase)
      note(`M5 ${exportName} run ${run}`, { ms, rssBefore: before, rssPeak: peak, increase, ofFile: increase / BENCH_BYTES, ofOutput: increase / bound.size })
      const bytes = await bytesOf(download)
      expect(bytes.length).toBe(bound.size)
      if (exportName === 'kept.jsonl') expect(createHash('sha256').update(bytes).digest('hex')).toBe(keptHash)
      expect(ms).toBeLessThan(5000)
    }
    const median = [...increases].sort((a, b) => a - b)[1]
    note(`M5 ${exportName} median RSS increase`, { median, ofFile: median / BENCH_BYTES, ofOutput: median / bound.size })
    medians[exportName] = { median, bound: bound.memory }
  }
  // Both exports are measured before either memory bound is judged
  for (const { median, bound } of Object.values(medians)) expect(median).toBeLessThan(bound)
})

test('@perf M4 page close shortly after a change (vite preview, http)', async ({ browser }) => {
  const file = writeTmp('m4.jsonl', ['{"instruction":"p0","output":"a"}', '{"instruction":"p1","output":"b"}'].join('\n') + '\n')
  const results: Record<string, string> = {}
  for (const delay of [0, 100, 500]) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/')
    await page.getByLabel('JSONL file').setInputFiles(file)
    await expect(page.getByText('Record 1 of 2')).toBeVisible()
    await page.keyboard.press('a')
    await page.waitForTimeout(delay)
    await page.close({ runBeforeUnload: false })

    const again = await context.newPage()
    await again.goto('/')
    await again.getByLabel('JSONL file').setInputFiles(file)
    await expect(again.getByText(/Record \d of 2/)).toBeVisible()
    const progress = await again.getByTestId('progress-text').textContent()
    const offer = await again.getByText(/newer copy/i).count()
    results[`${delay} ms`] = `${progress}${offer ? ' (newer-copy offer)' : ''}`
    await context.close()
  }
  note('M4 after close, reopened', results)
})
