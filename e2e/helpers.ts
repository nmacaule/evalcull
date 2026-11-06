import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Download, Page } from '@playwright/test'

/** The single file opened from disk, as an SME would (PRD §3.9). */
export const DIST_URL = pathToFileURL(resolve('dist/index.html')).href

/** Scratch files stay inside the repository: node_modules/.tmp is git-ignored. */
export const TMP = resolve('node_modules/.tmp/e2e')

export function writeTmp(name: string, content: string | Buffer): string {
  mkdirSync(TMP, { recursive: true })
  const file = join(TMP, name)
  writeFileSync(file, content)
  return file
}

/** Collects CSP violations and CSP console errors from the page's start. */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const consoleHits: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy/.test(m.text())) consoleHits.push(m.text())
  })
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] }
    w.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`)
    })
  })
  return async () => [
    ...(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)),
    ...consoleHits,
  ]
}

/** The bytes of a download. */
export async function bytesOf(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Clicks an export's Download button in the open Export panel and returns the file's bytes. */
export async function downloadExport(page: Page, name: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `Download ${name}` }).click(),
  ])
  return bytesOf(download)
}

/** Dispatches a drop of one file on the page, through the app's own window listener. */
export async function dropFile(page: Page, name: string, text: string): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ([n, t]) => {
      const dt = new DataTransfer()
      dt.items.add(new File([t], n))
      return dt
    },
    [name, text] as const
  )
  await page.dispatchEvent('body', 'dragover', { dataTransfer })
  await page.dispatchEvent('body', 'drop', { dataTransfer })
}
