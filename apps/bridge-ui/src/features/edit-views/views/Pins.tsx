import type { CSSProperties } from 'react';
import type { EditView } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { fxShort } from './format.js';
import { Measurement } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Pins.module.css';

/** Every channel a pin uses, before or after, and the track's own, up to 64 */
function columnCount(v: Extract<EditView, { kind: "pins" }>): number {
  const used = [...v.in, ...v.out, ...(v.inWas ?? []), ...(v.outWas ?? [])].flat();
  return Math.min(64, Math.max(v.ch, v.chWas ?? 0, ...used, 2));
}

export function Pins({ v }: { v: Extract<EditView, { kind: "pins" }> }) {
  const cols = columnCount(v);
  const chans = Array.from({ length: cols }, (_, i) => i + 1);
  // Which pin states the grid draws, so the legend names only those
  const states = (now: number[][], was: number[][] | undefined) => now.flatMap((pin, p) => chans.map((c) => [pin.includes(c), was ? (was[p] ?? []).includes(c) : pin.includes(c)]));
  const all = [...states(v.in, v.inWas), ...states(v.out, v.outWas)];
  const kept = all.some(([on, before]) => on && before);
  const added = all.some(([on, before]) => on && !before);
  const dropped = all.some(([on, before]) => !on && before);
  const side = (title: string, now: number[][], was: number[][] | undefined, names?: string[]) => (
    <>
      <div className={styles.side} role="row"><span role="rowheader">{title}</span></div>
      {now.map((pin, p) => (
        <div key={`${title}${p}`} className={styles.row} role="row">
          <span className={`${styles.name} mono`} role="rowheader" title={names?.[p] || `${title} pin ${p + 1}`}>{names?.[p] || `${p + 1}`}</span>
          {chans.map((c) => {
            const on = pin.includes(c);
            const before = was ? (was[p] ?? []).includes(c) : on;
            const state = on && !before ? styles.new : !on && before ? styles.gone : on ? styles.on : undefined;
            const change = on !== before ? (on ? " (new)" : " (removed)") : "";
            return (
              <span key={c} className={cx(styles.pin, state, c > v.ch && styles.out)} role="cell"
                title={`${title} pin ${p + 1} · channel ${c}${on ? " · connected" : ""}${change}`}
                aria-label={`channel ${c}${on ? ", connected" : ""}${change}`} />
            );
          })}
        </div>
      ))}
    </>
  );
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Plugin" value={v.fx ? fxShort(v.fx) : "–"} />
        <Measurement.Readout label="Track channels" value={v.chWas !== undefined && v.chWas !== v.ch ? `${v.chWas} → ${v.ch}` : String(v.ch)} />
      </div>
      <div className={styles.pins} style={{ "--cols": cols } as CSSProperties} role="table" aria-label="Pin matrix: pins by track channel">
        <div className={styles.row} role="row">
          <span className={styles.name} role="columnheader" aria-label="Pin" />
          {chans.map((c) => (
            <span key={c} className={`${styles.ch} mono`} role="columnheader">{c}</span>
          ))}
        </div>
        {side("In", v.in, v.inWas, v.names)}
        {side("Out", v.out, v.outWas)}
      </div>
      <Legend
        items={[
          ...(kept ? [[styles.lgOn, "Connected"]] : []),
          ...(added ? [[styles.lgNew, "Newly connected"]] : []),
          ...(dropped ? [[styles.lgGone, "Disconnected"]] : []),
        ] as Array<[string, string]>}
      />
    </>
  );
}
