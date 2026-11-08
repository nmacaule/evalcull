// @vitest-environment node
/**
 * D-112: the e2e, screens and perf runs load the single file, which npm run build
 * overwrites with the multi-file build. A run against the multi-file build must
 * stop at once with a plain message naming the cause, not hang or fail in each test.
 * Remedy-neutral (DR-037): the multi-file build sits in dist/ under the runner's working
 * directory, which DIST_URL resolves against, as npm run build leaves it, and the check
 * reads only the exit, the time and the message.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const SCRATCH = join(ROOT, 'node_modules/.tmp/d112');
// Each tool through Node and its own JS entry, so no shell is needed on any runner (npm's
// node_modules/.bin entries are shell shims on Windows)
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');
const PLAYWRIGHT = join(ROOT, 'node_modules/@playwright/test/cli.js');

// Each run as its npm script starts it, narrowed to one Chromium file
const RUNS = [
  { name: 'npm run e2e', args: ['-c', join(ROOT, 'playwright.config.ts'), 'e2e/single-file.spec.ts'] },
  { name: 'npm run e2e:screens', args: ['-c', join(ROOT, 'playwright.screens.config.ts')] },
  { name: 'npm run e2e:perf', args: ['-c', join(ROOT, 'playwright.perf.config.ts')] },
];

// "At once": well inside one Playwright test timeout (30 s)
const AT_ONCE_MS = 20_000;

describe('the single-file runs check what they test (D-112)', () => {
  beforeAll(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(SCRATCH, { recursive: true });
    // The multi-file build, as npm run build writes it, in the scratch folder's dist/
    const built = spawnSync(process.execPath, [VITE, 'build', '--outDir', join(SCRATCH, 'dist'), '--emptyOutDir'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(built.status).toBe(0);
  }, 120_000);

  it('single-file runs against a multi-file build stop at once and name the cause (D-112)', () => {
    const results = RUNS.map((run) => {
      const started = Date.now();
      const out = spawnSync(process.execPath, [PLAYWRIGHT, 'test', ...run.args, '--project=chromium', '--reporter=line'], {
        cwd: SCRATCH,
        encoding: 'utf8',
        timeout: 60_000,
        // CI set: reuseExistingServer is off, so a server left on the port cannot stand in for a real start
        env: { ...process.env, CI: '1' },
      });
      return {
        run: run.name,
        ms: Date.now() - started,
        failed: out.status !== 0,
        named: /single[- ]file/i.test(`${out.stdout}${out.stderr}`) && /npm run build:single/.test(`${out.stdout}${out.stderr}`),
      };
    });

    for (const r of results) {
      expect(r, r.run).toMatchObject({ failed: true, named: true });
      expect(r.ms, r.run).toBeLessThan(AT_ONCE_MS);
    }
  }, 240_000);

  // DR-037's guard, its second branch: a multi-file build where the single file belongs
  it('a multi-file build in dist-single stops the run at once and says it is not the single file', () => {
    const folder = join(ROOT, 'node_modules/.tmp/d112-wrong');
    rmSync(folder, { recursive: true, force: true });
    cpSync(join(SCRATCH, 'dist'), join(folder, 'dist-single'), { recursive: true });
    const started = Date.now();
    const out = spawnSync(process.execPath, [PLAYWRIGHT, 'test', ...RUNS[0].args, '--project=chromium', '--reporter=line'], {
      cwd: folder,
      encoding: 'utf8',
      timeout: 60_000,
      // CI set: reuseExistingServer is off, so a server left on the port cannot stand in for a real start
      env: { ...process.env, CI: '1' },
    });
    const text = `${out.stdout}${out.stderr}`;
    expect(out.status).not.toBe(0);
    expect(text).toContain('is not the single file');
    expect(text).toContain('npm run build:single');
    expect(Date.now() - started).toBeLessThan(AT_ONCE_MS);
  }, 120_000);
});
