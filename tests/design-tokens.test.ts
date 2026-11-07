// @vitest-environment node
/**
 * Static guard for PRD §2.11 (WP 7b): src/index.css carries every token with
 * the §2.11 value in both themes, and no other file in src/ holds a literal
 * colour, a Tailwind default class or a class that generates no CSS. Classes
 * are checked by compiling src/index.css in memory with tailwindcss, so the
 * test never needs a build and never skips. Sources are parsed with vite's
 * parseAst, so class strings are found by their position in the code.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { compile } from 'tailwindcss';
import { parseAst } from 'vite';
import { TOKENS, type Theme } from '../e2e/design/tokens';

const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');
const CSS_PATH = join(SRC, 'index.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Token values
// ---------------------------------------------------------------------------

/** The declarations of the first block whose selector matches, by brace depth. */
function block(css: string, opener: RegExp): string {
  const m = opener.exec(css);
  if (!m) return '';
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(m.index + m[0].length, i);
  }
  return '';
}

function oklchProps(body: string): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
    out.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return out;
}

const darkMedia = block(CSS, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/);
const THEMES: Record<Theme, Map<string, [number, number, number]>> = {
  // The light values sit in the first top-level :root block
  light: oklchProps(block(CSS.replace(darkMedia, ''), /(^|\n):root\s*\{/)),
  dark: oklchProps(block(darkMedia, /:root\s*\{/)),
};

describe('src/index.css tokens (PRD §2.11)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`defines every §2.11 colour token with its ${theme} value`, () => {
      const props = THEMES[theme];
      for (const [name, values] of Object.entries(TOKENS)) {
        const v = values[theme];
        expect(props.get(name), `${theme} --${name}`).toEqual([v.l, v.c, v.h]);
      }
    });
  }

  it('defines on-primary as white and the scrim as black at 40 % (O17 amended)', () => {
    expect(CSS).toMatch(/--on-primary\s*:\s*oklch\(\s*1\s+0\s+0\s*\)/);
    expect(CSS).toMatch(/--scrim\s*:\s*oklch\(\s*0\s+0\s+0\s*\/\s*0?\.4\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Class strings
// ---------------------------------------------------------------------------

interface Lit {
  file: string;
  line: number;
  text: string;
  /** Trimmed at a template expression boundary on this side */
  openStart: boolean;
  openEnd: boolean;
}

function walkFiles(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walkFiles(p, ext) : ext.test(name) ? [p] : [];
  });
}

type Node = { type: string; start: number; end: number; [k: string]: unknown };

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) out.push(...value.filter((v) => v && typeof v.type === 'string'));
    else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') out.push(value as Node);
  }
  return out;
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/**
 * Every string literal and template part under a node, except those that are
 * not class strings by their place: an object key, a comparison operand, a
 * switch case's test and cva's defaultVariants (variant names, not classes).
 */
function literalsUnder(node: Node, file: string, source: string, into: Lit[]): void {
  if (node.type === 'Property') {
    const key = node.key as Node;
    if (key.type === 'Identifier' && key.name === 'defaultVariants') return;
    literalsUnder(node.value as Node, file, source, into);
    return;
  }
  if (node.type === 'BinaryExpression') return;
  if (node.type === 'SwitchCase') {
    for (const s of node.consequent as Node[]) literalsUnder(s, file, source, into);
    return;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    into.push({ file, line: lineOf(source, node.start), text: node.value, openStart: false, openEnd: false });
  } else if (node.type === 'TemplateLiteral') {
    const quasis = node.quasis as Node[];
    quasis.forEach((q, i) => {
      const cooked = (q.value as { cooked: string }).cooked ?? '';
      into.push({
        file,
        line: lineOf(source, q.start),
        text: cooked,
        openStart: i > 0,
        openEnd: i < quasis.length - 1,
      });
    });
  }
  for (const c of children(node)) literalsUnder(c, file, source, into);
}

function identifiersUnder(node: Node, into: Set<string>): void {
  if (node.type === 'Identifier') into.add(node.name as string);
  for (const c of children(node)) identifiersUnder(c, into);
}

interface FileStrings {
  positional: Lit[];
  other: Lit[];
}

function collect(file: string): FileStrings {
  const source = readFileSync(file, 'utf8');
  const ast = parseAst(source, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }) as unknown as Node;
  const positionalNodes: Node[] = [];
  const named = new Map<string, Node>();
  const referenced = new Set<string>();

  const visit = (node: Node) => {
    if (node.type === 'JSXAttribute') {
      const name = node.name as Node;
      if (name.type === 'JSXIdentifier' && name.name === 'className' && node.value) {
        positionalNodes.push(node.value as Node);
        identifiersUnder(node.value as Node, referenced);
      }
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee as Node;
      if (callee.type === 'Identifier' && (callee.name === 'cn' || callee.name === 'cva')) {
        for (const a of node.arguments as Node[]) positionalNodes.push(a);
      }
    }
    if (node.type === 'VariableDeclarator' && (node.id as Node).type === 'Identifier' && node.init) {
      named.set((node.id as Node).name as string, node.init as Node);
    }
    if (node.type === 'FunctionDeclaration' && node.id) {
      named.set((node.id as Node).name as string, node.body as Node);
    }
    for (const c of children(node)) visit(c);
  };
  visit(ast);

  // A name a className expression reads holds class strings too (DiffView's
  // TONE, StorageIndicator's tone, ConversationView's getRoleBadgeStyles)
  for (const name of referenced) {
    const target = named.get(name);
    if (target) positionalNodes.push(target);
  }

  const positional: Lit[] = [];
  for (const n of positionalNodes) literalsUnder(n, file, source, positional);
  const seen = new Set(positional.map((l) => `${l.line}:${l.text}`));
  const all: Lit[] = [];
  literalsUnder(ast, file, source, all);
  const other = all.filter((l) => !seen.has(`${l.line}:${l.text}`));
  return { positional, other };
}

