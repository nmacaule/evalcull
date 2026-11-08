/**
 * Drives the built single file to each screen of PRD §2.11's list, and to the
 * states the contrast table needs (hover, pressed, selected, disabled), for
 * e2e/design.spec.ts and e2e/screens.spec.ts. A new screen or state is added
 * here and in the screenshot run in the same change (the ui rules).
 */

import { expect, type Page } from '@playwright/test'
import { DIST_URL, dropFile } from '../helpers'

/** A four-candidate prompt, three two-candidate prompts and one more (compare mode) */
const COMPARE = [
  '{"prompt":"Greet a new colleague","responses":["Hi","Hello","Hey there","Good morning"]}',
  '{"prompt":"Q","responses":["x","y"]}',
  '{"prompt":"R","responses":["m","n"]}',
  '{"prompt":"S","responses":["s1","s2"]}',
  '{"prompt":"T","responses":["t1","t2"]}',
].join('\n') + '\n'

/** Distinct prompts (single mode); an unsafe integer for the metadata badge */
const SINGLE = [
  '{"instruction":"p0","output":"a ","id":9007199254740993}',
  '{"instruction":"p1","output":"b"}',
  '{"instruction":"p2","output":"c"}',
  '{"instruction":"p3","output":"d"}',
].join('\n') + '\n'

/** A conversation per line, sharing no prompt; trailing spaces for W */
const CONVERSATION = [
  '{"messages":[{"role":"system","content":"Be brief. "},{"role":"user","content":"Hi\\tthere"},{"role":"assistant","content":"Hello. "}]}',
  '{"messages":[{"role":"user","content":"Q2"},{"role":"assistant","content":"A2"}]}',
].join('\n') + '\n'

