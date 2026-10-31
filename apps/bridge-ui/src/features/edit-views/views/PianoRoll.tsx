import { useState, type CSSProperties, type PointerEvent } from 'react';
import type { EditView, Note } from '../edit-views.js';
import { Counts } from './Counts.js';
import { Legend } from './ChangeLegend.js';
import { EH, EW } from './Envelope.js';
import { noteName, pct, plural } from './format.js';
import { Measurement } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import envelopeStyles from './Envelope.module.css';
import styles from './PianoRoll.module.css';

export const dot = (x: number, y: number): CSSProperties => ({
  left: `${(x / EW) * 100}%`,
  top: `${(y / EH) * 100}%`,
});

// ── MIDI ─────────────────────────────────────────────────────────────────────

const RH = 120;
const LANE = 28;

export function PianoRoll({ v }: { v: Extract<EditView, { kind: "midi" }> }) {
  const [hover, setHover] = useState<Note | null>(null);
  const gone = v.gone ?? [];
  const all = [...v.notes, ...gone];
  const beats = v.beats ?? Math.max(4, ...all.map((n) => n[1] + n[2]));
  const pitches = all.map((n) => n[0]);
  const mid = pitches.length
    ? (Math.min(...pitches) + Math.max(...pitches)) / 2
    : 60;
  // At least an octave, so a single note doesn't fill the roll
  const lo = Math.floor(Math.min(mid - 6, ...pitches) - 1);
  const hi = Math.ceil(Math.max(mid + 6, ...pitches) + 1);
  const rows = hi - lo + 1;
  const x = (b: number) => (b / beats) * EW;
  const y = (p: number) => ((hi - p) / rows) * RH;
  const barBeats = v.ts ? (v.ts[0] * 4) / v.ts[1] : 4;
  const changed = v.notes.filter((n) => n[4]).length;
  const onMove = (ev: PointerEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const b = ((ev.clientX - r.left) / r.width) * beats;
    const p = hi - Math.floor(((ev.clientY - r.top) / r.height) * rows);
    setHover(
      v.notes.find((n) => n[0] === p && b >= n[1] && b <= n[1] + n[2]) ?? null,
    );
  };
  const cs = (p: number) =>
    Array.from({ length: rows }, (_, i) => hi - i).filter((q) => q % 12 === p);
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Notes" value={String(v.total)} />
        <Measurement.Readout
          label="Length"
          value={(v.beats ?? beats).toFixed(beats % 1 ? 2 : 0)}
          unit="beats"
        />
        {v.gone ? (
          <Counts added={changed} removed={gone.length} />
        ) : (
          <Measurement.Readout
            label="Range"
            value={
              pitches.length
                ? `${noteName(Math.min(...pitches))}–${noteName(Math.max(...pitches))}`
                : "–"
            }
          />
        )}
      </div>
      <div className={cx(styles.evRoll, envelopeStyles.evGutter)}>
        {cs(0).map((p) => (
          <span
            key={p}
            className={cx(envelopeStyles.evY, 'mono')}
            style={{ top: `${((y(p) + RH / rows / 2) / RH) * 100}%` }}
          >
            {noteName(p)}
          </span>
        ))}
        <div
          className={envelopeStyles.evPlot}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox={`0 0 ${EW} ${RH}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Piano roll, ${plural(v.total, "note")} over ${beats} beats`}
          >
            {Array.from({ length: rows }, (_, i) => hi - i)
              .filter((p) => [1, 3, 6, 8, 10].includes(p % 12))
              .map((p) => (
                <rect
                  key={p}
                  className={styles.evRollBlack}
                  x={0}
                  y={y(p)}
                  width={EW}
                  height={RH / rows}
                />
              ))}
            {Array.from({ length: Math.floor(beats) + 1 }, (_, b) => (
              <line
                key={b}
                className={b % barBeats === 0 ? chartStyles.spectrumBase : chartStyles.spectrumGrid}
                x1={x(b)}
                x2={x(b)}
                y1={0}
                y2={RH}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {gone.map((n, i) => (
              <rect
                key={`g${i}`}
                className={styles.evNoteGone}
                x={x(n[1])}
                y={y(n[0]) + 0.5}
                width={Math.max(1, x(n[1] + n[2]) - x(n[1]) - 0.5)}
                height={RH / rows - 1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {v.notes.map((n, i) => (
              <rect
                key={i}
                className={n[4] ? styles.evNoteNew : styles.evNote}
                x={x(n[1])}
                y={y(n[0]) + 0.5}
                width={Math.max(1, x(n[1] + n[2]) - x(n[1]) - 0.5)}
                height={RH / rows - 1}
                style={{ opacity: 0.35 + (n[3] / 127) * 0.65 }}
              />
            ))}
          </svg>
          {hover && (
            <div
              className={cx(chartStyles.spectrumTip, 'mono')}
              style={{
                left: `${Math.min(80, Math.max(20, (x(hover[1]) / EW) * 100))}%`,
              }}
            >
              {noteName(hover[0])} · beat {+(hover[1] + 1).toFixed(2)} ·{" "}
              {+hover[2].toFixed(2)} long · vel {hover[3]}
            </div>
          )}
        </div>
      </div>
      <div className={envelopeStyles.evGutter}>
        <svg
          className={styles.evVel}
          viewBox={`0 0 ${EW} ${LANE}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Velocities"
        >
          <line
            className={chartStyles.spectrumBase}
            x1={0}
            x2={EW}
            y1={LANE}
            y2={LANE}
            vectorEffect="non-scaling-stroke"
          />
          {v.notes.map((n, i) => (
            <line
              key={i}
              className={n[4] ? styles.evVelNew : styles.evVelOld}
              x1={x(n[1]) + 1}
              x2={x(n[1]) + 1}
              y1={LANE - (n[3] / 127) * LANE}
              y2={LANE}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className={cx(styles.evBars, envelopeStyles.evGutter, 'mono')}>
        {Array.from({ length: Math.ceil(beats / barBeats) }, (_, i) => (
          <span key={i} style={{ left: `${pct(i * barBeats, 0, beats)}%` }}>
            {i + 1}
          </span>
        ))}
      </div>
      {v.more > 0 && (
        <div className={chartStyles.evMore}>
          +{v.more} more {v.more === 1 ? "note" : "notes"} not drawn
        </div>
      )}
      {v.items && <div className={chartStyles.evMore}>+{plural(v.items, "more imported item")} not drawn</div>}
      {v.gone && (
        <Legend
          items={[
            [chartStyles.lgNoteNew, "Added or changed"],
            [chartStyles.lgNote, "Unchanged"],
            [chartStyles.lgNoteGone, "Removed"],
          ]}
        />
      )}
    </>
  );
}
