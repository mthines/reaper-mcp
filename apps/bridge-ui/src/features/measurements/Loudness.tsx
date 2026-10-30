import { Readout, Scale } from './Readout.js';
import { fmt, pct, tpWord, tpZone } from './format.js';
import type { Measurement } from '../../lib/commands.js';

export const lufsPct = (v: number) => pct(v, -40, 0);

/** One big integrated number, then where the three readings sit, against the agent's target when it gave one */
export function Loudness({ m, target, was }: { m: Extract<Measurement, { kind: 'lufs' }>; target: number | null; was?: number }) {
  const i = m.integrated;
  const delta = target === null || i === undefined || i <= -149 ? null : i - target;
  return (
    <>
      <div className="lufs-big">
        <b className="mono">{fmt(i)}</b>
        <small>LUFS integrated</small>
        {delta !== null && target !== null && (
          <span className={`lufs-delta mono ${Math.abs(delta) <= 1 ? 'lufs-on' : delta > 0 ? 'lufs-over' : ''}`}>{Math.abs(delta) < 0.05 ? `on ${fmt(target, 0)}` : `${Math.abs(delta).toFixed(1)} ${delta > 0 ? 'over' : 'under'} ${fmt(target, 0)}`}</span>
        )}
      </div>
      <div className="lufs-track" role="img" aria-label={`Integrated ${fmt(i)} LUFS, short-term ${fmt(m.shortTerm)}, momentary ${fmt(m.momentary)}${target !== null ? `, target ${fmt(target, 0)}` : ''}`}>
        {target !== null && (
          <span className="lufs-target" style={{ left: `${lufsPct(target - 1)}%`, width: `${lufsPct(target + 1) - lufsPct(target - 1)}%` }}>
            <span className="lufs-target-label mono">target {fmt(target, 0)}</span>
          </span>
        )}
        {m.shortTerm !== undefined && <span className="lufs-short" style={{ width: `${lufsPct(m.shortTerm)}%` }} />}
        {m.momentary !== undefined && <span className="lufs-momentary" style={{ left: `${lufsPct(m.momentary)}%` }} />}
        {was !== undefined && was > -149 && <span className="lufs-was" style={{ left: `${lufsPct(was)}%` }} title={`Previous call ${fmt(was)} LUFS`} />}
        {i !== undefined && <span className="lufs-needle" style={{ left: `${lufsPct(i)}%` }} />}
      </div>
      <Scale ticks={[-40, -30, -20, -10, 0]} min={-40} max={0} />
      <div className="measure-legend">
        <span><i className="lg-needle" /> Integrated</span>
        <span><i className="lg-short" /> Short-term</span>
        <span><i className="lg-momentary" /> Momentary</span>
        {target !== null && <span><i className="lg-target" /> Target ±1</span>}
        {was !== undefined && was > -149 && <span><i className="lg-previous" /> Previous call</span>}
      </div>
      <div className="measure-readouts">
        <Readout label="Short-term" value={fmt(m.shortTerm)} unit="LUFS" />
        <Readout label="Momentary" value={fmt(m.momentary)} unit="LUFS" />
        {m.duration !== undefined && <Readout label="Measured" value={m.duration.toFixed(1)} unit="s" />}
        <Readout label="True peak L" value={fmt(m.truePeakL)} unit="dBTP" zone={tpZone(m.truePeakL)} word={tpWord(m.truePeakL)} />
        <Readout label="True peak R" value={fmt(m.truePeakR)} unit="dBTP" zone={tpZone(m.truePeakR)} word={tpWord(m.truePeakR)} />
      </div>
    </>
  );
}
