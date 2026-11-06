// Types for scripts/csp.mjs, so tests/csp.test.ts type-checks.

export function sha256Source(text: string): string;
export function scanInline(html: string): { scripts: string[]; styles: string[] };
export function checkMarkup(html: string): void;
export function buildPolicy(inline: { scripts: string[]; styles: string[] }): string;
export function insertPolicy(html: string, policy: string): string;
