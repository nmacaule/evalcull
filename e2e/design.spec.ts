import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TMP, watchCsp } from './helpers'
import { apcaLc, hexToRgb, over, parseColour, toHex, wcagRatio, type Rgba } from './design/colour'
import { SCREENS, compare } from './design/screens'
import {
  DR016_ROWS,
  ON_PRIMARY,
  PRIMARY_FILL,
  SCRIM,
  TARGETS,
  TEXT_PAIRS,
  TOKENS,
  UNUSED,
  type Theme,
} from './design/tokens'

// PRD §5 Visual design (v3.4, §2.11, DR-016 to DR-024): every text and surface
// pair on every screen in both themes against the token table and the WCAG 2
// and APCA targets, unrounded; a ring on every focusable element; reduced
// motion; line height at 1.5 clipping nothing; and zero CSP violations.

type RGB = [number, number, number]
const rgb = (c: Rgba): RGB => [c.r, c.g, c.b]

/** The token a computed colour is, by its 8-bit value and alpha, or null. */
function tokenOf(c: Rgba, theme: Theme): string | null {
  if (c.a === 0) return 'transparent'
  const hex = toHex(rgb(c))
  if (c.a === 1) {
    if (hex === ON_PRIMARY.hex) return 'white'
    for (const [name, v] of Object.entries(TOKENS)) if (v[theme].hex === hex) return name
    return null
  }
  if (hex === '#000000' && Math.abs(c.a - SCRIM.alpha) < 0.005) return 'scrim'
  return null
}

// ---------------------------------------------------------------------------
// The page side: computed styles, read in one pass
// ---------------------------------------------------------------------------

interface Sample {
  where: string
  color: string
  /** Background colours from the element up to the root */
  backgrounds: string[]
  others: { prop: string; value: string }[]
  text: boolean
  fontSize: number
  disabled: boolean
  nativeControl: boolean
  isControl: boolean
  isDot: boolean
  dotWordColor: string | null
  /** Mono content: the diff and the raw view inside a card (DR-016 rows: Lc 90) */
  contentMono: boolean
  /** A whitespace or diff mark (DR-016, DR-022: Lc 75) */
  mark: boolean
  /** A progress fill and its track */
  progress: { fill: string; track: string } | null
  status: { hasDot: boolean; text: string } | null
}

