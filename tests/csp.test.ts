// @vitest-environment node
/**
 * The single-file build's meta CSP (PRD §3.9, DR-008): hashes of every inline
 * script and style, inserted after meta charset, and the markup checks.
 */

import { describe, it, expect } from 'vitest';
import {
  sha256Source,
  scanInline,
  checkMarkup,
  buildPolicy,
  insertPolicy,
} from '../scripts/csp.mjs';
import { embedNotices } from '../scripts/notices.mjs';

describe('sha256Source', () => {
  it('hashes an inline script as the CSP specification example does', () => {
    expect(sha256Source("alert('Hello, world.');")).toBe(
      "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='"
    );
  });

  it("hashes an empty element's text", () => {
    // SHA-256 of the empty string
    expect(sha256Source('')).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  });
});

describe('scanInline', () => {
  it('hashes the text between the tags, attributes ignored', () => {
    const a = scanInline('<script type="module">a</script>');
    const b = scanInline('<script>a</script>');
    expect(a.scripts).toEqual(['a']);
    expect(b.scripts).toEqual(['a']);
    expect(sha256Source(a.scripts[0])).toBe(sha256Source(b.scripts[0]));
    // printf 'a\n' | openssl dgst -sha256 -binary | base64
    expect(sha256Source(scanInline('<script>a\n</script>').scripts[0])).toBe(
      "'sha256-h0KPxSKAPTEGXnvOPPA/5HUJZjHl4Hu9eg/eYMTPJcc='"
    );
  });

  it('ends an element at its first closing tag and skips comments', () => {
    const html =
      '<!-- <script>no</script> --><script>var s = "<style>";</script><style rel="stylesheet">b{}</style>';
    expect(scanInline(html)).toEqual({ scripts: ['var s = "<style>";'], styles: ['b{}'] });
  });
});

describe('checkMarkup', () => {
  it('refuses a remaining external script, a stylesheet link, an inline handler and a javascript: URL', () => {
    expect(() => checkMarkup('<script src="a.js"></script>')).toThrow(
      'A script with a src attribute remains: <script src="a.js">'
    );
    expect(() => checkMarkup('<link rel="stylesheet" href="a.css">')).toThrow(
      'A stylesheet link remains: <link rel="stylesheet" href="a.css">'
    );
    expect(() => checkMarkup('<div onclick="x()"></div>')).toThrow(
      'An inline event handler remains: <div onclick="x()">'
    );
    expect(() => checkMarkup('<a href="javascript:x()">x</a>')).toThrow(
      'A javascript: URL remains: <a href="javascript:x()">'
    );
  });

  it('refuses an external URL', () => {
    expect(() => checkMarkup('<img src="https://example.org/a.png">')).toThrow(
      'An external URL remains: <img src="https://example.org/a.png">'
    );
  });

  it('ignores script text and comments (E1: the bundle holds "<script>" and "javascript:" in strings)', () => {
    expect(() =>
      checkMarkup(
        '<head><script type="module">var a = "<script src=x>"; var b = "javascript:";</script></head>' +
          '<body><div id="root"></div><!-- https://example.org onclick="x" --></body>'
      )
    ).not.toThrow();
  });
});

describe('buildPolicy and insertPolicy', () => {
  it('builds the PRD §3.9 policy with one hash per element', () => {
    expect(buildPolicy({ scripts: ['x'], styles: [''] })).toBe(
      "default-src 'none'; script-src 'sha256-LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE='; " +
        "worker-src blob:; style-src 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; " +
        "img-src data:; connect-src 'none'"
    );
  });

  it('inserts the policy directly after meta charset', () => {
    const input = '<head><meta charset="UTF-8" /><title>t</title><script>x</script></head>';
    // printf x | openssl dgst -sha256 -binary | base64
    const policy =
      "default-src 'none'; script-src 'sha256-LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE='; " +
      "worker-src blob:; style-src 'none'; img-src data:; connect-src 'none'";
    expect(insertPolicy(input, policy)).toBe(
      '<head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="' +
        policy +
        '"><title>t</title><script>x</script></head>'
    );
  });

  it('keeps meta charset within the first 1024 bytes when the notices comment is added', () => {
    const input =
      '<head><meta charset="UTF-8" /><title>t</title><script>x</script></head><body></body>';
    const out = insertPolicy(embedNotices(input, 'x'.repeat(100000)), buildPolicy(scanInline(input)));
    expect(out.indexOf('<meta charset="UTF-8" />')).toBe(6);
    expect(out.indexOf('<!--')).toBeGreaterThan(out.indexOf('<body>'));
  });

  it('refuses a page without exactly one meta charset', () => {
    expect(() => insertPolicy('<head><title>t</title></head>', "default-src 'none'")).toThrow(
      'Expected exactly one <meta charset="UTF-8" /> in index.html, found 0'
    );
  });
});
