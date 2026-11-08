import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Download, Page } from '@playwright/test'

/** The single file build:single writes, apart from npm run build's dist/ (DR-037, D-112). */
export const SINGLE_FILE = resolve('dist-single/index.html')

/** The single file opened from disk, as an SME would (PRD §3.9). */
export const DIST_URL = pathToFileURL(SINGLE_FILE).href

/** Scratch files stay inside the repository: node_modules/.tmp is git-ignored. */
export const TMP = resolve('node_modules/.tmp/e2e')

export function writeTmp(name: string, content: string | Buffer): string {
  mkdirSync(TMP, { recursive: true })
  const file = join(TMP, name)
  writeFileSync(file, content)
  return file
}

/** One securitypolicyviolation event, as the page saw it. */
export interface CspReport {
  directive: string
  blocked: string
  /** The target element's tag name, or the node name of a non-element target */
  target: string
  sample: string
}

/** Collects CSP violation events and CSP console errors from the page's start. */
async function collectCsp(page: Page): Promise<() => Promise<{ events: CspReport[]; console: string[] }>> {
  const consoleHits: string[] = []
  page.on('console', (m) => {
    // Chromium and WebKit write "Content Security Policy", Firefox "Content-Security-Policy:" (WP 7c)
    if (/Content[ -]Security[ -]Policy/.test(m.text())) consoleHits.push(m.text())
  })
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: unknown[] }
    w.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (e) => {
      const t = e.target as Element | Node | null
      w.__cspViolations.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        target: t && 'tagName' in t ? t.tagName : (t?.nodeName ?? ''),
        sample: e.sample,
      })
    })
  })
  return async () => ({
    events: await page.evaluate(() => (window as unknown as { __cspViolations: CspReport[] }).__cspViolations),
    console: [...consoleHits],
  })
}

/** Collects CSP violations and CSP console errors from the page's start. */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const collected = await collectCsp(page)
  return async () => {
    const { events, console } = await collected()
    return [...events.map((e) => `${e.directive} ${e.blocked}`), ...console]
  }
}

/**
 * The one report the single-file spec ignores (owner, 7 Nov 2026, DR-026): WebKit
 * reports style-src-attr from its own native select under a hash-only style-src,
 * with no author style set and nothing visible or usable changed.
 */
export function isWebKitSelectReport(browserName: string, e: CspReport): boolean {
  return browserName === 'webkit' && e.directive === 'style-src-attr' && e.target === 'SELECT' && e.sample === ''
}

/** WebKit's console line for a refused style attribute, paired one for one with an ignored event. */
const WEBKIT_STYLE_REFUSAL = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/

/**
 * As watchCsp, without DR-026's WebKit select report: each ignored event takes
 * one WebKit style-refusal console line with it, and nothing else is dropped.
 */
export async function watchCspExceptWebKitSelect(
  page: Page,
  browserName: string
): Promise<() => Promise<{ violations: string[]; ignored: number }>> {
  const collected = await collectCsp(page)
  return async () => {
    const { events, console } = await collected()
    const kept = events.filter((e) => !isWebKitSelectReport(browserName, e))
    let ignored = events.length - kept.length
    const lines = console.filter((line) => {
      if (ignored > 0 && WEBKIT_STYLE_REFUSAL.test(line)) {
        ignored--
        return false
      }
      return true
    })
    return { violations: [...kept.map((e) => `${e.directive} ${e.blocked}`), ...lines], ignored: events.length - kept.length }
  }
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
