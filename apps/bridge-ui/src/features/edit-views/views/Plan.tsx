import type { EditView } from '../edit-views.js';
import { Measurement } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Plan.module.css';

export function Plan({ v }: { v: Extract<EditView, { kind: "plan" }> }) {
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Ops" value={String(v.total)} />
        <Measurement.Readout label="Mode" value={v.dryRun ? "Dry run" : "Applied"} />
      </div>
      <ol className={styles.evPlan}>
        {v.ops.map(([op, what], i) => (
          <li key={i}>
            <span className={cx(styles.evOpN, 'mono')}>{i + 1}</span>
            <span className={cx(styles.evOp, 'mono')}>{op}</span>
            <span className={styles.evOpWhat} title={what}>
              {what}
            </span>
          </li>
        ))}
      </ol>
      {v.total > v.ops.length && (
        <div className={chartStyles.evMore}>
          +{v.total - v.ops.length} more ops not listed
        </div>
      )}
      {v.dryRun && (
        <div className={chartStyles.evMore}>A dry run: checked, nothing written.</div>
      )}
    </>
  );
}

// ── FX chain ─────────────────────────────────────────────────────────────────
