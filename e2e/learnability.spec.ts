import { test, expect, type Page, type Locator } from '@playwright/test'
import { DIST_URL } from './helpers'
import { SCREENS as DESIGN_STATES } from './design/screens'

// WP 7d (DR-028, DR-033): every action has a visible control on every review screen, and the
// control does what its key does. Oracle: the actions PRD §2.2 gives each screen and the
// change each makes, written by hand; activation by click and by Enter on the focused control.

const FLAT = ['{"instruction":"Name a colour.","output":"Deep blue sky."}', '{"instruction":"Name a fruit.","output":"A pear."}']
  .join('\n') + '\n'

async function hintsSeen(page: Page) {
  await page.addInitScript(() => localStorage.setItem('evalcull.hints', JSON.stringify(['compare', 'round2', 'single'])))
}
async function compare(page: Page) {
  await hintsSeen(page)
  await page.goto(DIST_URL)
  await page.getByRole('button', { name: 'Open sample: candidates' }).click()
  await expect(page.getByText('Comparison 1 of 3 · 4 responses')).toBeVisible()
}
const ONE = ['{"prompt":"Only one","responses":["just one"]}', '{"prompt":"Q","responses":["x","y"]}'].join('\n') + '\n'
async function oneCandidate(page: Page) {
  await hintsSeen(page)
  await page.goto(DIST_URL)
  await page.getByLabel('JSONL file').setInputFiles({ name: 'one.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(ONE) })
  await expect(page.getByText('Only one candidate for this prompt')).toBeVisible()
}
async function single(page: Page) {
  await hintsSeen(page)
  await page.goto(DIST_URL)
  await page.getByLabel('JSONL file').setInputFiles({ name: 'flat.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(FLAT) })
  await expect(page.getByText('Record 1 of 2')).toBeVisible()
}

const bar = (page: Page) => page.getByRole('region', { name: 'Review actions' })
const progress = (page: Page) => page.getByTestId('progress-text')
const focusedCard = (page: Page) => page.locator('[role="group"][aria-current="true"]')

interface Action {
  name: RegExp
  /** Where the control is: the action bar or the header */
  where?: 'header'
  /** Other controls pressed first, by click, so the action has something to act on */
  before?: RegExp[]
  done: (page: Page) => Promise<void>
}

const SHARED: Action[] = [
  { name: /^Keep/, done: async (p) => expect(focusedCard(p)).toContainText('kept') },
  { name: /^Reject/, done: async (p) => expect(focusedCard(p)).toContainText('rejected') },
  { name: /^Skip/, done: async (p) => expect(focusedCard(p)).toContainText('skipped') },
  { name: /^Edit/, done: async (p) => expect(p.getByLabel('Edit content')).toBeVisible() },
  { name: /^Undo/, before: [/^Keep/], done: async (p) => expect(p.getByText('kept', { exact: true })).toHaveCount(0) },
  { name: /^Redo/, before: [/^Keep/, /^Undo/], done: async (p) => expect(p.getByText('kept', { exact: true })).toHaveCount(1) },
  { name: /^Whitespace/, done: async (p) => expect(p.locator('[data-ws-mark]').first()).toBeVisible() },
  { name: /^Text size/, done: async (p) => expect(p.locator('html')).toHaveAttribute('data-reading-step', /.*/) },
  { name: /^Details/, done: async (p) => expect(p.getByRole('region', { name: 'Metadata' })).toBeVisible() },
  { name: /^Labels/, done: async (p) => expect(p.getByRole('dialog', { name: 'Labels and notes' })).toBeVisible() },
  { name: /^Notes/, done: async (p) => expect(p.getByRole('dialog', { name: 'Labels and notes' })).toBeVisible() },
  { name: /^Go to/, done: async (p) => expect(p.getByRole('dialog')).toBeVisible() },
  { name: /^Search/, done: async (p) => expect(p.getByRole('textbox', { name: 'Search' })).toBeVisible() },
  { name: /^Filter/, done: async (p) => expect(p.getByText('Filter: unreviewed')).toBeVisible() },
  { name: /^Export$/, where: 'header', done: async (p) => expect(p.getByRole('dialog')).toBeVisible() },
  { name: /^Configure format$/, where: 'header', done: async (p) => expect(p.getByRole('dialog', { name: 'How to read this file' })).toBeVisible() },
  { name: /^Keyboard shortcuts/, where: 'header', done: async (p) => expect(p.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible() },
]

const SCREENS: { name: string; open: (page: Page) => Promise<void>; actions: Action[] }[] = [
  {
    name: 'compare',
    open: compare,
    actions: [
      { name: /^Left is better/, done: async (p) => expect(progress(p)).toContainText('1 left') },
      { name: /^Right is better/, done: async (p) => expect(progress(p)).toContainText('1 right') },
      { name: /^Tie/, done: async (p) => expect(progress(p)).toContainText('1 tie') },
      { name: /^Both bad/, done: async (p) => expect(progress(p)).toContainText('1 both bad') },
      { name: /^Much better/, before: [/^Left is better/], done: async (p) => expect(bar(p).getByRole('button', { name: /^Much better/ })).toHaveAttribute('aria-pressed', 'true') },
      { name: /^Better/, before: [/^Left is better/], done: async (p) => expect(bar(p).getByRole('button', { name: /^Better/ })).toHaveAttribute('aria-pressed', 'true') },
      { name: /^Slightly better/, before: [/^Left is better/], done: async (p) => expect(bar(p).getByRole('button', { name: /^Slightly better/ })).toHaveAttribute('aria-pressed', 'true') },
      { name: /^Next/, done: async (p) => expect(p.getByText('Prompt 2 of 4')).toBeVisible() },
      { name: /^Previous/, done: async (p) => expect(p.getByText('Prompt 4 of 4')).toBeVisible() },
      { name: /^Raw/, done: async (p) => expect(focusedCard(p)).toContainText('"responses"') },
      ...SHARED,
    ],
  },
  {
    // One candidate: the preferences are disabled (tested below); every other action applies
    name: 'one-candidate',
    open: oneCandidate,
    actions: [
      { name: /^Next/, done: async (p) => expect(p.getByText('Prompt 2 of 2')).toBeVisible() },
      { name: /^Previous/, done: async (p) => expect(p.getByText('Prompt 2 of 2')).toBeVisible() },
      { name: /^Raw/, done: async (p) => expect(focusedCard(p)).toContainText('"responses"') },
      ...SHARED,
    ],
  },
  {
    name: 'single',
    open: single,
    actions: [
      { name: /^Next/, done: async (p) => expect(p.getByText('Record 2 of 2')).toBeVisible() },
      { name: /^Previous/, done: async (p) => expect(p.getByText('Record 2 of 2')).toBeVisible() },
      { name: /^Raw/, done: async (p) => expect(focusedCard(p)).toContainText('"instruction"') },
      // Keep, Reject and Skip advance in single mode (WP 3 d), so the record's status is read back with K
      ...SHARED.map((a) =>
        /Keep|Reject|Skip/.test(a.name.source)
          ? { ...a, done: async (p: Page) => expect(progress(p)).toContainText(`1 ${a.name.source.replace('^', '').toLowerCase().replace('keep', 'kept').replace('reject', 'rejected').replace('skip', 'skipped')}`) }
          : /Undo|Redo/.test(a.name.source)
            ? { ...a, done: async (p: Page) => expect(progress(p)).toContainText(a.name.source.includes('Undo') ? '0 kept' : '1 kept') }
            : a
      ),
    ],
  },
]

// Keyboard reach: Shift+Tab from the page until the control has focus. In compare mode Tab is candidate
// focus (DR-023), so Shift+Tab is the keyboard route to every control there
// A click on empty space below the bar sets the starting point of sequential focus navigation there
// (HTML), so backward navigation begins at the bar. Playwright's WebKit, like Safari by default, leaves
// buttons out of the Tab order and offers no switch for "Press Tab to highlight each item", so in WebKit
// the control is focused directly: activation by Enter is shown there, the keyboard route in Chromium
// and Firefox (owner-approved, 8 Nov 2026; the owner's Safari check before merge covers Option+Tab)
async function reach(page: Page, target: Locator, browserName: string) {
  if (browserName === 'webkit') {
    await target.focus()
    return
  }
  const vp = page.viewportSize()!
  await page.mouse.click(4, vp.height - 4)
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Shift+Tab')
    if (await target.evaluate((el) => el === document.activeElement)) return
  }
  throw new Error('not reachable with Shift+Tab')
}

function control(page: Page, a: Action): Locator {
  return a.where === 'header' ? page.locator('header').getByRole('button', { name: a.name }) : bar(page).getByRole('button', { name: a.name })
}

for (const screen of SCREENS) {
  test.describe(`${screen.name}: every action has a visible control`, () => {
    for (const a of screen.actions) {
      for (const how of ['click', 'Enter'] as const) {
        test(`${a.name.source} by ${how}`, async ({ page, browserName }) => {
          await screen.open(page)
          for (const b of a.before ?? []) await bar(page).getByRole('button', { name: b }).click()
          const c = control(page, a)
          await expect(c).toBeVisible()
          if (how === 'click') await c.click()
          else {
            await reach(page, c, browserName)
            await page.keyboard.press('Enter')
          }
          await a.done(page)
        })
      }
    }
  })
}

// Layout rulings (owner, 8 Nov 2026): §2.11 screen 2, the header's buttons wrap as one group,
// aligned right; the action bar's Undo and Redo wrap as a pair, never apart
async function rowsOf(page: Page, names: RegExp[], within: Locator): Promise<number[]> {
  const out: number[] = []
  // Vertical centres: a button holding a keycap is taller than one without, on the same row
  for (const n of names) {
    const b = (await within.getByRole('button', { name: n }).boundingBox())!
    out.push(Math.round(b.y + b.height / 2))
  }
  return out
}

test.describe('layout groups', () => {
  for (const width of [1280, 1440]) {
    test(`at ${width} px in compare mode the header's three buttons share one row, aligned right`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await compare(page)
      const header = page.locator('header')
      const t = await rowsOf(page, [/^Configure format$/, /^Export$/, /^Keyboard shortcuts/], header)
      expect(new Set(t).size).toBe(1)
      const last = (await header.getByRole('button', { name: /^Keyboard shortcuts/ }).boundingBox())!
      const box = (await header.boundingBox())!
      const padRight = await header.evaluate((h) => parseFloat(getComputedStyle(h).paddingRight))
      expect(Math.round(box.x + box.width - padRight - (last.x + last.width))).toBeLessThanOrEqual(1)
    })

    for (const open of [compare, single]) {
      test(`at ${width} px Undo and Redo share one row (${open.name})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await open(page)
        const t = await rowsOf(page, [/^Undo/, /^Redo/], bar(page))
        expect(t[0]).toBe(t[1])
      })
    }
  }
})

// WCAG 2.2 SC 1.4.10 Reflow: content works at 320 CSS px wide with no horizontal scrolling, on every
// §2.11 screen state (owner, 8 Nov 2026; found in WP 7d: the header's button group did not wrap inside itself)
test.describe('reflow at 320 CSS px', () => {
  for (const state of DESIGN_STATES) {
    test(`${state.n} ${state.screen}, ${state.state}: no horizontal scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 })
      await state.go(page)
      const r = await page.evaluate(() => {
        const client = document.documentElement.clientWidth
        // The innermost elements past the right edge, as evidence when the check fails
        const past = [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > client + 1)
          .filter((el) => ![...el.children].some((c) => c.getBoundingClientRect().right > client + 1))
          .slice(0, 4)
          .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().right)}`)
        return { scroll: document.documentElement.scrollWidth, client, past }
      })
      expect(r.scroll, r.past.join('; ')).toBeLessThanOrEqual(r.client)
    })
  }
})

test('on a one-candidate prompt the preference buttons are disabled', async ({ page }) => {
  await oneCandidate(page)
  for (const n of [/^Left is better/, /^Tie/, /^Both bad/, /^Right is better/]) await expect(bar(page).getByRole('button', { name: n })).toBeDisabled()
})

// DR-029: the switch is a browser preference, so turning it off holds across a reload
test('single-key shortcuts turned off stay off after a reload', async ({ page }) => {
  await compare(page)
  await page.getByRole('button', { name: /^Keyboard shortcuts/ }).click()
  await page.getByLabel('Single-key shortcuts').uncheck()
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: 'Open sample: candidates' }).click()
  await expect(page.getByText(/^Comparison \d of 3/)).toBeVisible()
  await page.keyboard.press('a')
  await expect(keptMarks(page)).toHaveCount(0)
  await page.getByRole('button', { name: /^Keyboard shortcuts/ }).click()
  await expect(page.getByLabel('Single-key shortcuts')).not.toBeChecked()
})
const keptMarks = (page: Page) => page.getByText('kept', { exact: true })
