import { defineConfig, devices } from '@playwright/test'

// The specs plan.md WP 7c runs in WebKit and Firefox (§5 CSP, Privacy, Compare loop, Keyboard loop)
const CROSS_ENGINE = /(single-file|kept-bytes|compare-loop|keyboard-loop)\.spec\.ts$/

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
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
