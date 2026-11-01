import { fmt, pct, tipLine } from './format.js';
import { HoverTip } from '../../components/index.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './StereoBands.module.css';

const STEREO_BANDS: Record<string, [string, string]> = {
  low: ['Low', '< 120 Hz'],
  lowMid: ['Low mid', '120–500 Hz'],
  mid: ['Mid', '500 Hz–2 kHz'],
  high: ['High', '2–8 kHz'],
  air: ['Air', '> 8 kHz'],
};

/** Correlation per band on a −1…+1 axis: below 0 cancels in mono (red), a wide low end amber */
export function StereoBands({ m, was }: { m: Extract<Measurement, { kind: 'stereo' }>; was: Extract<Measurement, { kind: 'stereo' }> | null }) {
  const at = (c: number) => pct(c, -1, 1);
  return (
    <>
      <div className={chartStyles.evRows}>
        {m.bands.map(([band, c, worst, neg, side]) => {
          const [label, range] = STEREO_BANDS[band] ?? [band, ''];
          const phase = c !== null && c < 0;
          const wide = !phase && band === 'low' && c !== null && c < 0.5; // the tool's own flag threshold (mixcheck.py)
          const w = was?.bands.find((b) => b[0] === band)?.[1] ?? null;
          return (
            <HoverTip key={band} className={cx(chartStyles.evRow, phase && styles.bad, wide && chartStyles.evHot)}
              tip={[
                `${label} · ${range}`,
                c === null ? 'Silent' : tipLine('Correlation', c, '', w ?? undefined, { digits: 2 }),
                ...(worst !== null ? [`Worst moment ${fmt(worst, 2)}`] : []),
                ...(neg !== null ? [`Out of phase ${Math.round(neg * 100)}% of the time`] : []),
                ...(side !== null ? [`Side ${fmt(side)} dB against mid`] : []),
              ]}>
              <span className={chartStyles.evName}>{label}<small>{range}</small></span>
              <span className={cx(chartStyles.evVal, styles.val, 'mono')}>
                <b>{c === null ? 'silent' : fmt(c, 2)}</b>
                {phase && <span className={styles.wordBad}> · phase</span>}
                {wide && <span className={chartStyles.evWord}> · wide</span>}
              </span>
              <span className={chartStyles.evBar}>
                <span className={chartStyles.evZero} style={{ left: '50%' }} />
                {c !== null && <span className={cx(chartStyles.evFill, styles.fill)} style={{ left: `${Math.min(50, at(c))}%`, width: `${Math.abs(at(c) - 50)}%` }} />}
                {worst !== null && c !== null && worst < c && <span className={chartStyles.evTick} style={{ left: `${at(worst)}%` }} />}
                {w !== null && <span className={chartStyles.evWas} style={{ left: `${Math.min(99, Math.max(1, at(w)))}%` }} />}
              </span>
            </HoverTip>
          );
        })}
      </div>
      <div className={chartStyles.measureScaleWords}>
        <span>−1 phase</span>
        <span>0 wide</span>
        <span>+1 mono</span>
      </div>
      <div className={chartStyles.measureLegend}>
        <span><i className={chartStyles.lgRange} /> Correlation</span>
        <span><i className={chartStyles.lgTick} /> Worst moment</span>
        {was && <span><i className={chartStyles.lgWas} /> Previous call</span>}
      </div>
      {m.flags.length > 0 && (
        <div className={chartStyles.offHints}>
          {m.flags.map((f) => <span key={f} className={chartStyles.evWord}>{f}</span>)}
        </div>
      )}
    </>
  );
}