/** Waits for running transitions and animations, so a state is read at its end, not between two tokens. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
}

async function sample(page: Page): Promise<Sample[]> {
  await settled(page)
  return page.evaluate(() => {
    const out: Sample[] = []
    const path = (el: Element) => {
      const parts: string[] = []
      for (let e: Element | null = el; e && parts.length < 4; e = e.parentElement) {
        const label = e.getAttribute('aria-label') || e.getAttribute('data-screen') || e.getAttribute('data-status')
        parts.unshift(e.tagName.toLowerCase() + (label ? `[${label}]` : ''))
      }
      return parts.join('>')
    }
    const visible = (el: Element) => {
      const cs = getComputedStyle(el)
      return el.getClientRects().length > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0
    }
    const chain = (el: Element) => {
      const bgs: string[] = []
      for (let e: Element | null = el; e; e = e.parentElement) bgs.push(getComputedStyle(e).backgroundColor)
      return bgs
    }
    for (const el of Array.from(document.querySelectorAll('body, body *'))) {
      if (!visible(el)) continue
      const cs = getComputedStyle(el)
      const others: { prop: string; value: string }[] = []
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        if (parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none') {
          others.push({ prop: `border-${side.toLowerCase()}-color`, value: cs.getPropertyValue(`border-${side.toLowerCase()}-color`) })
        }
      }
      if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') others.push({ prop: 'outline-color', value: cs.outlineColor })
      if (cs.textDecorationLine !== 'none') others.push({ prop: 'text-decoration-color', value: cs.textDecorationColor })
      if (el instanceof SVGElement) {
        if (cs.fill !== 'none' && !cs.fill.startsWith('url')) others.push({ prop: 'fill', value: cs.fill })
        if (cs.stroke !== 'none' && !cs.stroke.startsWith('url')) others.push({ prop: 'stroke', value: cs.stroke })
      }
      if (cs.boxShadow !== 'none') others.push({ prop: 'box-shadow', value: cs.boxShadow })
      const tag = el.tagName
      const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (isField) others.push({ prop: 'caret-color', value: cs.caretColor })
      const nativeControl = tag === 'INPUT' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)
      if (nativeControl || tag === 'SELECT') others.push({ prop: 'accent-color', value: cs.accentColor })
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '')
      const fieldText = (tag === 'INPUT' || tag === 'TEXTAREA') && (el as HTMLInputElement).value !== ''
      const statusEl = el.getAttribute('data-status') !== null
      const dotWord = el.classList.contains('status-dot') ? el.parentElement : null
      out.push({
        where: path(el),
        color: cs.color,
        backgrounds: chain(el),
        others,
        text: ownText || fieldText,
        fontSize: parseFloat(cs.fontSize),
        disabled: !!el.closest(':disabled, [aria-disabled="true"]'),
        nativeControl,
        isControl: isField && !nativeControl,
        isDot: !!dotWord,
        dotWordColor: dotWord ? getComputedStyle(dotWord).color : null,
        contentMono: !!el.closest('[aria-label="Diff"], [data-card-content] pre'),
        mark: el.matches('[data-ws-mark], [data-diff-mark]'),
        progress: el.parentElement?.getAttribute('role') === 'progressbar' ? { fill: cs.backgroundColor, track: getComputedStyle(el.parentElement).backgroundColor } : null,
        status: statusEl ? { hasDot: !!el.querySelector('.status-dot'), text: el.textContent!.trim() } : null,
      })
      // Placeholder text, when it shows
      if (isField && (el as HTMLInputElement).value === '' && (el as HTMLInputElement).placeholder) {
        out.push({
          ...out[out.length - 1],
          where: path(el) + '::placeholder',
          color: getComputedStyle(el, '::placeholder').color,
          others: [],
          text: true,
          isControl: false,
          status: null,
        })
      }
      for (const pseudo of ['::before', '::after']) {
        const p = getComputedStyle(el, pseudo)
        if (p.content && p.content !== 'none' && p.content !== 'normal' && p.content !== '""') {
          out.push({ ...out[out.length - 1], where: path(el) + pseudo, color: p.color, others: [], text: true, isControl: false, status: null })
        }
      }
    }
    const sel = getComputedStyle(document.body, '::selection')
    out.push({
      where: 'body::selection',
      color: sel.color,
      backgrounds: [sel.backgroundColor, getComputedStyle(document.body).backgroundColor],
      others: [],
      text: true,
      fontSize: 13,
      disabled: false,
      nativeControl: false,
      isControl: false,
      isDot: false,
      dotWordColor: null,
      contentMono: false,
      mark: false,
      progress: null,
      status: null,
    })
    return out
  })
}

// ---------------------------------------------------------------------------
// The node side: judging what the page computed
// ---------------------------------------------------------------------------

/** The surface under an element: translucent layers composited onto the first opaque one. */
function surfaceOf(backgrounds: string[], theme: Theme): { name: string | null; rgb: RGB } {
  const layers: Rgba[] = []
  for (const b of backgrounds) {
    const c = parseColour(b)
    if (!c || c.a === 0) continue
    layers.push(c)
    if (c.a === 1) break
  }
  const [r, g, b] = hexToRgb(TOKENS['neutral-1'][theme].hex)
  let base = layers.pop() ?? { r, g, b, a: 1 }
  while (layers.length) base = over(layers.pop()!, base)
  return { name: tokenOf(base, theme), rgb: rgb(base) }
}

function primaryFill(name: string | null, theme: Theme): boolean {
  return name === PRIMARY_FILL[theme].rest || name === PRIMARY_FILL[theme].hover
}