/** One conversation of 24 turns, so its editable turns reach the bottom of the viewport */
const LONG_CONVERSATION =
  JSON.stringify({
    messages: Array.from({ length: 24 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${i + 1}`,
    })),
  }) + '\n'

/** A BOM file, for the export panel's BOM warning */
const BOM = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"instruction":"p","output":"o"}\n')])

async function open(page: Page, name: string, body: string | Buffer): Promise<void> {
  await page.goto(DIST_URL)
  await page.getByLabel('JSONL file').setInputFiles({
    name,
    mimeType: 'application/jsonl',
    buffer: typeof body === 'string' ? Buffer.from(body) : body,
  })
}

const cards = (page: Page) => page.getByRole('group')

async function compare(page: Page): Promise<void> {
  await open(page, 'compare.jsonl', COMPARE)
  await expect(page.getByText('Comparison 1 of 3 · 4 responses')).toBeVisible()
}

async function single(page: Page): Promise<void> {
  await open(page, 'single.jsonl', SINGLE)
  await expect(page.getByText('Record 1 of 4')).toBeVisible()
}

async function conversation(page: Page): Promise<void> {
  await open(page, 'conversation.jsonl', CONVERSATION)
  await expect(cards(page).first()).toContainText('Hello.')
}

export interface ScreenState {
  /** §2.11 screen number */
  n: number
  screen: string
  state: string
  go: (page: Page) => Promise<void>
  /** Tab is candidate focus here (§2.2), so the walk goes backward (DR-023) */
  backwardWalk?: boolean
  /** A first-use hint state (DR-030); every other state starts with the hints seen, as signed off */
  hints?: boolean
}

const STATES: ScreenState[] = [
  {
    n: 1,
    screen: 'empty',
    state: 'rest',
    go: async (page) => {
      await page.goto(DIST_URL)
      await expect(page.getByRole('button', { name: 'Open sample: candidates' })).toBeVisible()
    },
  },
  {
    n: 1,
    screen: 'empty',
    state: 'primary-hover',
    go: async (page) => {
      await page.goto(DIST_URL)
      await page.getByRole('button', { name: 'Open sample: candidates' }).hover()
    },
  },
  {
    n: 1,
    screen: 'empty',
    state: 'secondary-pressed',
    go: async (page) => {
      await page.goto(DIST_URL)
      await page.getByRole('button', { name: 'Open sample: conversation' }).hover()
      await page.mouse.down()
    },
  },
  {
    n: 1,
    screen: 'empty',
    state: 'error',
    go: async (page) => {
      await page.goto(DIST_URL)
      await page.getByLabel('JSONL file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
      await expect(page.getByRole('alert')).toBeVisible()
    },
  },
  {
    n: 2,
    screen: 'header',
    state: 'counts',
    go: async (page) => {
      await compare(page)
      await page.keyboard.press('ArrowLeft')
      await expect(page.getByText('Comparison 2 of 3 · 4 responses')).toBeVisible()
    },
    backwardWalk: true,
  },
  {
    n: 2,
    screen: 'header',
    state: 'secondary-hover',
    go: async (page) => {
      await compare(page)
      await page.getByRole('button', { name: 'Export' }).hover()
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'round-1',
    go: compare,
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'current-best-and-statuses',
    go: async (page) => {
      await compare(page)
      await page.keyboard.press('ArrowRight')
      await expect(page.getByText('Comparison 2 of 3 · 4 responses')).toBeVisible()
      await page.keyboard.press('a')
      await page.keyboard.press('Tab')
      await page.keyboard.press('r')
      await expect(page.getByText('Winner so far', { exact: true })).toBeVisible()
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'preferred-skipped-edited',
    go: async (page) => {
      await compare(page)
      // Prompt 2: skip the left, edit the right, prefer it, then come back to the judged pair
      for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft']) await page.keyboard.press(key)
      await expect(page.getByText('Prompt 2 of 5')).toBeVisible()
      await page.keyboard.press('s')
      await page.keyboard.press('Tab')
      await page.keyboard.press('e')
      const editor = page.getByLabel('Edit content')
      await editor.press('ControlOrMeta+a')
      await page.keyboard.type('y, edited')
      await page.keyboard.press('ControlOrMeta+Enter')
      await page.keyboard.press('Escape')
      await page.keyboard.press('ArrowRight')
      await expect(page.getByText('Prompt 3 of 5')).toBeVisible()
      await page.keyboard.press('k')
      await expect(page.getByText('Prompt 2 of 5')).toBeVisible()
      await expect(page.getByText('preferred', { exact: true })).toBeVisible()
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'kept-focused',
    go: async (page) => {
      await compare(page)
      await page.keyboard.press('a')
      await expect(cards(page).first()).toContainText('kept')
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'preferred-unfocused',
    go: async (page) => {
      const preferred = SCREENS.find((s) => s.state === 'preferred-skipped-edited')!
      await preferred.go(page)
      // Focus the other card, so the preferred one is on neutral-2
      const ref = await page.locator('[aria-current="true"]').getAttribute('data-candidate-ref')
      await page.keyboard.press('Tab')
      await expect(page.locator('[aria-current="true"]')).not.toHaveAttribute('data-candidate-ref', ref!)
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'tie-and-both-bad',
    go: async (page) => {
      await compare(page)
      for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', '=', 'x']) await page.keyboard.press(key)
      await expect(page.getByText('Prompt 4 of 5')).toBeVisible()
      await page.keyboard.press('k')
      await expect(page.getByText('both bad').first()).toBeVisible()
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'edited-diff',
    go: async (page) => {
      await compare(page)
      await page.keyboard.press('e')
      const editor = page.getByLabel('Edit content')
      await editor.press('ControlOrMeta+a')
      await page.keyboard.type('Hi there')
      await page.keyboard.press('ControlOrMeta+Enter')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /edited/ }).click()
      await expect(cards(page).first().getByLabel('Diff')).toBeVisible()
    },
    backwardWalk: true,
  },
  {
    n: 4,
    screen: 'single',
    state: 'statuses',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('a')
      await page.keyboard.press('r')
      await page.keyboard.press('s')
      await page.keyboard.press('k')
      await expect(cards(page).first()).toContainText('skipped')
    },
  },
  {
    n: 3,
    screen: 'compare',
    state: 'edited-hover',
    go: async (page) => {
      // DR-021: the edited mark keeps its surface and shows the neutral-8 border on hover
      const edited = SCREENS.find((s) => s.state === 'edited-diff')!
      await edited.go(page)
      await page.getByRole('button', { name: /edited/ }).hover()
    },
    backwardWalk: true,
  },
  {
    n: 4,
    screen: 'single',
    state: 'rejected',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('r')
      await page.keyboard.press('k')
      await expect(cards(page).first()).toContainText('rejected')
    },
  },
  {
    n: 4,
    screen: 'single',
    state: 'edited',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('e')
      await page.getByLabel('Edit content').press('ControlOrMeta+a')
      await page.keyboard.type('crimson')
      await page.keyboard.press('ControlOrMeta+Enter')
      await page.keyboard.press('Escape')
      await expect(cards(page).first()).toContainText('edited')
    },
  },
  {
    n: 5,
    screen: 'conversation',
    state: 'whitespace',
    go: async (page) => {
      await conversation(page)
      await page.keyboard.press('w')
      await expect(cards(page).first()).toContainText('Hello.·')
    },
  },
  {
    n: 5,
    screen: 'conversation',
    state: 'turn-hover',
    go: async (page) => {
      // DR-021: an editable turn keeps its surface and shows the neutral-8 border on hover
      await conversation(page)
      await cards(page).first().getByRole('button').last().hover()
    },
  },
  {
    n: 5,
    screen: 'conversation',
    state: 'turn-opens-editor',
    go: async (page) => {
      // A click on an editable turn opens the editor at once, so a selected turn is never shown (D-101)
      await conversation(page)
      await cards(page).first().getByRole('button').last().click()
      await expect(page.getByLabel('Edit content')).toBeVisible()
    },
  },
  {
    n: 5,
    screen: 'conversation',
    state: 'under-drop-toast',
    go: async (page) => {
      // DR-024: the drop status stays up (a refused drop), and Tab moves through turns behind it
      await page.setViewportSize({ width: 1280, height: 600 })
      await open(page, 'long.jsonl', LONG_CONVERSATION)
      await expect(cards(page).first()).toContainText('Turn 24')
      await dropFile(page, 'notes.txt', 'x')
      await expect(page.getByText('Only .jsonl files open in this version.')).toBeVisible()
    },
  },
  {
    n: 5,
    screen: 'raw',
    state: 'whitespace',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('t')
      await page.keyboard.press('w')
      await expect(cards(page).first().locator('pre')).toBeVisible()
    },
  },
  {
    n: 6,
    screen: 'editor',
    state: 'open',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('e')
      await expect(page.getByLabel('Edit content')).toBeFocused()
    },
  },
  {
    n: 6,
    screen: 'editor',
    state: 'under-storage-bar',
    go: async (page) => {
      // DR-024: the storage bar over a short, narrow editor screen
      await page.setViewportSize({ width: 700, height: 320 })
      await single(page)
      await page.keyboard.press('e')
      await expect(page.getByLabel('Edit content')).toBeFocused()
    },
  },
  {
    n: 6,
    screen: 'confirmation',
    state: 'diff',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('e')
      await page.getByLabel('Edit content').press('ControlOrMeta+a')
      await page.keyboard.type('crimson')
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(page.getByRole('heading', { name: 'Confirm Edit' })).toBeVisible()
    },
  },
  {
    n: 7,
    screen: 'metadata',
    state: 'unsafe-integer',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('m')
      await expect(page.getByText('unsafe integer')).toBeVisible()
    },
  },
  {
    n: 7,
    screen: 'labels-notes',
    state: 'open',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('l')
      await expect(page.getByRole('dialog')).toBeVisible()
      // One label, so its chip (neutral-3) and remove button are on the screen
      const labels = page.getByRole('textbox', { name: 'Labels', exact: true })
      await labels.fill('good')
      await labels.press('Enter')
      await expect(page.getByRole('button', { name: 'Remove label good' })).toBeVisible()
    },
  },
  {
    n: 7,
    screen: 'export',
    state: 'bom',
    go: async (page) => {
      await open(page, 'bom.jsonl', BOM)
      await expect(page.getByText('Record 1 of 1')).toBeVisible()
      await page.getByRole('button', { name: 'Export' }).click()
      await expect(page.getByText('BOM present')).toBeVisible()
    },
  },
  {
    n: 7,
    screen: 'search',
    state: 'open',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('/')
      await expect(page.getByRole('search')).toBeVisible()
    },
  },
  {
    n: 7,
    screen: 'go-to',
    state: 'error',
    go: async (page) => {
      await single(page)
      await page.keyboard.press('g')
      await page.getByLabel('Record number').fill('99')
      await page.getByLabel('Record number').press('Enter')
      await expect(page.getByRole('alert')).toBeVisible()
    },
  },
  {
    n: 8,
    screen: 'mapping-modal',
    state: 'open',
    go: async (page) => {
      await single(page)
      await page.getByRole('button', { name: 'Configure format' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    n: 8,
    screen: 'mapping-modal',
    state: 'invalid',
    go: async (page) => {
      await single(page)
      await page.getByRole('button', { name: 'Configure format' }).click()
      await page.getByLabel('Response field').fill('')
      await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled()
    },
  },
  {
    n: 8,
    screen: 'cheat-sheet',
    state: 'open',
    go: async (page) => {
      await single(page)
      // The binding is shift+? (react-hotkeys-hook's modifier match; STATUS WP 6a)
      await page.keyboard.press('Shift+?')
      await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
    },
  },
  // WP 7d: the new surfaces (DR-028 to DR-034), each in both themes
  {
    n: 8,
    screen: 'cheat-sheet',
    state: 'single-keys-off',
    go: async (page) => {
      await single(page)
      await page.getByRole('button', { name: /Keyboard shortcuts/ }).click()
      await page.getByLabel('Single-key shortcuts').uncheck()
      await expect(page.getByText('off').first()).toBeVisible()
    },
  },
  {
    n: 2,
    screen: 'header',
    state: 'resumed',
    go: async (page) => {
      // The embedded sample keeps its fingerprint across a reload, so its session restores
      await page.goto(DIST_URL)
      await page.getByRole('button', { name: 'Open sample: candidates' }).click()
      await expect(page.getByText('Comparison 1 of 3 · 4 responses')).toBeVisible()
      await page.keyboard.press('ArrowLeft')
      await expect(page.locator('[role="status"]:not([data-resume-status])').filter({ hasText: /^Saved$/ })).toBeVisible()
      await page.reload()
      await page.getByRole('button', { name: 'Open sample: candidates' }).click()
      await expect(page.locator('[data-resume-line]')).toBeVisible()
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'first-use-hint',
    hints: true,
    go: async (page) => {
      await compare(page)
      await expect(page.locator('[data-hint]')).toBeVisible()
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'round-2-hint',
    hints: true,
    go: async (page) => {
      await compare(page)
      await page.keyboard.press('ArrowLeft')
      await expect(page.getByText(/stays as Winner so far/)).toBeVisible()
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'strength-pressed',
    go: async (page) => {
      await compare(page)
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('Shift+Digit2')
      await expect(page.getByRole('button', { name: /^Better/ })).toHaveAttribute('aria-pressed', 'true')
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'action-hover',
    go: async (page) => {
      await compare(page)
      await page.getByRole('region', { name: 'Review actions' }).getByRole('button', { name: /^Keep/ }).hover()
    },
    backwardWalk: true,
  },
  {
    n: 3,
    screen: 'compare',
    state: 'one-candidate',
    go: async (page) => {
      await open(page, 'one.jsonl', '{"prompt":"Only","responses":["just one"]}\n{"prompt":"Q","responses":["x","y"]}\n')
      await expect(page.getByText('Only one candidate for this prompt')).toBeVisible()
      await expect(page.getByRole('button', { name: /^Left is better/ })).toBeDisabled()
    },
    // One card: Tab moves DOM focus as usual (DR-023 as amended, owner, 7 Nov 2026), so a forward walk
  },
  {
    n: 4,
    screen: 'single',
    state: 'first-use-hint',
    hints: true,
    go: async (page) => {
      await single(page)
      await expect(page.locator('[data-hint]')).toBeVisible()
    },
  },
]

/** Every hint already seen, so a state shows as signed off (owner, 7 Nov 2026) */
async function hintsSeen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('evalcull.hints', JSON.stringify(['compare', 'round2', 'single']))
      // Single-key shortcuts on, their default: one state turns them off (DR-029)
      localStorage.removeItem('evalcull.shortcuts')
    } catch {
      // A page without storage shows no hint anyway (DR-030)
    }
  })
}

/** No hint seen yet: added after any earlier state's script on the same page, which it undoes */
async function hintsUnseen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('evalcull.hints')
      localStorage.removeItem('evalcull.shortcuts')
    } catch {
      // A page without storage shows no hint
    }
  })
}

export const SCREENS: ScreenState[] = STATES.map((s) => ({
  ...s,
  go: async (page: Page) => {
    // Init scripts stay on a page and run in the order added, so the last one decides (motion runs every state on one page)
    await (s.hints ? hintsUnseen(page) : hintsSeen(page))
    await s.go(page)
  },
}))

export { compare, single, conversation }
