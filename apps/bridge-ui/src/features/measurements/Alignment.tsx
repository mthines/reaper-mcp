import { Readout } from './Readout.js';
import { fmt, pct } from './format.js';
import type { Measurement } from '../../lib/commands.js';

/** How far a track sits behind (or ahead of) its reference, on a ms axis with the reference at 0 */
export function Alignment({ m }: { m: Extract<Measurement, { kind: 'alignment' }> }) {
  const d = m.delayMs ?? 0;
  const span = Math.max(1, Math.ceil(Math.abs(d) * 1.5));
  const at = (ms: number) => pct(ms, -span, span);
  const unsure = m.warn === 1;
  return (
    <>
      <div className="measure-readouts">
        <Readout label="Delay" value={m.delayMs === undefined ? '–' : `${d > 0 ? '+' : ''}${d.toFixed(2)}`} unit="ms" title={m.samples !== undefined ? `${m.samples} samples` : undefined} />
        <Readout label="Polarity" value={m.inv ? 'inverted' : 'normal'} zone={m.inv ? 'hot' : 'ok'} word="" />
        <Readout label="Correlation" value={m.corr === undefined ? '–' : m.corr.toFixed(2)} zone={unsure ? 'hot' : 'ok'} word="" />
      </div>
      <div className="off-align" role="img" aria-label={`${m.name ?? 'Track'} ${Math.abs(d).toFixed(2)} ms ${d >= 0 ? 'after' : 'before'} ${m.ref ?? 'the reference'}`}>
        <span className="off-align-ref" style={{ left: `${at(0)}%` }}><b>{m.ref ?? 'Reference'}</b></span>
        {m.delayMs !== undefined && (
          <>
            <span className="ev-fill" style={{ left: `${Math.min(at(0), at(d))}%`, width: `${Math.abs(at(d) - at(0))}%` }} />
            <span className={`off-align-trk ${m.inv ? 'off-inv' : ''}`} style={{ left: `${at(d)}%` }}><b>{m.name ?? 'Track'}</b></span>
          </>
        )}
      </div>
      <div className="measure-scale-words mono">
        <span>−{span} ms (earlier)</span>
        <span>0</span>
        <span>+{span} ms (later)</span>
      </div>
      {unsure ? (
        <div className="off-hints"><span className="ev-word">Too little in common in this range to trust the delay; no fix suggested.</span></div>
      ) : (
        m.offset !== undefined && (
          <div className="off-hints">
            <span>
              Fix <span className="mono">playOffsetMs {fmt(m.offset, 2)}{m.phase !== undefined ? ` · phase ${m.phase ? 'inverted' : 'normal'}` : ''}</span>
              {m.cur !== undefined && m.cur !== 0 && <span className="mono"> (now {fmt(m.cur, 2)})</span>}
            </span>
          </div>
        )
      )}
    </>
  );
}