const rowKey = (fg: string, bg: string) => `${fg} on ${bg}`

// Each test writes the pairs it observed to a file, so the coverage check sees
// them across worker restarts; the first test of a theme marks the run's start,
// and only files written after it count
const OBSERVED = (theme: Theme) => join(TMP, 'design', theme)
function markStart(theme: Theme): void {
  mkdirSync(OBSERVED(theme), { recursive: true })
  writeFileSync(join(OBSERVED(theme), 'start'), String(Date.now()))
}
function writeObserved(theme: Theme, name: string, seen: Set<string>): void {
  mkdirSync(OBSERVED(theme), { recursive: true })
  writeFileSync(join(OBSERVED(theme), `${name.replace(/[^a-z0-9]+/gi, '-')}.json`), JSON.stringify([...seen]))
}
function readObserved(theme: Theme): { seen: Set<string>; files: string[] } {
  const dir = OBSERVED(theme)
  const start = statSync(join(dir, 'start')).mtimeMs
  const seen = new Set<string>()
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && statSync(join(dir, f)).mtimeMs >= start)
  for (const f of files) for (const k of JSON.parse(readFileSync(join(dir, f), 'utf8')) as string[]) seen.add(k)
  return { seen, files }
}

function judgeColours(samples: Sample[], theme: Theme, seen: Set<string>): string[] {
  const failures: string[] = []
  for (const s of samples) {
    const fg = parseColour(s.color)
    // 2. No colour outside the tokens
    for (const { prop, value } of [{ prop: 'color', value: s.color }, ...s.others]) {
      if (prop === 'box-shadow') {
        failures.push(`${s.where} box-shadow ${value} (no shadows, §2.11)`)
        continue
      }
      const c = parseColour(value)
      if (!c || tokenOf(c, theme) === null) failures.push(`${s.where} ${prop} ${value} is not a §2.11 token`)
      if (prop === 'accent-color' && c && tokenOf(c, theme) !== 'neutral-12') failures.push(`${s.where} accent-color is not neutral-12 (DR-020)`)
      // The native-control fill (DR-020) and the hover border (DR-021) are measured on neutral-1 to neutral-3 only
      if ((prop === 'accent-color' || (prop.startsWith('border-') && c && tokenOf(c, theme) === 'neutral-8')) && c) {
        const outer = surfaceOf(prop === 'accent-color' ? s.backgrounds : s.backgrounds.slice(1), theme)
        if (!['neutral-1', 'neutral-2', 'neutral-3'].includes(outer.name ?? '')) {
          failures.push(`${s.where} ${prop} ${tokenOf(c, theme)} on ${outer.name}, not neutral-1 to neutral-3`)
        }
      }
    }
    for (const b of s.backgrounds.slice(0, 1)) {
      const c = parseColour(b)
      if (!c || tokenOf(c, theme) === null) failures.push(`${s.where} background-color ${b} is not a §2.11 token`)
      // The status dot is its word's colour by design (O12); no other element has a status background
      else if (/^status-/.test(tokenOf(c, theme)!) && !s.isDot) failures.push(`${s.where} has a status colour as its background (§2.11 Status pattern)`)
    }
    const surface = surfaceOf(s.backgrounds, theme)
    // 3. Text pairings
    if (s.text && fg) {
      const fgName = tokenOf(fg, theme)
      const ratio = wcagRatio(rgb(fg), surface.rgb)
      const lc = apcaLc(rgb(fg), surface.rgb)
      const pair = `${fgName} on ${surface.name}`
      const allowed =
        fgName === 'white' ? primaryFill(surface.name, theme) : !!fgName && !!surface.name && (TEXT_PAIRS[fgName] ?? []).includes(surface.name)
      if (!allowed) failures.push(`${s.where} text ${pair} is not an allowed pairing (ratio ${ratio}, Lc ${lc})`)
      if (fgName && surface.name) seen.add(rowKey(fgName, surface.name))
      const role = s.disabled
        ? 'disabled'
        : s.mark
          ? 'chrome'
          : s.fontSize === 14 || s.fontSize === 16 || s.contentMono
            ? 'content'
            : 'chrome'
      if (role !== 'disabled' && ratio < TARGETS.text.wcag) failures.push(`${s.where} text ${pair} WCAG ${ratio} < 4.5`)
      if (lc < TARGETS[role].lc) failures.push(`${s.where} ${role} text ${pair} Lc ${lc} < ${TARGETS[role].lc}`)
    }
    // 4. Non-text: control borders, status dots
    for (const o of s.others) {
      const c = o.prop.startsWith('border-') ? parseColour(o.value) : null
      if (c && tokenOf(c, theme) === 'neutral-9') {
        const inner = surfaceOf(s.backgrounds, theme)
        const outer = surfaceOf(s.backgrounds.slice(1), theme)
        for (const side of [inner, outer]) if (side.name) seen.add(rowKey('neutral-9', side.name))
        // The border identifies the control against the surface around it; a hover or press
        // fill inside it is supplemental, with no 3:1 of its own (1.4.11 Hover states [S169])
        const ratio = wcagRatio(rgb(c), outer.rgb)
        if (ratio < TARGETS.nonText.wcag) failures.push(`${s.where} neutral-9 border on ${outer.name} ratio ${ratio} < 3`)
        break
      }
    }
    if (s.isControl) {
      const border = s.others.find((o) => o.prop.startsWith('border-'))
      const c = border && parseColour(border.value)
      const name = c && tokenOf(c, theme)
      if (name !== 'neutral-9') failures.push(`${s.where} control border is ${name ?? border?.value ?? 'none'}, not neutral-9`)
      else {
        seen.add(rowKey('neutral-9', surface.name ?? '?'))
        const ratio = wcagRatio(rgb(c!), surface.rgb)
        if (ratio < TARGETS.nonText.wcag) failures.push(`${s.where} control border ratio ${ratio} < 3`)
      }
    }
    if (s.isDot) {
      const dot = parseColour(s.backgrounds[0])
      const word = s.dotWordColor && parseColour(s.dotWordColor)
      if (!dot || !word || toHex(rgb(dot)) !== toHex(rgb(word))) failures.push(`${s.where} status dot is not its word's colour`)
      else {
        const ratio = wcagRatio(rgb(dot), surfaceOf(s.backgrounds.slice(1), theme).rgb)
        if (ratio < TARGETS.nonText.wcag) failures.push(`${s.where} status dot ratio ${ratio} < 3`)
      }
    }
    // The progress bar: a neutral-9 fill on a neutral-3 track (DR-018)
    if (s.progress) {
      const fill = parseColour(s.progress.fill)
      const track = parseColour(s.progress.track)
      const pair = `${fill && tokenOf(fill, theme)} on ${track && tokenOf(track, theme)}`
      if (pair !== 'neutral-9 on neutral-3') failures.push(`${s.where} progress ${pair}, not neutral-9 on neutral-3 (DR-018)`)
    }
    // 5. Status shows a word with its dot
    if (s.status && (!s.status.hasDot || s.status.text === '')) failures.push(`${s.where} status without a word and a dot`)
  }
  return failures
}

