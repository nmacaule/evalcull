// @vitest-environment node
/**
 * The content-lint workflow scans the built Pages and Space outputs (D-089).
 *
 * The step that scans dist must install dependencies on the project's Node
 * before build:single, and a build failure must fail the check rather than
 * skip the scan.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW = join(import.meta.dirname, '..', '.github', 'workflows', 'content-lint.yml');

/** The text of one step, from its `- name:` line to the next step or the end. */
function stepText(workflow: string, name: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start === -1) return '';
  const indent = lines[start].indexOf('-');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].indexOf('- name:') === indent) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('content-lint workflow', () => {
  it('the build-output scan installs dependencies and fails when build:single fails (D-089)', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    const step = stepText(workflow, 'Pages and Space build outputs (when present)');

    // The job runs on the project's Node, from .nvmrc
    expect(workflow).toContain('actions/setup-node');
    expect(workflow).toContain("node-version-file: '.nvmrc'");

    // The step installs dependencies, then builds the single file
    expect(step).toContain('npm ci');
    expect(step).toContain('npm run build:single');
    expect(step.indexOf('npm ci')).toBeLessThan(step.indexOf('npm run build:single'));

    // A failed build is not discarded or turned into a skipped scan
    expect(step).not.toContain('2>/dev/null');
    expect(step).not.toMatch(/if\s+npm run[^\n]*build:single/);

    // Every file under dist is passed to the scanner, directories included
    expect(step).toContain('find dist-single -type f -print0 | xargs -0 scripts/content-lint files');
  });
});
