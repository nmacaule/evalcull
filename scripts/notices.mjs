/**
 * THIRD-PARTY-NOTICES for the single-file build (PRD §5 Bundle hygiene, DR-009).
 *
 * The packages are read from package-lock.json: its production closure (entries
 * that are neither dev nor optional), every lockfile package a bundled module
 * belongs to (the module ids the build recorded), and the build-tool runtimes
 * whose helpers are emitted into the bundle. Each entry carries the package's
 * own licence and NOTICE files; a package that ships no licence file gets the
 * SPDX standard text of its declared licence with its package.json author.
 * The same text is written beside index.html and embedded at the end of its
 * body, so a single file sent on its own carries it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Build tools whose runtime helpers are emitted into every bundle. */
export const BUILD_RUNTIMES = ['node_modules/rolldown', 'node_modules/vite'];

const SEP = '\n' + '='.repeat(72) + '\n';
const HEADER =
  'THIRD-PARTY-NOTICES\n\n' +
  'The single-file build of evalcull inlines code from the packages below.\n' +
  'Each entry gives the package name and version, its licence, and the licence text.\n';

// SPDX standard texts (https://spdx.org/licenses/MIT.html, https://spdx.org/licenses/ISC.html)
const STANDARD_TEXT = {
  MIT: `Permission is hereby granted, free of charge, to any person obtaining a copy
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
SOFTWARE.`,
  ISC: `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
};

/** The lockfile key of the package a module id belongs to, or null for first-party and virtual ids. */
function packageKey(id) {
  if (id.startsWith('\0')) return null;
  const path = id.split('?')[0].replace(/\\/g, '/');
  const at = path.indexOf('/node_modules/');
  if (at === -1) return null;
  const parts = path.slice(at + 1).split('/');
  const key = [];
  let i = 0;
  while (parts[i] === 'node_modules' && i + 1 < parts.length) {
    const scoped = parts[i + 1].startsWith('@');
    const name = scoped ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
    key.push('node_modules', name);
    i += scoped ? 3 : 2;
  }
  return key.join('/');
}

function nameOf(key, entry) {
  return entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/**
 * The packages whose code the bundle carries, sorted by name and version.
 * @param lockfile parsed package-lock.json
 * @param moduleIds the module ids the build recorded
 * @param runtimes lockfile keys always listed (the build-tool runtimes)
 */
export function packagesFor(lockfile, moduleIds, runtimes = BUILD_RUNTIMES) {
  const packages = lockfile.packages;
  const keys = new Set();
  for (const [key, entry] of Object.entries(packages)) {
    if (key && !entry.dev && !entry.devOptional && !entry.optional) keys.add(key);
  }
  for (const id of moduleIds) {
    const key = packageKey(id);
    if (key === null) continue;
    if (!packages[key]) {
      throw new Error(`Bundled module ${id} belongs to ${key}, which is not in package-lock.json`);
    }
    keys.add(key);
  }
  for (const key of runtimes) {
    if (!packages[key]) throw new Error(`Build-tool runtime ${key} is not in package-lock.json`);
    keys.add(key);
  }
  return [...keys]
    .map((key) => ({ key, name: nameOf(key, packages[key]), version: packages[key].version, license: packages[key].license }))
    .sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name < b.name ? -1 : 1));
}

function readFirst(dir, pattern) {
  const file = readdirSync(dir).filter((f) => pattern.test(f)).sort()[0];
  return file === undefined ? null : readFileSync(join(dir, file), 'utf8');
}

function authorName(manifest) {
  const author = manifest.author;
  if (typeof author === 'string') return author.replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').trim();
  return author?.name ?? null;
}

/** The notices text for the given packages, read from their directories under root. */
export function renderNotices(packages, root) {
  let out = HEADER;
  for (const p of packages) {
    const dir = join(root, p.key);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const license = p.license ?? (typeof manifest.license === 'string' ? manifest.license : undefined);
    if (!license) throw new Error(`${p.key} declares no licence`);
    let text = readFirst(dir, /^(licen[cs]e|copying)(\.[a-z0-9]+)?$/i);
    if (text === null) {
      const standard = STANDARD_TEXT[license];
      const holder = authorName(manifest);
      if (!standard) throw new Error(`${p.key} has no licence file and ${license} has no standard text here`);
      if (!holder) throw new Error(`${p.key} has no licence file and no author to name as copyright holder`);
      text = `Copyright (c) ${holder}\n\n${standard}`;
    }
    const notice = readFirst(dir, /^notice(\.[a-z0-9]+)?$/i);
    out += SEP + `${p.name}@${p.version}\nLicense: ${license}\n\n${text.trim()}\n`;
    if (notice !== null) out += `\n${notice.trim()}\n`;
  }
  return out;
}

/** The text with every comment-breaking sequence broken, for an HTML comment. */
function forComment(text) {
  let out = text;
  while (/<!--|-->|--!>/.test(out)) {
    out = out.replace(/<!--/g, '<! --').replace(/--!>/g, '-- !>').replace(/-->/g, '-- >');
  }
  return out;
}

/** Embeds the notices as a comment at the end of the page's body. */
export function embedNotices(html, text) {
  const at = html.lastIndexOf('</body>');
  if (at === -1) throw new Error('index.html has no </body> to embed the notices before');
  return html.slice(0, at) + `<!--\n${forComment(text)}\n-->\n` + html.slice(at);
}
