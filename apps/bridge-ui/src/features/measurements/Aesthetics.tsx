import { PreviousLegend } from './Measurement.js';
import { fmt, pct } from './format.js';
import type { Measurement } from '../../lib/commands.js';

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
      <div className="ev-rows">
        {AESTHETICS.map(([k, label, hint]) => {
          const v = m[k] as number | undefined;
          const w = was?.[k] as number | undefined;
          return (
            <div key={k} className="ev-row" title={hint}>
              <span className="ev-name">{label}</span>
              <span className="ev-val mono">
                <b>{v === undefined ? '–' : v.toFixed(1)}</b> / 10
                {w !== undefined && v !== undefined && Math.abs(v - w) >= 0.05 && <span> · {v > w ? '+' : '−'}{Math.abs(v - w).toFixed(1)}</span>}
              </span>
              <span className="ev-bar">
                <span className="ev-fill" style={{ left: 0, width: `${v === undefined ? 0 : pct(v, 0, 10)}%` }} />
                {w !== undefined && <span className="ev-was" style={{ left: `${pct(w, 0, 10)}%` }} />}
              </span>
            </div>
          );
        })}
      </div>
      {was && <PreviousLegend />}
      <div className="off-hints">
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
