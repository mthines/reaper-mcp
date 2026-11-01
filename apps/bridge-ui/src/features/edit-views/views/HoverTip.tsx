import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './HoverTip.module.css';

/**
 * A cell whose value shows in a tip above it while the pointer is over it, at once (a native `title` waits
 * about a second and needs a steady hand on a small mark). Use it for marks that draw a value without printing
 * it: a fader, a pan dot.
 */
export function HoverTip({ tip, className, children, ...rest }: { tip: string; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  const [on, setOn] = useState(false);
  return (
    <span {...rest} className={cx(className, styles.host)} onPointerEnter={() => setOn(true)} onPointerLeave={() => setOn(false)}>
      {children}
      {on && (
        <span role="tooltip" className={cx(chartStyles.spectrumTip, styles.tip, 'mono')}>
          {tip}
        </span>
      )}
    </span>
  );
}
