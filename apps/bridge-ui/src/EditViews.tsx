import {
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Readout, fmt } from "./Measurement.js";
import {
  editViewOf,
  newPoints,
  timelineDiff,
  type ChangeRow,
  type EditView,
  type EnvPoint,
  type Marker,
  type MixRow,
  type Note,
  type Region,
  type Tempo,
} from "./edit-views.js";
import type { CommandEntry } from "./status.js";

/**
 * What an edit changed, or what a listing showed, in the measurements' hairline language: the value now is the
 * accent, the value before is a hollow ghost (dashed for curves), and whatever this call added is drawn solid.
 */

const pct = (v: number, min: number, max: number) =>
  max === min ? 0 : Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const noteName = (p: number) =>
  `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const clock = (s: number, digits = 0) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(digits).padStart(digits ? digits + 3 : 2, "0")}`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A mark's own colour, else one of the page's six hues by position */
const hueOf = (hex: string, i: number) => hex || `var(--h${i % 6})`;

/** The drawer's card for an edit view; nothing for commands without one */
export function EditViewSection({ entry }: { entry: CommandEntry }) {
  const v = editViewOf(entry);
  if (!v) return null;
  const write = !LISTINGS.has(entry.c) && !(v.kind === "plan" && v.dryRun);
  return (
    <section className="measure" aria-label={write ? "Change" : "Result"}>
      <div className="measure-head">{write ? "Change" : "Result"}</div>
      <div className="measure-body">{render(v)}</div>
    </section>
  );
}

/** Listings show what is there; every other edit view is a write that shows before and after */
const LISTINGS = new Set([
  "get_envelope_points",
  "get_midi_notes",
  "analyze_midi",
  "list_markers",
  "list_regions",
  "get_tempo_map",
  "list_media_items",
  "list_tracks",
]);

function render(v: EditView): ReactNode {
  switch (v.kind) {
    case "changes":
      return <Changes rows={v.rows} />;
    case "envelope":
      return <Envelope v={v} />;
    case "midi":
      return <PianoRoll v={v} />;
    case "midiStats":
      return <MidiStats v={v} />;
    case "timeline":
      return <Timeline v={v} />;
    case "mixer":
      return <Mixer v={v} />;
    case "plan":
      return <Plan v={v} />;
  }
}

const Legend = ({ items }: { items: Array<[string, string]> }) => (
  <div className="measure-legend">
    {items.map(([cls, label]) => (
      <span key={label}>
        <i className={cls} /> {label}
      </span>
    ))}
  </div>
);

// ── Parameter and mix changes ────────────────────────────────────────────────

