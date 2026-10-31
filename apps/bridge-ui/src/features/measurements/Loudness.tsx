import { Readout, Scale } from './Readout.js';
import { fmt, pct, tpWord, tpZone } from './format.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './Loudness.module.css';

export const lufsPct = (v: number) => pct(v, -40, 0);

/** One big integrated number, then where the three readings sit, against the agent's target when it gave one */
export function Loudness({ m, target, was }: { m: Extract<Measurement, { kind: 'lufs' }>; target: number | null; was?: number }) {
  const i = m.integrated;
  const delta = target === null || i === undefined || i <= -149 ? null : i - target;
  return (
    <>
      <div className={styles.lufsBig}>
        <b className="mono">{fmt(i)}</b>
        <small>LUFS integrated</small>
        {delta !== null && target !== null && (
          <span className={cx(styles.lufsDelta, 'mono', Math.abs(delta) <= 1 ? styles.lufsOn : delta > 0 ? styles.lufsOver : '')}>{Math.abs(delta) < 0.05 ? `on ${fmt(target, 0)}` : `${Math.abs(delta).toFixed(1)} ${delta > 0 ? 'over' : 'under'} ${fmt(target, 0)}`}</span>
        )}
      </div>
      <div className={styles.lufsTrack} role="img" aria-label={`Integrated ${fmt(i)} LUFS, short-term ${fmt(m.shortTerm)}, momentary ${fmt(m.momentary)}${target !== null ? `, target ${fmt(target, 0)}` : ''}`}>
        {target !== null && (
          <span className={styles.lufsTarget} style={{ left: `${lufsPct(target - 1)}%`, width: `${lufsPct(target + 1) - lufsPct(target - 1)}%` }} />
        )}
        {m.shortTerm !== undefined && <span className={styles.lufsShort} style={{ width: `${lufsPct(m.shortTerm)}%` }} />}
        {m.momentary !== undefined && <span className={styles.lufsMomentary} style={{ left: `${lufsPct(m.momentary)}%` }} />}
        {was !== undefined && was > -149 && <span className={styles.lufsWas} style={{ left: `${lufsPct(was)}%` }} title={`Previous call ${fmt(was)} LUFS`} />}
        {i !== undefined && <span className={styles.lufsNeedle} style={{ left: `${lufsPct(i)}%` }} />}
      </div>
      <Scale ticks={[-40, -30, -20, -10, 0]} min={-40} max={0} />
      <div className={chartStyles.measureLegend}>
        <span><i className={chartStyles.lgNeedle} /> Integrated</span>
        <span><i className={chartStyles.lgShort} /> Short-term</span>
        <span><i className={chartStyles.lgMomentary} /> Momentary</span>
        {target !== null && <span><i className={chartStyles.lgTarget} /> Target {fmt(target, 0)} ±1 LU</span>}
        {was !== undefined && was > -149 && <span><i className={chartStyles.lgWas} /> Previous call</span>}
      </div>
      <div className={chartStyles.measureReadouts}>
        <Readout label="Short-term" value={fmt(m.shortTerm)} unit="LUFS" />
        <Readout label="Momentary" value={fmt(m.momentary)} unit="LUFS" />
        {m.duration !== undefined && <Readout label="Measured" value={m.duration.toFixed(1)} unit="s" />}
        <Readout label="True peak L" value={fmt(m.truePeakL)} unit="dBTP" zone={tpZone(m.truePeakL)} word={tpWord(m.truePeakL)} />
        <Readout label="True peak R" value={fmt(m.truePeakR)} unit="dBTP" zone={tpZone(m.truePeakR)} word={tpWord(m.truePeakR)} />
      </div>
    </>
  );
}