// ---------------------------------------------------------------------------
// The tests, per theme
// ---------------------------------------------------------------------------

for (const theme of ['light', 'dark'] as const) {
  test.describe(`design, ${theme} theme`, () => {
    // In file order in one worker; a failure does not skip the tests after it
    test.describe.configure({ mode: 'default' })
    test.use({ colorScheme: theme })

    test('the :root tokens are the §2.11 table', async ({ page }) => {
      markStart(theme)
      await SCREENS[0].go(page)
      const values = await page.evaluate((names) => {
        const cs = getComputedStyle(document.documentElement)
        return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()]))
      }, Object.keys(TOKENS))
      for (const [name, v] of Object.entries(TOKENS)) {
        const c = parseColour(values[name] || 'none')
        expect(c && toHex(rgb(c)), `--${name} (${values[name]})`).toBe(v[theme].hex)
      }
    })

    for (const screen of SCREENS) {
      test(`colours on ${screen.n} ${screen.screen}, ${screen.state}`, async ({ page }) => {
        const violations = await watchCsp(page)
        await screen.go(page)
        const seen = new Set<string>()
        const failures = judgeColours(await sample(page), theme, seen)
        writeObserved(theme, `colours ${screen.screen} ${screen.state}`, seen)
        expect(failures).toEqual([])
        expect(await violations()).toEqual([])
      })
    }

    for (const screen of SCREENS) {
      test(`Tab walk on ${screen.n} ${screen.screen}, ${screen.state}`, async ({ page }) => {
        await screen.go(page)
        const ids = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]')
          const scope = dialog ?? document
          const all = Array.from(
            scope.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
          )
            .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !(el as HTMLButtonElement).disabled)
            // A radio group is one Tab stop, its checked option; arrow keys move within it (HTML)
            .filter((el) => {
              const r = el as HTMLInputElement
              if (r.type !== 'radio' || r.checked || !r.name) return true
              return !document.querySelector(`input[type="radio"][name="${CSS.escape(r.name)}"]:checked`)
            })
          all.forEach((el, i) => el.setAttribute('data-walk', String(i)))
          ;(document.activeElement as HTMLElement | null)?.blur()
          return all.map((_, i) => String(i))
        })
        expect(ids.length, 'a screen with nothing focusable').toBeGreaterThan(0)
        if (screen.backwardWalk) {
          // §2.2: Tab moves the candidate focus here, never DOM focus (DR-023)
          const before = await page.locator('[aria-current="true"]').getAttribute('data-candidate-ref')
          await page.keyboard.press('Tab')
          expect(await page.locator('[aria-current="true"]').getAttribute('data-candidate-ref')).not.toBe(before)
          expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
        }
        const visited = new Set<string>()
        const seen = new Set<string>()
        for (let i = 0; i < ids.length * 2 + 2; i++) {
          await page.keyboard.press(screen.backwardWalk ? 'Shift+Tab' : 'Tab')
          await settled(page)
          const r = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null
            if (!el || el === document.body) return null
            const cs = getComputedStyle(el)
            const box = el.getBoundingClientRect()
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
            // The ring is outset by 2 px, so it sits on the surface around the element (WCAG 2.4.13)
            const bgs: string[] = []
            for (let e: Element | null = el.parentElement; e; e = e.parentElement) bgs.push(getComputedStyle(e).backgroundColor)
            return {
              id: el.getAttribute('data-walk'),
              where: el.tagName.toLowerCase() + ' ' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
              style: cs.outlineStyle,
              width: cs.outlineWidth,
              color: cs.outlineColor,
              offset: cs.outlineOffset,
              obscured: !(hit && (hit === el || el.contains(hit))),
              bgs,
            }
          })
          if (!r) continue
          if (r.id) visited.add(r.id)
          expect(r.style, `${r.where} outline style`).toBe('solid')
          expect(r.width, `${r.where} outline width`).toBe('2px')
          expect(r.offset, `${r.where} outline offset`).toBe('2px')
          const ring = parseColour(r.color)
          expect(ring && tokenOf(ring, theme), `${r.where} ring colour`).toBe('accent-9')
          const under = surfaceOf(r.bgs, theme)
          if (under.name) seen.add(rowKey('accent-9', under.name))
          const ratio = wcagRatio(rgb(ring!), under.rgb)
          expect(ratio, `${r.where} ring against its surface`).toBeGreaterThanOrEqual(3)
          expect(r.obscured, `${r.where} hidden under another element`).toBe(false)
        }
        writeObserved(theme, `ring ${screen.screen} ${screen.state}`, seen)
        expect([...visited].sort(), 'every focusable element reached').toEqual([...ids].sort())
      })
    }

    test('the reading step: Z sets content to 16/24 and back, chrome stays 13', async ({ page }) => {
      await compare(page)
      const sizes = () =>
        page.evaluate(() => {
          const content = document.querySelector('[data-card-content]') as HTMLElement
          const text = content.querySelector('*:not(:has(*))') ?? content
          const chrome = document.querySelector('[data-testid="progress-text"]') as HTMLElement
          const c = getComputedStyle(text)
          return { size: c.fontSize, line: c.lineHeight, chrome: getComputedStyle(chrome).fontSize }
        })
      expect(await sizes()).toEqual({ size: '14px', line: '20px', chrome: '13px' })
      await page.keyboard.press('z')
      expect(await sizes()).toEqual({ size: '16px', line: '24px', chrome: '13px' })
      await page.keyboard.press('z')
      expect(await sizes()).toEqual({ size: '14px', line: '20px', chrome: '13px' })
    })

    test('the reading step reaches the notes field, which opens in a dialog', async ({ page }) => {
      // §2.2: Z sets record content, notes included (plan §3), to 16 / 24; the dialog renders in a portal
      await compare(page)
      await page.keyboard.press('z')
      await page.keyboard.press('n')
      const notes = page.getByRole('textbox', { name: 'Notes', exact: true })
      await expect(notes).toBeVisible()
      expect(await notes.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight])).toEqual(['16px', '24px'])
    })

    for (const screen of SCREENS.filter((s) => s.state !== 'primary-hover' && s.state !== 'secondary-pressed' && s.state !== 'secondary-hover')) {
      test(`line height 1.5 clips nothing on ${screen.n} ${screen.screen}, ${screen.state}`, async ({ page }) => {
        const violations = await watchCsp(page)
        await screen.go(page)
        const clipped = await page.evaluate(() => {
          // A CSSOM edit, which the meta CSP does not govern (an inserted style element would be refused)
          const sheet = document.styleSheets[0]
          sheet.insertRule('* { line-height: 1.5 !important }', sheet.cssRules.length)
          const out: string[] = []
          // Visually hidden text (sr-only: a 1 px clipped box) is clipped by design, not by line height
          const srOnly = (el: Element) => {
            const r = el.getBoundingClientRect()
            const cs = getComputedStyle(el)
            // A display: contents box is zero-sized too, but clips nothing
            return (r.width <= 1 || r.height <= 1) && cs.display !== 'contents' && cs.overflow !== 'visible'
          }
          const insideSrOnly = (el: Element) => {
            for (let e: Element | null = el; e; e = e.parentElement) if (srOnly(e)) return true
            return false
          }
          const clips = (el: Element) =>
            !srOnly(el) && (['hidden', 'clip'].includes(getComputedStyle(el).overflowX) || ['hidden', 'clip'].includes(getComputedStyle(el).overflowY))
          const scrolls = (el: Element) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) || ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent!.trim() || !n.parentElement || n.parentElement.getClientRects().length === 0) continue
            if (insideSrOnly(n.parentElement)) continue
            let clip: Element | null = null
            for (let e: Element | null = n.parentElement; e; e = e.parentElement) {
              if (scrolls(e)) break
              if (clips(e)) {
                clip = e
                break
              }
            }
            if (!clip) continue
            const range = document.createRange()
            range.selectNodeContents(n)
            const box = clip.getBoundingClientRect()
            for (const r of Array.from(range.getClientRects())) {
              if (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5 || r.left < box.left - 0.5 || r.right > box.right + 0.5) {
                out.push(`"${n.textContent!.trim().slice(0, 30)}" clipped by ${clip.tagName.toLowerCase()}`)
                break
              }
            }
          }
          for (const el of Array.from(document.querySelectorAll('body *'))) {
            if (!clips(el) || el.getClientRects().length === 0) continue
            if (el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5) {
              if ((el.textContent ?? '').trim()) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" overflows its clip`)
            }
          }
          return out
        })
        expect(clipped).toEqual([])
        expect(await violations()).toEqual([])
      })
    }

    test('every DR-016 row is observed on some screen, or listed as unused with its reason', () => {
      // The native-control, progress and hover-border pairs are checked at their elements in judgeColours
      const { seen, files } = readObserved(theme)
      expect(files.length, 'observation files from this run').toBeGreaterThan(0)
      const missing = DR016_ROWS.filter((r) => r.theme === theme)
        .map((r) => rowKey(r.fg, r.bg))
        .filter((k) => !seen.has(k) && !UNUSED[`${theme} ${k}`])
      expect(missing).toEqual([])
    })
  })
}

