import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

// npm run e2e:perf: only the @perf measurements (WP 7, Q6). grepInvert must be
// cleared, or Playwright applies the base config's /@perf/ inversion as well
// and selects nothing.
export default defineConfig({
  ...base,
  grep: /@perf/,
  grepInvert: undefined,
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60 * 1000,
  // M1 and M3 in WebKit too (WP 7c); the CDP measurements skip themselves outside Chromium
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
