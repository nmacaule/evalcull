#!/usr/bin/env node
/**
 * The post-build step of npm run build:single (PRD §3.9, §5 Bundle hygiene).
 *
 * 1. Refuses markup a hash cannot cover or that reaches outside the file.
 * 2. Writes dist-single/THIRD-PARTY-NOTICES from the lockfile and the module ids the
 *    build recorded, and embeds the same text at the end of the body (DR-009).
 * 3. Hashes every inline script and style into the meta CSP, inserted directly
 *    after meta charset (DR-008).
 * 4. Copies the three samples beside index.html (DR-010).
 *
 * Usage: node scripts/post-build.mjs (after vite build --mode single)
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPolicy, checkMarkup, insertPolicy, scanInline } from './csp.mjs';
import { embedNotices, packagesFor, renderNotices } from './notices.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// build:single's own folder, apart from npm run build's dist/ (DR-037, D-112)
const dist = join(root, 'dist-single');
const page = join(dist, 'index.html');

function readJson(file) {
  if (!existsSync(file)) throw new Error(`${file} is missing; run vite build --mode single first`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

const html = readFileSync(page, 'utf8');
checkMarkup(html);

const lockfile = readJson(join(root, 'package-lock.json'));
const moduleIds = [
  ...readJson(join(root, 'node_modules', '.tmp', 'bundle-modules.main.json')),
  ...readJson(join(root, 'node_modules', '.tmp', 'bundle-modules.worker.json')),
];
const packages = packagesFor(lockfile, moduleIds);
const notices = renderNotices(packages, root);
writeFileSync(join(dist, 'THIRD-PARTY-NOTICES'), notices);

const withNotices = embedNotices(html, notices);
const inline = scanInline(withNotices);
const policy = buildPolicy(inline);
const out = insertPolicy(withNotices, policy);
const charsetAt = Buffer.byteLength(out.slice(0, out.indexOf('<meta charset')));
if (charsetAt + '<meta charset="UTF-8" />'.length > 1024) {
  throw new Error(`meta charset ends past the first 1024 bytes (starts at byte ${charsetAt})`);
}
writeFileSync(page, out);

mkdirSync(join(dist, 'samples'), { recursive: true });
const samples = readdirSync(join(root, 'samples')).filter((f) => f.endsWith('.jsonl'));
for (const f of samples) copyFileSync(join(root, 'samples', f), join(dist, 'samples', f));

process.stdout.write(
  `post-build: ${inline.scripts.length} script and ${inline.styles.length} style hashed\n` +
    `  ${policy}\n` +
    `  THIRD-PARTY-NOTICES: ${packages.length} packages\n` +
    `  samples: ${samples.join(', ')}\n`
);