function tokensOf(lit: Lit): string[] {
  const parts = lit.text.split(/\s+/);
  // A token touching a template expression is incomplete, so it is not judged
  if (lit.openStart && !/^\s/.test(lit.text)) parts.shift();
  if (lit.openEnd && !/\s$/.test(lit.text)) parts.pop();
  return parts.filter(Boolean);
}

const MARKERS = new Set(['group', 'peer']);

/** The utility part of a class token: after its last variant colon outside brackets. */
function utilityOf(token: string): string {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === '[') depth++;
    else if (token[i] === ']') depth--;
    else if (token[i] === ':' && depth === 0) cut = i + 1;
  }
  return token.slice(cut);
}

const PALETTE =
  /^-?(bg|text|border|ring|outline|fill|stroke|from|to|via|divide|decoration|caret|accent|placeholder|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-(50|[1-9]00|950))?(\/\d+)?$/;
// Tailwind's default scales run 50 to 950; the §2.11 neutral and accent scales run 1 to 12, so they never match
const FORBIDDEN: [RegExp, string][] = [
  [PALETTE, 'Tailwind default palette'],
  [/^text-(xs|sm|base|lg|\d?xl)$/, 'Tailwind default text size'],
  [/^duration-\d+$/, 'literal duration'],
  [/^shadow(-\w+)?$/, 'shadow'],
  [/^outline-none$/, 'focus outline removed'],
  [/^animate-spin$/, 'looping animation'],
  [/\[/, 'arbitrary value'],
];
const FORBIDDEN_VARIANTS = /(^|:)(dark|sm|md|lg|xl|2xl):/;

let built = '';
let tw: Awaited<ReturnType<typeof compile>>;
const generates = new Map<string, boolean>();

function generatesCss(token: string): boolean {
  const known = generates.get(token);
  if (known !== undefined) return known;
  const next = tw.build([token]);
  const grew = next.length > built.length;
  built = next;
  generates.set(token, grew);
  return grew;
}

beforeAll(async () => {
  tw = await compile(CSS, {
    base: SRC,
    from: CSS_PATH,
    loadStylesheet: async (id: string, base: string) => {
      const path = id === 'tailwindcss' ? join(ROOT, 'node_modules/tailwindcss/index.css') : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  built = tw.build([]);
});

const SOURCES = walkFiles(SRC, /\.tsx?$/).filter((f) => !f.endsWith('.d.ts'));

describe('class strings in src (PRD §2.11, the ui rules)', () => {
  it('every class token generates CSS from the tokens and none is forbidden', () => {
    const failures: string[] = [];
    for (const file of SOURCES) {
      const { positional, other } = collect(file);
      // Content rule: lower-case literals outside a class position whose tokens include a utility
      const byContent = other.filter((l) => !/[A-Z]/.test(l.text) && tokensOf(l).some((t) => generatesCss(t)));
      for (const lit of [...positional, ...byContent]) {
        for (const token of tokensOf(lit)) {
          const where = `${relative(ROOT, lit.file)}:${lit.line} ${token}`;
          if (MARKERS.has(token)) continue;
          if (FORBIDDEN_VARIANTS.test(token)) failures.push(`${where} (dark or responsive variant)`);
          const utility = utilityOf(token);
          const hit = FORBIDDEN.find(([re]) => re.test(utility));
          if (hit) failures.push(`${where} (${hit[1]})`);
          else if (!generatesCss(token)) failures.push(`${where} (generates no CSS)`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('no literal colour appears in a string in src outside index.css', () => {
    const failures: string[] = [];
    for (const file of SOURCES) {
      const { positional, other } = collect(file);
      for (const lit of [...positional, ...other]) {
        if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\boklab\(/.test(lit.text)) {
          failures.push(`${relative(ROOT, lit.file)}:${lit.line} ${lit.text.slice(0, 60)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the compiled CSS defines no --color- property outside the §2.11 tokens', () => {
    const allowed = new Set([
      ...Object.keys(TOKENS),
      'on-primary',
      'primary-fill',
      'primary-fill-hover',
      'scrim',
      'dialog',
    ]);
    // Build every candidate in src, so every theme variable a class reads is emitted
    for (const file of SOURCES) {
      const { positional, other } = collect(file);
      for (const lit of [...positional, ...other]) for (const t of tokensOf(lit)) generatesCss(t);
    }
    const names = new Set([...built.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    expect([...names].filter((n) => !allowed.has(n))).toEqual([]);
  });
});
