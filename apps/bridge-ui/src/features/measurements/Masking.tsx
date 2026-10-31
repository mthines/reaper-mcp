import { hzLabel } from './format.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './Masking.module.css';

/** Pairs × third-octave bands: the darker a cell, the more the two tracks fight there; the conflicts in words */
export function Masking({ m }: { m: Extract<Measurement, { kind: 'masking' }> }) {
  const marks = m.hz.map((hz, i) => ({ hz, i })).filter(({ hz }) => [63, 250, 1000, 4000, 16000].includes(hz));
  return (
    <>
      {m.pairs.length > 0 && (
        <div className={styles.mask} role="img" aria-label={`Masking between ${m.tracks.length} tracks across ${m.hz.length} bands`}>
          {m.pairs.map(([a, b, overall, scores]) => (
            <div key={`${a}|${b}`} className={styles.row}>
              <span className={styles.name} title={`${a} × ${b}: overall ${overall.toFixed(2)}`}>{a} × {b}</span>
              <span className={styles.cells} style={{ gridTemplateColumns: `repeat(${scores.length}, 1fr)` }}>
                {scores.map((s, k) => (
                  <span key={k} className={s >= 0.6 ? styles.hot : undefined} style={{ opacity: s <= 0 ? 0.06 : 0.15 + 0.85 * Math.min(1, s) }}
                    title={`${a} × ${b} at ${hzLabel(m.hz[k])} Hz: ${s.toFixed(2)}`} />
                ))}
              </span>
              <span className={cx(styles.score, 'mono')}>{overall.toFixed(2)}</span>
            </div>
          ))}
          <div className={cx(styles.row, styles.axis)}>
            <span className={styles.name} />
            <span className={styles.marks}>
              {marks.map(({ hz, i }) => (i === m.hz.length - 1
                ? <span key={hz} className={styles.markEnd}>{hzLabel(hz)}</span>
                : <span key={hz} style={{ left: `${((i + 0.5) / m.hz.length) * 100}%` }}>{hzLabel(hz)}</span>))}
            </span>
            <span className={styles.score} />
          </div>
        </div>
      )}
      <div className={chartStyles.offHints}>
        {m.conflicts.length === 0 ? (
          <span>No band where two of these tracks are both loud and within a few dB: nothing masks.</span>
        ) : (
          m.conflicts.map(([a, b, hz, score, suggestion]) => (
            <span key={`${a}|${b}|${hz}`}>
              <span className="mono">{a} × {b} · {hz === null ? '–' : `${hzLabel(hz)} Hz`} · {score?.toFixed(2) ?? '–'}</span>
              {suggestion && <> — {suggestion}</>}
            </span>
          ))
        )}
      </div>
    </>
  );
}
