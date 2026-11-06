/**
 * The single-file build's meta CSP (PRD §3.9, DR-008).
 *
 * Every inline <script> and <style> is hashed (SHA-256, base64) into the
 * policy, which goes directly after <meta charset>: a meta policy does not
 * apply to content that precedes it, and the charset declaration must stay
 * within the first 1024 bytes.
 *
 * Inline elements are found tag by tag, as the HTML parser does: an element's
 * text ends at its first closing tag, and comments are skipped. The markup
 * checks look at tags outside script and style text and comments only, because
 * the bundle carries "<script>" and "javascript:" inside strings (E1, 5 Nov 2026).
 */

import { createHash } from 'node:crypto';

const CHARSET = '<meta charset="UTF-8" />';

/** The CSP hash-source for an element's text. */
export function sha256Source(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/**
 * Splits the page into markup, comments and the raw text of script and style
 * elements, calling onMarkup for each markup run and onElement for each element.
 */
function walk(html, onMarkup, onElement) {
  const lower = html.toLowerCase();
  const opener = /<!--|<(script|style)\b[^>]*>/gi;
  let i = 0;
  while (i < html.length) {
    opener.lastIndex = i;
    const m = opener.exec(html);
    if (!m) {
      onMarkup(html.slice(i));
      return;
    }
    if (m[0] === '<!--') {
      onMarkup(html.slice(i, m.index));
      const end = html.indexOf('-->', m.index + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const tag = m[1].toLowerCase();
    onMarkup(html.slice(i, m.index + m[0].length));
    const start = m.index + m[0].length;
    const close = lower.indexOf(`</${tag}`, start);
    const end = close === -1 ? html.length : close;
    onElement(tag, html.slice(start, end));
    i = end;
  }
}

/** The text of every inline script and style element, in document order. */
export function scanInline(html) {
  const out = { scripts: [], styles: [] };
  walk(
    html,
    () => {},
    (tag, text) => (tag === 'script' ? out.scripts : out.styles).push(text)
  );
  return out;
}

const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g;
const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function attributes(text) {
  const attrs = [];
  for (const m of (text ?? '').matchAll(ATTR)) {
    const raw = m[2] ?? '';
    const value = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
    attrs.push({ name: m[1].toLowerCase(), value });
  }
  return attrs;
}

/** Throws when the markup holds anything a hash cannot cover or that reaches outside the file. */
export function checkMarkup(html) {
  let markup = '';
  walk(html, (run) => (markup += run), () => {});
  for (const m of markup.matchAll(TAG)) {
    const tag = m[0];
    const name = m[1].toLowerCase();
    const attrs = attributes(m[2]);
    const get = (n) => attrs.find((a) => a.name === n);
    if (name === 'script' && get('src')) throw new Error(`A script with a src attribute remains: ${tag}`);
    if (name === 'link' && /(^|\s)stylesheet(\s|$)/i.test(get('rel')?.value ?? '')) {
      throw new Error(`A stylesheet link remains: ${tag}`);
    }
    for (const a of attrs) {
      if (/^on[a-z]+$/.test(a.name)) throw new Error(`An inline event handler remains: ${tag}`);
      if (/^\s*javascript:/i.test(a.value)) throw new Error(`A javascript: URL remains: ${tag}`);
      if ((a.name === 'src' || a.name === 'href') && /^\s*(https?:)?\/\//i.test(a.value)) {
        throw new Error(`An external URL remains: ${tag}`);
      }
    }
  }
}

/** PRD §3.9's policy with one hash per inline script and style. */
export function buildPolicy({ scripts, styles }) {
  const list = (texts) => (texts.length ? texts.map(sha256Source).join(' ') : "'none'");
  return (
    `default-src 'none'; script-src ${list(scripts)}; worker-src blob:; ` +
    `style-src ${list(styles)}; img-src data:; connect-src 'none'`
  );
}

/** Inserts the policy as a meta element directly after the one meta charset. */
export function insertPolicy(html, policy) {
  const count = html.split(CHARSET).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one ${CHARSET} in index.html, found ${count}`);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  return html.replace(CHARSET, CHARSET + meta);
}
