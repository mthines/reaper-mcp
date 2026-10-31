import type { EditView } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { noteName, pct } from './format.js';
import { Measurement } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './MidiStats.module.css';

export function MidiStats({ v }: { v: Extract<EditView, { kind: "midiStats" }> }) {
  const guns = v.pitches.filter((p) => p[5] > 0).length;
  const histMax = Math.max(1, ...(v.hist ?? []));
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout
          label="Notes"
          value={String(v.total ?? v.pitches.reduce((s, p) => s + p[1], 0))}
        />
        <Measurement.Readout label="Pitches" value={String(v.pitches.length)} />
        <Measurement.Readout
          label="Machine gun"
          value={guns ? `${guns} ${guns === 1 ? "pitch" : "pitches"}` : "none"}
          zone={guns ? "hot" : "ok"}
          word={guns ? "" : undefined}
        />
      </div>
      <div className={chartStyles.evRows}>
        {v.pitches.map(([pitch, count, min, max, avg, gun]) => (
          <div key={pitch} className={cx(chartStyles.evRow, gun ? chartStyles.evHot : '')}>
            <span className={chartStyles.evName}>
              {noteName(pitch)}
              <small>{pitch}</small>
            </span>
            <span className={cx(chartStyles.evVal, 'mono')}>
              ×{count} · {min === max ? min : `${min}–${max}`}
              {gun > 0 && (
                <span
                  className={chartStyles.evWord}
                  title={`${gun} notes in a row at one velocity`}
                >
                  {" "}
                  · {gun} in a row
                </span>
              )}
            </span>
            <span
              className={chartStyles.evBar}
              role="img"
              aria-label={`${noteName(pitch)} velocity ${min} to ${max}, average ${Math.round(avg)}`}
            >
              <span
                className={chartStyles.evFill}
                style={{
                  left: `${pct(min, 1, 127)}%`,
                  width: `max(3px, ${pct(max, 1, 127) - pct(min, 1, 127)}%)`,
                }}
              />
              <span
                className={chartStyles.evTick}
                style={{ left: `${pct(avg, 1, 127)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      <div className={cx(chartStyles.measureScaleWords, 'mono')}>
        <span>vel 1</span>
        <span>64</span>
        <span>127</span>
      </div>
      {v.hist && v.hist.length > 1 && (
        <div
          className={styles.evHist}
          role="img"
          aria-label="Velocity histogram, 1 to 127"
        >
          {v.hist.map((c, i) => (
            <span
              key={i}
              style={{ height: `${(c / histMax) * 100}%` }}
              title={`${i * 10}–${Math.min(127, i * 10 + 9)}: ${c}`}
            />
          ))}
        </div>
      )}
      <Legend
        items={[
          [chartStyles.lgRange, "Velocity range"],
          [chartStyles.lgTick, "Average"],
        ]}
      />
    </>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────