// Motion (§2.11 Motion, O9): read from computed styles and the stylesheet's
// keyframes, never by racing a running animation
const MOVING = /^(transform|translate|scale|rotate|top|left|right|bottom|inset|width|height|all)$/

async function motion(page: Page) {
  return page.evaluate(() => {
    const ms = (v: string) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000)
    const keyframes = new Map<string, Set<string>>()
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSKeyframesRule) {
          const props = new Set<string>()
          for (const frame of Array.from(rule.cssRules) as CSSKeyframeRule[]) {
            for (let i = 0; i < frame.style.length; i++) props.add(frame.style[i])
          }
          keyframes.set(rule.name, props)
        }
      }
    }
    const out: { where: string; kind: string; prop: string; ms: number; infinite: boolean }[] = []
    for (const el of Array.from(document.querySelectorAll('body, body *'))) {
      const cs = getComputedStyle(el)
      const props = cs.transitionProperty.split(',').map((s) => s.trim())
      const durs = cs.transitionDuration.split(',').map((s) => ms(s.trim()))
      props.forEach((p, i) => {
        const d = durs[i % durs.length]
        if (p !== 'none' && d > 0) out.push({ where: el.tagName.toLowerCase(), kind: 'transition', prop: p, ms: d, infinite: false })
      })
      const names = cs.animationName.split(',').map((s) => s.trim())
      const adurs = cs.animationDuration.split(',').map((s) => ms(s.trim()))
      const counts = cs.animationIterationCount.split(',').map((s) => s.trim())
      names.forEach((n, i) => {
        if (n === 'none') return
        for (const p of keyframes.get(n) ?? []) {
          out.push({ where: `${el.tagName.toLowerCase()} @${n}`, kind: 'animation', prop: p, ms: adurs[i % adurs.length], infinite: counts[i % counts.length] === 'infinite' })
        }
      })
    }
    return out
  })
}

