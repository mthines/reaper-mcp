import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx.js';
import styles from './HoverTip.module.css';

/** The box a tip must stay inside: the nearest ancestor that clips sideways (the drawer), else the window */
function boundsOf(el: HTMLElement): { left: number; right: number } {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowX;
    if (o !== 'visible') {
      const r = p.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }
  }
  return { left: 0, right: window.innerWidth };
}

/**
 * A cell whose value shows in a tip above it while the pointer is over it, at once (a native `title` waits
 * about a second and needs a steady hand on a small mark). Use it for marks that draw a value without printing
 * it: a fader, a pan dot, a bar, a needle with the previous call beside it. Several lines go one per row; the tip
 * slides sideways to stay inside the drawer.
 */
export function HoverTip({ tip, className, children, ...rest }: { tip: string | string[]; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  const [on, setOn] = useState(false);
  const tipRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!on || !el) return;
    el.style.setProperty('--shift', '0px');
    const r = el.getBoundingClientRect();
    const box = boundsOf(el);
    let shift = Math.min(0, box.right - 4 - r.right);
    if (r.left + shift < box.left + 4) shift = box.left + 4 - r.left;
    el.style.setProperty('--shift', `${shift}px`);
  }, [on]);
  const lines = typeof tip === 'string' ? [tip] : tip;
  return (
    <span {...rest} className={cx(className, styles.host)} onPointerEnter={() => setOn(true)} onPointerLeave={() => setOn(false)}>
      {children}
      {on && (
        <span ref={tipRef} role="tooltip" className={cx(styles.tip, 'mono')}>
          {lines.map((l, i) => (
            <span key={i} className={styles.line}>{l}</span>
          ))}
        </span>
      )}
    </span>
  );
}
