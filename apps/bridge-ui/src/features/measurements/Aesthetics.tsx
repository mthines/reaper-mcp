import { fmt, pct } from './format.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';

const AESTHETICS: Array<[keyof Extract<Measurement, { kind: 'aesthetics' }>, string, string]> = [
  ['pq', 'Production quality', 'How clean and well produced it sounds'],
  ['pc', 'Production complexity', 'How much is going on'],
  ['ce', 'Content enjoyment', 'How enjoyable it is'],
  ['cu', 'Content usefulness', 'How usable it is as material'],
];

/** The four Audiobox Aesthetics scores on 0–10, the previous call ghosted */
export function Aesthetics({ m, was }: { m: Extract<Measurement, { kind: 'aesthetics' }>; was: Extract<Measurement, { kind: 'aesthetics' }> | null }) {
  return (
    <>
      <div className={chartStyles.evRows}>
        {AESTHETICS.map(([k, label, hint]) => {
          const v = m[k] as number | undefined;
          const w = was?.[k] as number | undefined;
          return (
            <div key={k} className={chartStyles.evRow} title={hint}>
              <span className={chartStyles.evName}>{label}</span>
              <span className={cx(chartStyles.evVal, 'mono')}>
                <b>{v === undefined ? '–' : v.toFixed(1)}</b> / 10
                {w !== undefined && v !== undefined && Math.abs(v - w) >= 0.05 && <span> {v > w ? '▲' : '▼'} {Math.abs(v - w).toFixed(1)}</span>}
              </span>
              <span className={chartStyles.evBar}>
                <span className={chartStyles.evFill} style={{ left: 0, width: `${v === undefined ? 0 : pct(v, 0, 10)}%` }} />
                {w !== undefined && <span className={chartStyles.evWas} style={{ left: `${pct(w, 0, 10)}%` }} />}
              </span>
            </div>
          );
        })}
      </div>
      {was && (
        <div className={chartStyles.measureLegend}>
          <span><i className={chartStyles.lgRange} /> This call</span>
          <span><i className={chartStyles.lgWas} /> Previous call</span>
        </div>
      )}
      <div className={chartStyles.offHints}>
        <span>
          {m.name ?? 'Clip'}
          {m.dur !== undefined ? `, ${Math.round(m.dur)} s` : ''}
          {m.lufs !== undefined ? `, scored at ${fmt(m.lufs, 0)} LUFS` : ', scored as rendered'}
          .{m.dur !== undefined && ` Differences under ~${m.dur >= 30 ? '0.1' : '0.4'} are render noise at this length.`}
        </span>
      </div>
    </>
  );
}
