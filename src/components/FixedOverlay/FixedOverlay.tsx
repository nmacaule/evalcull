/**
 * A fixed overlay that keeps the root's scroll padding equal to its extent on
 * the side it occupies, so a focused element scrolls clear of it (PRD §2.11
 * Focus, DR-024 [S213]). The extent is measured, not assumed: a storage reason
 * that wraps makes the bar taller, and the padding follows it.
 */

import { useLayoutEffect, useRef, type ReactNode } from 'react';

export interface FixedOverlayProps {
  /** The edge of the viewport the overlay sits against */
  side: 'top' | 'bottom';
  className: string;
  role?: string;
  children: ReactNode;
}

export function FixedOverlay({ side, className, role, children }: FixedOverlayProps) {
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const root = document.documentElement;
    const prop = side === 'top' ? '--overlay-top' : '--overlay-bottom';
    // From the viewport edge to the overlay's far edge, offset included, as a
    // unitless number of CSS pixels; src/index.css gives it its unit
    const measure = () => {
      const r = el.getBoundingClientRect();
      const extent = side === 'top' ? r.bottom : window.innerHeight - r.top;
      root.style.setProperty(prop, String(Math.ceil(extent)));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty(prop);
    };
  }, [side]);

  return (
    <div ref={box} role={role} className={className}>
      {children}
    </div>
  );
}
