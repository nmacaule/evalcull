import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SCREENS } from './design/screens'

// npm run e2e:screens: every §2.11 screen and state in both themes, written to
// node_modules/.tmp/screens/ for the owner's sign-off (PRD §5 Visual design).
// Not in npm run e2e or CI.
const OUT = resolve('node_modules/.tmp/screens')

for (const theme of ['light', 'dark'] as const) {
  test.describe(`screens, ${theme} theme`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1280, height: 800 } })
    for (const s of SCREENS) {
      test(`@screens ${s.n} ${s.screen} ${s.state}`, async ({ page }) => {
        await s.go(page)
        // A dialog opens over 200 ms; capture it once every animation has finished
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
        mkdirSync(OUT, { recursive: true })
        await page.screenshot({ path: join(OUT, `${s.n}-${s.screen}-${s.state}-${theme}.png`), fullPage: true })
      })
    }
  })
}
