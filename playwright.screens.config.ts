import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// npm run e2e:screens: only the @screens run for the owner's sign-off (WP 7b).
// grepInvert must be cleared, or the base config's inversion selects nothing.
export default defineConfig({
  ...base,
  grep: /@screens/,
  grepInvert: undefined,
})