async function openEverything(page: Page): Promise<Awaited<ReturnType<typeof motion>>> {
  const seen: Awaited<ReturnType<typeof motion>> = []
  for (const screen of SCREENS) {
    await screen.go(page)
    seen.push(...(await motion(page)))
  }
  return seen
}

test.describe('motion', () => {

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' })
    test('nothing moves, and colour and opacity changes take at most 120 ms', async ({ page }) => {
      const failures = (await openEverything(page))
        .filter((m) => m.infinite || (MOVING.test(m.prop) && m.ms > 0) || m.ms > 120)
        .map((m) => `${m.where} ${m.kind} ${m.prop} ${m.ms} ms${m.infinite ? ' infinite' : ''}`)
      expect([...new Set(failures)]).toEqual([])
    })
  })

  test.describe('without reduced motion', () => {
    test.use({ reducedMotion: 'no-preference' })
    test('nothing loops or lasts above 240 ms, and a dialog opens in 200 ms', async ({ page }) => {
      const all = await openEverything(page)
      const failures = all
        .filter((m) => m.infinite || m.ms > 240)
        .map((m) => `${m.where} ${m.kind} ${m.prop} ${m.ms} ms${m.infinite ? ' infinite' : ''}`)
      expect([...new Set(failures)]).toEqual([])
      expect(all.some((m) => m.kind === 'animation' && m.ms === 200 && m.prop === 'opacity')).toBe(true)
    })
  })
})
