import type { EditView } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { noteName, pct } from './format.js';
import { Readout } from '../../measurements/Readout.js';

export function MidiStats({ v }: { v: Extract<EditView, { kind: "midiStats" }> }) {
  const guns = v.pitches.filter((p) => p[5] > 0).length;
  const histMax = Math.max(1, ...(v.hist ?? []));
  return (
    <>
      <div className="measure-readouts">
        <Readout
          label="Notes"
          value={String(v.total ?? v.pitches.reduce((s, p) => s + p[1], 0))}
        />
        <Readout label="Pitches" value={String(v.pitches.length)} />
        <Readout
          label="Machine gun"
          value={guns ? `${guns} ${guns === 1 ? "pitch" : "pitches"}` : "none"}
          zone={guns ? "hot" : "ok"}
          word={guns ? "" : undefined}
        />
      </div>
      <div className="ev-rows">
        {v.pitches.map(([pitch, count, min, max, avg, gun]) => (
          <div key={pitch} className={`ev-row ${gun ? "ev-hot" : ""}`}>
            <span className="ev-name">
              {noteName(pitch)}
              <small>{pitch}</small>
            </span>
            <span className="ev-val mono">
              ×{count} · {min === max ? min : `${min}–${max}`}
              {gun > 0 && (
                <span
                  className="ev-word"
                  title={`${gun} notes in a row at one velocity`}
                >
                  {" "}
                  · {gun} in a row
                </span>
              )}
            </span>
            <span
              className="ev-bar"
              role="img"
              aria-label={`${noteName(pitch)} velocity ${min} to ${max}, average ${Math.round(avg)}`}
            >
              <span
                className="ev-fill ev-fill-range"
                style={{
                  left: `${pct(min, 1, 127)}%`,
                  width: `max(3px, ${pct(max, 1, 127) - pct(min, 1, 127)}%)`,
                }}
              />
              <span
                className="ev-tick"
                style={{ left: `${pct(avg, 1, 127)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      <div className="measure-scale-words mono">
        <span>vel 1</span>
        <span>64</span>
        <span>127</span>
      </div>
      {v.hist && v.hist.length > 1 && (
        <div
          className="ev-hist"
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
          ["lg-range", "Velocity range"],
          ["lg-tick", "Average"],
        ]}
      />
    </>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────
