/**
 * WP 6b: the cheat sheet lists every key of the hotkey table once, grouped,
 * with the panel keys live.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheatSheet } from '../src/components/CheatSheet';
import { HOTKEY_TABLE } from '../src/lib/hotkeyTable';

describe('cheat sheet', () => {
  it('shows every hotkey-table key exactly once', () => {
    render(<CheatSheet open={true} onOpenChange={() => {}} />);
    for (const entry of HOTKEY_TABLE) {
      expect(document.querySelectorAll(`[data-hotkey="${CSS.escape(entry.key)}"]`)).toHaveLength(1);
    }
  });

  it('lists M, L, N, G and / under Panels, none of them a no-op', () => {
    render(<CheatSheet open={true} onOpenChange={() => {}} />);
    const heading = screen.getByRole('heading', { name: 'Panels' });
    const keys = Array.from(heading.parentElement!.querySelectorAll('[data-hotkey]')).map((el) =>
      el.getAttribute('data-hotkey')
    );
    expect(keys).toEqual(['m', 'l', 'n', 'g', '/']);
    expect(HOTKEY_TABLE.filter((h) => h.isNoOp)).toEqual([]);
  });

  it('describes the editor turn switch on the ↑ row', () => {
    render(<CheatSheet open={true} onOpenChange={() => {}} />);
    expect(document.querySelector('[data-hotkey="ArrowUp"]')!.textContent).toContain(
      'in the editor, ↑ at the start or ↓ at the end switches assistant turns while the text is unchanged'
    );
  });
});
