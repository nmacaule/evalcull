import { existsSync, readFileSync } from 'node:fs'
import { SINGLE_FILE } from './helpers'

/**
 * D-112 (DR-037): every run tests the single file, so it stops before any test when
 * dist-single/index.html is missing or is not the one-file build: the file
 * build:single's post-build step writes carries the meta CSP and loads nothing from assets/.
 */
export default function globalSetup(): void {
  const rebuild = 'Run npm run build:single, then run the tests again.'
  if (!existsSync(SINGLE_FILE)) {
    throw new Error(`The single file ${SINGLE_FILE} is missing. ${rebuild}`)
  }
  const html = readFileSync(SINGLE_FILE, 'utf8')
  if (!html.includes('<meta http-equiv="Content-Security-Policy"') || /(src|href)="\.?\/?assets\//.test(html)) {
    throw new Error(`${SINGLE_FILE} is not the single file (it loads assets/ or has no meta CSP). ${rebuild}`)
  }
}
