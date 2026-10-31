import { ZONE_WORD, type Zone, fmt, pct, zoneOf } from './format.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './Readout.module.css';

/** Label over value; a zone other than ok colors the value and names the problem beside the label */
export function Readout({ label, value, unit, zone = 'ok', word, title }: { label: string; value: string; unit?: string; zone?: Zone; word?: string; title?: string }) {
  const w = word ?? ZONE_WORD[zone];
  return (
    <div className={chartStyles.measureRo} data-zone={zone} title={title}>
      <span className={chartStyles.measureRoLabel}>
        {label}
        {w && <span className={chartStyles.measureRoWord}> · {w}</span>}
      </span>
      <span className={cx(chartStyles.measureRoValue, 'mono')}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

/**
 * Hairline level: the line is the value (RMS), the tick the peak hold; each takes the zone of what it shows.
 * `was` ghosts the previous call: a faint mark where its RMS ended and a hollow tick at its peak.
 */
export function Level({ label, value, hold, was }: { label: string; value?: number; hold?: number; was?: { value?: number; hold?: number } | null }) {
  return (
    <div className={styles.hlLevel}>
      <span className={cx(styles.hlLabel, 'mono')}>{label}</span>
      <div className={styles.hlTrack} title={`Peak ${fmt(hold)} dB · RMS ${fmt(value)} dB`}>
        {value !== undefined && <span className={cx(styles.hlFill, styles.hlFillLevel)} style={{ clipPath: `inset(0 ${100 - pct(value, -60, 6)}% 0 0 round 2px)` }} />}
        <span className={styles.hlZero} style={{ left: `${pct(0, -60, 6)}%` }} />
        {was?.value !== undefined && <span className={styles.hlWas} style={{ left: `${pct(was.value, -60, 6)}%` }} title={`Previous call RMS ${fmt(was.value)} dB`} />}
        {was?.hold !== undefined && <span className={styles.hlWasHold} style={{ left: `${pct(was.hold, -60, 6)}%` }} title={`Previous call peak ${fmt(was.hold)} dB`} />}
        {hold !== undefined && <span className={styles.hlHold} data-zone={zoneOf(hold)} style={{ left: `${pct(hold, -60, 6)}%` }} />}
      </div>
      <span className={cx(styles.hlValue, 'mono')} data-zone={zoneOf(hold ?? value)}>{fmt(hold ?? value)}</span>
    </div>
  );
}

/** Tick labels on the same scale as the marks above; `indent` lines up with a Level's track */
export function Scale({ ticks, min, max, indent }: { ticks: number[]; min: number; max: number; indent?: boolean }) {
  return (
    <div className={cx(chartStyles.measureScale, indent ? chartStyles.measureScaleIndent : '')}>
      <div>
        {ticks.map((t) => (
          <span key={t} style={{ left: `${pct(t, min, max)}%` }}>
            {fmt(t, 0)}
          </span>
        ))}
      </div>
    </div>
  );
}
