/**
 * A key as the user presses it (§2.11 screen 8): text-chrome on neutral-3 in a
 * neutral-7 border at radius 4. The cheat sheet, the header and the action bar use it.
 */

import type { ReactNode } from 'react';

export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-control border border-neutral-7 bg-neutral-3 px-1 text-chrome text-neutral-12 whitespace-nowrap">
      {children}
    </kbd>
  );
}
