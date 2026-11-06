// Types for scripts/notices.mjs, so tests/notices.test.ts type-checks.

export interface NoticePackage {
  key: string;
  name: string;
  version: string;
  license?: string;
}

export interface Lockfile {
  packages: Record<string, { name?: string; version?: string; license?: string; dev?: boolean; devOptional?: boolean; optional?: boolean }>;
}

export const BUILD_RUNTIMES: string[];
export function packagesFor(lockfile: Lockfile, moduleIds: string[], runtimes?: string[]): NoticePackage[];
export function renderNotices(packages: NoticePackage[], root: string): string;
export function embedNotices(html: string, text: string): string;
