import { defineConfig, devices } from '@playwright/test'
import { assertSingleFile } from './e2e/single-file-guard'

// Stops the run at once unless dist-single/index.html is the single file (DR-037, D-112). At config
// load, before Playwright starts the webServer, which it does before any globalSetup
assertSingleFile()

// The specs plan.md WP 7c runs in WebKit and Firefox (§5 CSP, Privacy, Compare loop, Keyboard loop);
// WP 7d: the visible-control walk in all three engines too
const CROSS_ENGINE = /(single-file|kept-bytes|compare-loop|keyboard-loop|learnability)\.spec\.ts$/

export default defineConfig({
  testDir: './e2e',
  // The 100 MB and million-line measurements run locally through npm run e2e:perf,
  // and the owner's screenshots through npm run e2e:screens
  grepInvert: /@perf|@screens/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WP 7c (D-100): the single file from file:// in the other two engines
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: CROSS_ENGINE },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: CROSS_ENGINE },
  ],
  webServer: {
    // The single file over http, as CI has served it (DR-037)
    command: 'npm run preview -- --outDir dist-single',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