const BOOL_WORDS: Record<string, [string, string]> = {
  mute: ["on", "muted"],
  solo: ["off", "soloed"],
  recordArm: ["off", "armed"],
  phase: ["normal", "inverted"],
};
const PROP_LABEL: Record<string, string> = {
  volume: "Volume",
  pan: "Pan",
  mute: "Mute",
  solo: "Solo",
  recordArm: "Record arm",
  phase: "Phase",
};
const panText = (v: number) =>
  Math.abs(v) < 0.005
    ? "C"
    : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "L" : "R"}`;

function valueText(
  r: ChangeRow,
  v: number | undefined,
  text: string | undefined,
): string {
  if (v === undefined) return "–";
  switch (r.s) {
    case "db":
      return `${fmt(v)} dB`;
    case "pan":
      return panText(v);
    case "bool":
      return (BOOL_WORDS[r.p] ?? ["off", "on"])[v ? 1 : 0];
    case "norm":
      return text || `${Math.round(v * 100)}%`;
  }
}

/** Where a value sits on its row's bar: volume on the meters' −60..+6 dB scale, pan −1..1, the rest 0..1 */
const barPos = (r: ChangeRow, v: number) =>
  r.s === "db" ? pct(v, -60, 6) : r.s === "pan" ? pct(v, -1, 1) : pct(v, 0, 1);

function Changes({ rows }: { rows: ChangeRow[] }) {
  return (
    <>
      <div className="ev-rows">
        {rows.map((r, i) => {
          const same = r.a !== undefined && r.a === r.b;
          const hot = r.s === "db" && (r.b ?? -150) > 0;
          const before = valueText(r, r.a, r.at);
          const after = valueText(r, r.b, r.bt);
          const label = PROP_LABEL[r.p] ?? r.p;
          return (
            <div
              key={i}
              className={`ev-row ${same ? "ev-same" : ""} ${hot ? "ev-hot" : ""}`}
            >
              <span className="ev-name">
                {r.t}
                <small>{label}</small>
              </span>
              <span className="ev-val mono">
                {same ? (
                  <>{after} · no change</>
                ) : r.a === undefined ? (
                  <b>{after}</b>
                ) : (
                  <>
                    {before} → <b>{after}</b>
                  </>
                )}
                {hot && <span className="ev-word"> · above 0</span>}
              </span>
              {r.s !== "bool" && r.b !== undefined && (
                <ChangeBar
                  r={r}
                  b={r.b}
                  label={`${r.t} ${label} from ${before} to ${after}`}
                />
              )}
            </div>
          );
        })}
      </div>
      {rows.some((r) => r.a !== undefined && r.a !== r.b) && (
        <Legend
          items={[
            ["lg-was", "Before"],
            ["lg-tick", "After"],
          ]}
        />
      )}
    </>
  );
}

function ChangeBar({
  r,
  b: after,
  label,
}: {
  r: ChangeRow;
  b: number;
  label: string;
}) {
  const b = barPos(r, after);
  const a = r.a === undefined ? null : barPos(r, r.a);
  const origin = r.s === "pan" ? 50 : 0;
  return (
    <span className="ev-bar" role="img" aria-label={label}>
      {r.s === "db" && (
        <span className="ev-zero" style={{ left: `${pct(0, -60, 6)}%` }} />
      )}
      {r.s === "pan" && <span className="ev-zero" style={{ left: "50%" }} />}
      <span
        className="ev-fill ev-fill-rest"
        style={{
          left: `${Math.min(origin, b)}%`,
          width: `${Math.abs(b - origin)}%`,
        }}
      />
      {a !== null && a !== b && (
        <span
          className={`ev-fill ${b < a ? "ev-fill-down" : ""}`}
          style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
        />
      )}
      {a !== null && a !== b && (
        <span className="ev-was" style={{ left: `${a}%` }} />
      )}
      <span className="ev-tick" style={{ left: `${b}%` }} />
    </span>
  );
}

// ── Automation ───────────────────────────────────────────────────────────────

const EW = 400;
const EH = 110;

/** Envelope path through REAPER's point shapes: 0 linear, 1 square, 2/5 slow start/end (bezier drawn as slow), 3 fast start, 4 fast end */
function curve(
  pts: EnvPoint[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M0,${y(pts[0][1])}H${EW}`;
  let d = `M${x(pts[0][0])},${y(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [t0, v0, s0] = pts[i - 1];
    const [t1, v1] = pts[i];
    const x0 = x(t0),
      x1 = x(t1),
      y0 = y(v0),
      y1 = y(v1);
    if (s0 === 1) d += `H${x1}V${y1}`;
    else if (s0 === 2 || s0 === 5)
      d += `C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`;
    else if (s0 === 3) d += `Q${x0},${y1} ${x1},${y1}`;
    else if (s0 === 4) d += `Q${x1},${y0} ${x1},${y1}`;
    else d += `L${x1},${y1}`;
  }
  return d;
}

function envDomain(
  unit: Extract<EditView, { kind: "envelope" }>["unit"],
  vals: number[],
): { top: number; bottom: number; ticks: Array<[number, string]> } {
  if (unit === "pan")
    return {
      top: 1,
      bottom: -1,
      ticks: [
        [1, "+1"],
        [0, "C"],
        [-1, "−1"],
      ],
    };
  if (unit === "mute")
    return {
      top: 1.15,
      bottom: -0.15,
      ticks: [
        [1, "1"],
        [0, "0"],
      ],
    };
  if (unit === "dB") {
    const audible = vals.filter((v) => v > -149);
    const top = Math.max(6, Math.ceil(Math.max(0, ...audible) / 6) * 6);
    const bottom = Math.max(
      -60,
      Math.min(-24, Math.floor(Math.min(0, ...audible) / 6) * 6 - 6),
    );
    const ticks = [top, 0, -6, -12, -24, -48].filter(
      (d, i, all) => d <= top && d > bottom && all.indexOf(d) === i,
    );
    return { top, bottom, ticks: ticks.map((d) => [d, fmt(d, 0)]) };
  }
  const lo = Math.min(...vals),
    hi = Math.max(...vals);
  const pad = hi === lo ? 1 : (hi - lo) * 0.15;
  return {
    top: hi + pad,
    bottom: lo - pad,
    ticks: [
      [hi, hi.toFixed(2)],
      [lo, lo.toFixed(2)],
    ],
  };
}

const envValue = (unit: string, v: number) =>
  unit === "dB"
    ? `${fmt(v)} dB`
    : unit === "pan"
      ? Math.abs(v) < 0.005
        ? "C"
        : `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`
      : unit === "mute"
        ? String(v >= 0.5 ? 1 : 0)
        : v.toFixed(3);

function Envelope({ v }: { v: Extract<EditView, { kind: "envelope" }> }) {
  const [hover, setHover] = useState<EnvPoint | null>(null);
  const span = Math.max(0.001, v.to - v.from);
  const vals = [...v.pts, ...(v.was ?? [])].map((p) => p[1]);
  const { top, bottom, ticks } = envDomain(v.unit, vals.length ? vals : [0]);
  const x = (t: number) => ((t - v.from) / span) * EW;
  const y = (val: number) =>
    ((top - Math.min(top, Math.max(bottom, val))) / (top - bottom)) * EH;
  const added = newPoints(v.pts, v.was);
  const removed = v.was
    ? v.was.filter((p) => !v.pts.some((q) => q[0] === p[0] && q[1] === p[1]))
    : [];
  const line = curve(v.pts, x, y);
  const inView = (p: EnvPoint) => p[0] >= v.from && p[0] <= v.to;
  const onMove = (ev: PointerEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const t = v.from + ((ev.clientX - r.left) / r.width) * span;
    const near = v.pts
      .filter(inView)
      .reduce<EnvPoint | null>(
        (best, p) =>
          !best || Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best,
        null,
      );
    setHover(near);
  };
  return (
    <>
      <div className="measure-readouts">
        <Readout label="Envelope" value={v.env} />
        <Readout label="Points" value={String(v.count)} />
        {v.was && (
          <Readout
            label="Changed"
            value={`+${added.size} −${removed.length}`}
          />
        )}
      </div>
      <div className="ev-env ev-gutter">
        {ticks.map(([d, label]) => (
          <span
            key={d}
            className="ev-y mono"
            style={{ top: `${(y(d) / EH) * 100}%` }}
          >
            {label}
          </span>
        ))}
        <div
          className="ev-plot"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox={`0 0 ${EW} ${EH}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${v.env} automation from ${clock(v.from, 1)} to ${clock(v.to, 1)}`}
          >
            {ticks.map(([d]) => (
              <line
                key={d}
                className={d === 0 ? "spectrum-base" : "spectrum-grid"}
                x1={0}
                x2={EW}
                y1={y(d)}
                y2={y(d)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {v.was && (
              <path
                className="spectrum-previous"
                d={curve(v.was, x, y)}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {line && (
              <path
                className="ev-env-area"
                d={`${line}V${EH}H${v.pts.length === 1 ? 0 : x(v.pts[0][0])}Z`}
              />
            )}
            {line && (
              <path
                className="ev-env-line"
                d={line}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {removed.filter(inView).map((p, i) => (
            <span
              key={`r${i}`}
              className="ev-dot ev-dot-gone"
              style={dot(x(p[0]), y(p[1]))}
              title={`Removed: ${clock(p[0], 2)} · ${envValue(v.unit, p[1])}`}
            />
          ))}
          {v.pts.filter(inView).map((p, i) => (
            <span
              key={i}
              className={`ev-dot ${added.has(p) ? "ev-dot-new" : ""}`}
              style={dot(x(p[0]), y(p[1]))}
            />
          ))}
          {hover && (
            <div
              className="spectrum-tip mono"
              style={{
                left: `${Math.min(80, Math.max(20, (x(hover[0]) / EW) * 100))}%`,
              }}
            >
              {clock(hover[0], 2)} · {envValue(v.unit, hover[1])}
            </div>
          )}
        </div>
      </div>
      <div className="measure-scale-words mono ev-gutter">
        <span>{clock(v.from, 1)}</span>
        <span>{clock(v.to, 1)}</span>
      </div>
      {v.was && (
        <Legend
          items={[
            ["lg-line", "Now"],
            ["lg-previous", "Before"],
            ["lg-new", "Added or moved"],
          ]}
        />
      )}
    </>
  );
}

const dot = (x: number, y: number): CSSProperties => ({
  left: `${(x / EW) * 100}%`,
  top: `${(y / EH) * 100}%`,
});

// ── MIDI ─────────────────────────────────────────────────────────────────────

const RH = 120;
const LANE = 28;

function PianoRoll({ v }: { v: Extract<EditView, { kind: "midi" }> }) {
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
      <div className="measure-readouts">
        <Readout label="Notes" value={String(v.total)} />
        <Readout
          label="Length"
          value={(v.beats ?? beats).toFixed(beats % 1 ? 2 : 0)}
          unit="beats"
        />
        {v.gone ? (
          <Readout label="Changed" value={`+${changed} −${gone.length}`} />
        ) : (
          <Readout
            label="Range"
            value={
              pitches.length
                ? `${noteName(Math.min(...pitches))}–${noteName(Math.max(...pitches))}`
                : "–"
            }
          />
        )}
      </div>
      <div className="ev-roll ev-gutter">
        {cs(0).map((p) => (
          <span
            key={p}
            className="ev-y mono"
            style={{ top: `${((y(p) + RH / rows / 2) / RH) * 100}%` }}
          >
            {noteName(p)}
          </span>
        ))}
        <div
          className="ev-plot"
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
                  className="ev-roll-black"
                  x={0}
                  y={y(p)}
                  width={EW}
                  height={RH / rows}
                />
              ))}
            {Array.from({ length: Math.floor(beats) + 1 }, (_, b) => (
              <line
                key={b}
                className={
                  b % barBeats === 0 ? "spectrum-base" : "spectrum-grid"
                }
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
                className="ev-note-gone"
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
                className={n[4] ? "ev-note-new" : "ev-note"}
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
              className="spectrum-tip mono"
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
      <div className="ev-gutter">
        <svg
          className="ev-vel"
          viewBox={`0 0 ${EW} ${LANE}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Velocities"
        >
          <line
            className="spectrum-base"
            x1={0}
            x2={EW}
            y1={LANE}
            y2={LANE}
            vectorEffect="non-scaling-stroke"
          />
          {v.notes.map((n, i) => (
            <line
              key={i}
              className={n[4] ? "ev-vel-new" : "ev-vel-old"}
              x1={x(n[1]) + 1}
              x2={x(n[1]) + 1}
              y1={LANE - (n[3] / 127) * LANE}
              y2={LANE}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className="ev-bars mono ev-gutter">
        {Array.from({ length: Math.ceil(beats / barBeats) }, (_, i) => (
          <span key={i} style={{ left: `${pct(i * barBeats, 0, beats)}%` }}>
            {i + 1}
          </span>
        ))}
      </div>
      {v.more > 0 && (
        <div className="ev-more">
          +{v.more} more {v.more === 1 ? "note" : "notes"} not drawn
        </div>
      )}
      {v.gone && (
        <Legend
          items={[
            ["lg-note-new", "Added or changed"],
            ["lg-note", "Unchanged"],
            ["lg-note-gone", "Removed"],
          ]}
        />
      )}
    </>
  );
}

function MidiStats({ v }: { v: Extract<EditView, { kind: "midiStats" }> }) {
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
                <span className="ev-word">
                  {" "}
                  · {gun} in a row at one velocity
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

function Timeline({ v }: { v: Extract<EditView, { kind: "timeline" }> }) {
  const len = Math.max(1, v.len);
  const at = (t: number) => `${pct(t, 0, len)}%`;
  const regions = timelineDiff<Region>(v.regions, v.was?.regions);
  const markers = timelineDiff<Marker>(v.markers, v.was?.markers);
  const tempos = timelineDiff<Tempo>(v.tempo, v.was?.tempo);
  const bpms = [...v.tempo, ...tempos.removed].map((t) => t[1]);
  const varies = new Set(bpms).size > 1;
  const first = v.tempo[0];
  const sig = first && first[2] > 0 ? `${first[2]}/${first[3]}` : "–";
  const changed = regions.added.size + markers.added.size + tempos.added.size;
  const removed =
    regions.removed.length + markers.removed.length + tempos.removed.length;
  return (
    <>
      <div className="measure-readouts">
        <Readout
          label="Tempo"
          value={
            first
              ? varies
                ? `${Math.min(...bpms)}–${Math.max(...bpms)}`
                : String(first[1])
              : "–"
          }
          unit="BPM"
        />
        <Readout label="Time sig" value={sig} />
        {v.was ? (
          <Readout label="Changed" value={`+${changed} −${removed}`} />
        ) : (
          <Readout
            label="Marks"
            value={`${v.regions.length} / ${v.markers.length}`}
            unit="rgn / mkr"
          />
        )}
      </div>
      <div className="ev-timeline">
        {(v.markers.length > 0 || markers.removed.length > 0) && (
          <div className="ev-lane ev-lane-markers">
            {markers.removed.map((m) => (
              <span
                key={`r${m[3]}${m[0]}`}
                className="ev-marker ev-gone"
                style={{ left: at(m[0]) }}
                title={`Removed: ${m[1] || `Marker ${m[3]}`} at ${clock(m[0], 1)}`}
              >
                <i />
                <b>{m[1] || m[3]}</b>
              </span>
            ))}
            {v.markers.map((m) => (
              <span
                key={`${m[3]}${m[0]}`}
                className={`ev-marker ${markers.added.has(m) ? "ev-new" : ""}`}
                style={
                  {
                    left: at(m[0]),
                    ...(m[2] ? { "--mk": m[2] } : {}),
                  } as CSSProperties
                }
                title={`${m[1] || `Marker ${m[3]}`} at ${clock(m[0], 1)}`}
              >
                <i />
                <b>{m[1] || m[3]}</b>
              </span>
            ))}
          </div>
        )}
        <div className="ev-lane ev-lane-regions">
          {regions.removed.map((r) => (
            <span
              key={`r${r[4]}${r[0]}`}
              className="ev-region ev-gone"
              style={{
                left: at(r[0]),
                width: `calc(${pct(r[1], 0, len) - pct(r[0], 0, len)}% - 1px)`,
              }}
              title={`Removed: ${r[2] || `Region ${r[4]}`}`}
            />
          ))}
          {v.regions.map((r, i) => (
            <span
              key={`${r[4]}${r[0]}`}
              className={`ev-region ${regions.added.has(r) ? "ev-new" : ""}`}
              style={
                {
                  left: at(r[0]),
                  width: `calc(${pct(r[1], 0, len) - pct(r[0], 0, len)}% - 1px)`,
                  "--rg": hueOf(r[3], i),
                } as CSSProperties
              }
              title={`${r[2] || `Region ${r[4]}`} · ${clock(r[0], 1)}–${clock(r[1], 1)}`}
            >
              {r[2]}
            </span>
          ))}
        </div>
        {v.items && (
          <div className="ev-lane ev-lane-items">
            {v.items.map((it, i) => (
              <span
                key={i}
                className={`ev-item ${it[4] ? "ev-item-midi" : ""} ${it[5] ? "ev-item-muted" : ""}`}
                style={{
                  left: at(it[0]),
                  width: `calc(${pct(it[0] + it[1], 0, len) - pct(it[0], 0, len)}% - 1px)`,
                }}
                title={`${it[4] ? "MIDI" : "Audio"} item · ${clock(it[0], 1)}–${clock(it[0] + it[1], 1)}${it[5] ? " · muted" : ""}`}
              >
                {it[2] > 0 && (
                  <i
                    className="ev-fade-in"
                    style={{ width: `${(it[2] / it[1]) * 100}%` }}
                  />
                )}
                {it[3] > 0 && (
                  <i
                    className="ev-fade-out"
                    style={{ width: `${(it[3] / it[1]) * 100}%` }}
                  />
                )}
              </span>
            ))}
          </div>
        )}
        {(varies || tempos.added.size > 0 || tempos.removed.length > 0) && (
          <TempoLane
            tempo={v.tempo}
            removed={tempos.removed}
            added={tempos.added}
            len={len}
          />
        )}
      </div>
      <div className="measure-scale-words mono">
        <span>0:00</span>
        <span>{clock(len / 2)}</span>
        <span>{clock(len)}</span>
      </div>
      {v.was && (changed > 0 || removed > 0) && (
        <Legend
          items={[
            ["lg-new-mark", "Added or changed"],
            ["lg-gone-mark", "Removed"],
          ]}
        />
      )}
    </>
  );
}

const TH = 40;

function TempoLane({
  tempo,
  removed,
  added,
  len,
}: {
  tempo: Tempo[];
  removed: Tempo[];
  added: Set<Tempo>;
  len: number;
}) {
  const bpms = [...tempo, ...removed].map((t) => t[1]);
  const top = Math.max(...bpms) + 2;
  const bottom = Math.min(...bpms) - 2;
  const x = (t: number) => (t / len) * EW;
  const y = (bpm: number) => ((top - bpm) / (top - bottom)) * TH;
  const path = (ts: Tempo[]) => {
    const sorted = [...ts].sort((a, b) => a[0] - b[0]);
    if (!sorted.length) return "";
    let d = `M0,${y(sorted[0][1])}`;
    sorted.forEach((t, i) => {
      // A linear marker ramps to the next one; otherwise the tempo steps
      d +=
        i === 0
          ? `H${x(t[0])}`
          : sorted[i - 1][4]
            ? `L${x(t[0])},${y(t[1])}`
            : `H${x(t[0])}V${y(t[1])}`;
    });
    return `${d}H${EW}`;
  };
  return (
    <div className="ev-tempo">
      <span className="ev-tempo-label mono">tempo</span>
      <svg
        viewBox={`0 0 ${EW} ${TH}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Tempo from ${Math.min(...bpms)} to ${Math.max(...bpms)} BPM`}
      >
        {removed.length > 0 && (
          <path
            className="spectrum-previous"
            d={path([...tempo.filter((t) => !added.has(t)), ...removed])}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          className="ev-env-line"
          d={path(tempo)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {tempo.map((t, i) => (
        <span
          key={i}
          className={`ev-dot ${added.has(t) ? "ev-dot-new" : ""}`}
          style={{
            left: `${(x(t[0]) / EW) * 100}%`,
            top: `${(y(t[1]) / TH) * 100}%`,
          }}
          title={`${t[1]} BPM${t[2] > 0 ? ` · ${t[2]}/${t[3]}` : ""} at ${clock(t[0], 1)}`}
        />
      ))}
    </div>
  );
}

// ── Mixer ────────────────────────────────────────────────────────────────────

function MixerRow({ row, master }: { row: MixRow; master?: boolean }) {
  const [name, depth, color, db, pan, flags] = row;
  const hot = db > 0;
  const folder = flags.includes("F");
  return (
    <div
      className={`ev-trk ${master ? "ev-trk-master" : ""} ${flags.includes("M") ? "ev-trk-muted" : ""}`}
    >
      <span
        className="ev-sw"
        style={{
          background: master ? "var(--line-2)" : color || "var(--line-2)",
        }}
      />
      <span
        className={`ev-tn ${folder ? "ev-tn-folder" : ""}`}
        style={{ paddingLeft: `${Math.min(depth, 4) * 12}px` }}
        title={name}
      >
        {folder ? "▾ " : ""}
        {name}
      </span>
      <span
        className="ev-bar ev-fader"
        role="img"
        aria-label={`${name} ${fmt(db)} dB`}
      >
        <span className="ev-zero" style={{ left: `${pct(0, -60, 6)}%` }} />
        <span
          className={`ev-fill ${hot ? "ev-fill-hot" : ""}`}
          style={{ left: 0, width: `${pct(db, -60, 6)}%` }}
        />
      </span>
      <span className={`ev-tv mono zone-${hot ? "hot" : "ok"}`}>{fmt(db)}</span>
      <span
        className="ev-pan"
        role="img"
        aria-label={`pan ${panText(pan)}`}
        title={`Pan ${panText(pan)}`}
      >
        <span className="ev-pan-c" />
        <span className="ev-pan-d" style={{ left: `${pct(pan, -1, 1)}%` }} />
      </span>
      <span
        className="ev-chips"
        aria-label={
          [
            flags.includes("M") && "muted",
            flags.includes("S") && "soloed",
            flags.includes("R") && "armed",
          ]
            .filter(Boolean)
            .join(", ") || undefined
        }
      >
        {(["M", "S", "R"] as const).map((f) => (
          <span
            key={f}
            className={`ev-chip ${flags.includes(f) ? `ev-chip-${f.toLowerCase()}` : ""}`}
          >
            {f}
          </span>
        ))}
      </span>
    </div>
  );
}

function Mixer({ v }: { v: Extract<EditView, { kind: "mixer" }> }) {
  return (
    <>
      <div className="ev-mix">
        {v.tracks.map((t, i) => (
          <MixerRow key={i} row={t} />
        ))}
        {v.master && <MixerRow row={v.master} master />}
      </div>
      {v.total > v.tracks.length && (
        <div className="ev-more">
          +{v.total - v.tracks.length} more tracks not drawn
        </div>
      )}
    </>
  );
}

// ── Plan ─────────────────────────────────────────────────────────────────────

function Plan({ v }: { v: Extract<EditView, { kind: "plan" }> }) {
  return (
    <>
      <div className="measure-readouts">
        <Readout label="Ops" value={String(v.total)} />
        <Readout label="Mode" value={v.dryRun ? "Dry run" : "Applied"} />
      </div>
      <ol className="ev-plan">
        {v.ops.map(([op, what], i) => (
          <li key={i}>
            <span className="ev-op-n mono">{i + 1}</span>
            <span className="ev-op mono">{op}</span>
            <span className="ev-op-what" title={what}>
              {what}
            </span>
          </li>
        ))}
      </ol>
      {v.total > v.ops.length && (
        <div className="ev-more">
          +{v.total - v.ops.length} more ops not listed
        </div>
      )}
      {v.dryRun && (
        <div className="ev-more">A dry run: checked, nothing written.</div>
      )}
    </>
  );
}
