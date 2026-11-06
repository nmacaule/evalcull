// @vitest-environment node
/**
 * THIRD-PARTY-NOTICES from the lockfile (PRD §5 Bundle hygiene, DR-009): the
 * production closure, every lockfile package a bundled module belongs to, and
 * the build-tool runtimes; embedded in index.html as a comment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { packagesFor, renderNotices, embedNotices } from '../scripts/notices.mjs';

// Scratch package directories stay inside the repository: node_modules/.tmp is git-ignored
const ROOT = join(import.meta.dirname, '..', 'node_modules', '.tmp', 'notices-test');

function pkg(key: string, files: Record<string, string>) {
  const dir = join(ROOT, key);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

const LOCK = {
  packages: {
    '': { name: 'app', version: '0.0.1' },
    'node_modules/a': { version: '1.0.0', license: 'MIT' },
    'node_modules/b': { version: '3.0.0', license: 'MIT', dev: true },
    'node_modules/c': { version: '1.1.0', license: 'MIT', dev: true },
    'node_modules/c/node_modules/d': { version: '2.0.0', license: 'ISC' },
    'node_modules/vite': { version: '8.3.5', license: 'MIT', dev: true },
    'node_modules/rolldown': { version: '1.2.16', license: 'MIT', dev: true },
    'node_modules/opt': { version: '1.0.0', license: 'MIT', optional: true },
  },
};

const SEP = '\n' + '='.repeat(72) + '\n';
const HEADER =
  'THIRD-PARTY-NOTICES\n\n' +
  'The single-file build of evalcull inlines code from the packages below.\n' +
  'Each entry gives the package name and version, its licence, and the licence text.\n';

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  pkg('node_modules/a', { 'package.json': '{"name":"a"}', LICENSE: 'A licence\n' });
  pkg('node_modules/b', { 'package.json': '{"name":"b"}', LICENSE: 'B licence\n' });
  pkg('node_modules/c/node_modules/d', { 'package.json': '{"name":"d"}', 'LICENCE.md': 'D licence\n' });
  pkg('node_modules/vite', { 'package.json': '{"name":"vite"}', 'LICENSE.md': 'Vite licence\n' });
  pkg('node_modules/rolldown', { 'package.json': '{"name":"rolldown"}', LICENSE: 'Rolldown licence\n' });
  pkg('node_modules/nolic', {
    'package.json': '{"name":"nolic","license":"MIT","author":"A N Other <a@example.org>"}',
  });
  pkg('node_modules/odd', { 'package.json': '{"name":"odd","license":"LicenseRef-x"}' });
  pkg('node_modules/ap', { 'package.json': '{"name":"ap"}', LICENSE: 'Apache text\n', NOTICE: 'Ap notice\n' });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('packagesFor', () => {
  it('lists production packages and leaves out dev-only ones', () => {
    const packages = packagesFor(LOCK, [], []);
    expect(packages.map((p) => p.key)).toEqual(['node_modules/a', 'node_modules/c/node_modules/d']);
    expect(renderNotices(packages, ROOT)).toBe(
      HEADER +
        SEP +
        'a@1.0.0\nLicense: MIT\n\nA licence\n' +
        SEP +
        'd@2.0.0\nLicense: ISC\n\nD licence\n'
    );
  });

  it('adds a dev package whose module is in the bundle', () => {
    expect(packagesFor(LOCK, ['/r/node_modules/b/index.css'], []).map((p) => p.key)).toEqual([
      'node_modules/a',
      'node_modules/b',
      'node_modules/c/node_modules/d',
    ]);
    // A Windows module id (CI builds on windows-latest)
    expect(packagesFor(LOCK, ['C:\\r\\node_modules\\b\\index.css'], []).map((p) => p.key)).toContain(
      'node_modules/b'
    );
  });

  it('accepts first-party and virtual module ids, and always lists the build-tool runtimes', () => {
    const ids = [
      '/r/src/App.tsx',
      '/r/index.html',
      '\0rolldown/runtime.js',
      '\0vite/preload-helper.js',
      '/r/src/workers/indexer.worker.ts?worker&inline',
    ];
    expect(packagesFor(LOCK, ids).map((p) => `${p.name}@${p.version}`)).toEqual([
      'a@1.0.0',
      'd@2.0.0',
      'rolldown@1.2.16',
      'vite@8.3.5',
    ]);
  });

  it('fails for a bundled module with no package in the lockfile', () => {
    expect(() => packagesFor(LOCK, ['/r/node_modules/zz/x.js'], [])).toThrow(
      'Bundled module /r/node_modules/zz/x.js belongs to node_modules/zz, which is not in package-lock.json'
    );
  });
});

describe('renderNotices', () => {
  it('uses the SPDX text and the package author for a package with no licence file', () => {
    const text = renderNotices([{ key: 'node_modules/nolic', name: 'nolic', version: '1.0.0', license: 'MIT' }], ROOT);
    expect(text).toBe(HEADER + SEP + 'nolic@1.0.0\nLicense: MIT\n\nCopyright (c) A N Other\n\n' + MIT_TEXT + '\n');
  });

  it('fails for a package with no licence file and no SPDX text known', () => {
    expect(() =>
      renderNotices([{ key: 'node_modules/odd', name: 'odd', version: '1.0.0', license: 'LicenseRef-x' }], ROOT)
    ).toThrow('node_modules/odd has no licence file and LicenseRef-x has no standard text here');
  });

  it("includes a package's NOTICE file after its licence when one exists", () => {
    const text = renderNotices([{ key: 'node_modules/ap', name: 'ap', version: '1.0.0', license: 'Apache-2.0' }], ROOT);
    expect(text).toBe(HEADER + SEP + 'ap@1.0.0\nLicense: Apache-2.0\n\nApache text\n\nAp notice\n');
  });
});

describe('embedNotices', () => {
  it('escapes comment-breaking sequences in the HTML copy only', () => {
    const notices = 'a <!-- b --> c --!> d';
    const out = embedNotices('<head></head><body><div></div></body>', notices);
    expect(out).toBe('<head></head><body><div></div><!--\na <! -- b -- > c -- !> d\n-->\n</body>');
    // The file copy is the text itself
    expect(notices).toBe('a <!-- b --> c --!> d');
  });

  it('leaves no comment terminator in an escaped run of dashes', () => {
    const out = embedNotices('<body></body>', '<!--->');
    const inner = out.slice(out.indexOf('<!--\n') + 5, out.lastIndexOf('\n-->'));
    expect(inner).not.toMatch(/<!--|-->|--!>/);
  });
});
