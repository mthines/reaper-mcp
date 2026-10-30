import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Readout, fmt } from "./Measurement.js";
import {
  editViewOf,
  fittingLabels,
  listDiff,
  newPoints,
  routeIds,
  timelineDiff,
  type AutoItem,
  type ChangeRow,
  type EditView,
  type EnvPoint,
  type FxChain,
  type FxSlot,
  type Item,
  type Route,
  type SlotChange,
  type Marker,
  type MixRow,
  type Note,
  type Region,
  type RenderFile,
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

/** The rendered width of an element, kept current as the drawer is resized (0 until measured) */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

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
  "render_project",
  "render_versions",
  "get_envelope_points",
  "get_midi_cc",
  "get_midi_notes",
  "analyze_midi",
  "list_markers",
  "list_regions",
  "get_tempo_map",
  "list_media_items",
  "list_tracks",
  "list_midi_items",
  "get_track_properties",
  "get_track_routing",
  "get_time_selection",
  "get_fx_parameters",
]);

function render(v: EditView): ReactNode {
  switch (v.kind) {
    case "changes":
      return <Changes rows={v.rows} more={v.more} />;
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
    case "fxChain":
      return <FxChains v={v} />;
    case "routing":
      return <Routing v={v} />;
    case "render":
      return <Render v={v} />;
  }
}

/** The word a list row carries for what this call did to it */
const CHANGE_WORD: Record<SlotChange, string> = {
  new: "added",
  moved: "moved",
  changed: "changed",
};
/** "+1 −1" when the call added or removed entries, else how many it changed or moved */
const changedText = (added: number, removed: number, touched: number) =>
  added || removed ? `+${added} −${removed}` : String(touched);
const ChangeMark = ({ c }: { c?: SlotChange }) =>
  c ? <span className={`ev-mark ev-mark-${c}`}>{CHANGE_WORD[c]}</span> : null;

/** When the drawer is too narrow for a word on each row, rows keep their coloured edge and this names the colours */
const ChangeLegend = ({ change, removed }: { change: Map<number, SlotChange>; removed: number }) => {
  const kinds = (["new", "moved", "changed"] as SlotChange[]).filter((k) => [...change.values()].includes(k));
  if (!kinds.length && !removed) return null;
  return (
    <div className="measure-legend ev-mark-legend">
      {kinds.map((k) => (
        <span key={k}>
          <i className={`lg-edge lg-edge-${k}`} /> {CHANGE_WORD[k]}
        </span>
      ))}
      {removed > 0 && <span className="lg-struck">removed</span>}
    </div>
  );
};

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

function Changes({ rows, more = 0 }: { rows: ChangeRow[]; more?: number }) {
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
              <span className="ev-name" title={`${r.t} · ${label}`}>
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
      {more > 0 && (
        <div className="ev-more">+{plural(more, "more parameter")} not drawn</div>
      )}
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
  if (unit === "cc")
    return {
      top: 127,
      bottom: 0,
      ticks: [
        [127, "127"],
        [64, "64"],
        [0, "0"],
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
        : unit === "cc"
          ? String(Math.round(v))
          : v.toFixed(3);

function Envelope({ v }: { v: Extract<EditView, { kind: "envelope" }> }) {
  const [hover, setHover] = useState<EnvPoint | null>(null);
  // CC lanes count beats from the item start (beat 1 = the item's first beat); automation is project time
  const when = (t: number, digits = 1) =>
    v.beats ? `beat ${+(t + 1).toFixed(digits === 2 ? 2 : 1)}` : clock(t, digits);
  const span = Math.max(0.001, v.to - v.from);
  const poolPts = [...(v.pools ?? []), ...(v.wasPools ?? [])].flatMap((p) => p[1]);
  const vals = [...v.pts, ...(v.was ?? []), ...poolPts].map((p) => p[1]);
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
        <Readout
          label={v.unit === "cc" ? "CC" : "Envelope"}
          value={v.unit === "cc" ? v.env.split(" · ")[0].replace(/^CC /, "") : v.env}
          unit={v.unit === "cc" ? v.env.split(" · ")[1] : undefined}
        />
        <Readout label={v.unit === "cc" ? "Events" : "Points"} value={String(v.count)} />
        {v.ais && (
          <Readout
            label="Items"
            value={String(v.ais.length + (v.aisMore ?? 0))}
            unit={plural(new Set(v.ais.map((a) => a[2])).size, "pool")}
          />
        )}
        {v.was && (added.size > 0 || removed.length > 0 || !v.ais) && (
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
            aria-label={`${v.env} automation from ${when(v.from, 1)} to ${when(v.to, 1)}`}
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
            {v.ais && (
              <AutomationItems v={v} x={x} y={y} />
            )}
          </svg>
          {v.ais && <AutomationItemLabels v={v} x={x} />}
          {removed.filter(inView).map((p, i) => (
            <span
              key={`r${i}`}
              className="ev-dot ev-dot-gone"
              style={dot(x(p[0]), y(p[1]))}
              title={`Removed: ${when(p[0], 2)} · ${envValue(v.unit, p[1])}`}
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
              {when(hover[0], 2)} · {envValue(v.unit, hover[1])}
            </div>
          )}
        </div>
      </div>
      <div className="measure-scale-words mono ev-gutter">
        <span>{when(v.from, 1)}</span>
        <span>{when(v.to, 1)}</span>
      </div>
      {v.otherCcs && (
        <div className="ev-more">
          +{plural(v.otherCcs, "other controller")} in this item (filter with ccNumber)
        </div>
      )}
      {(v.was || v.ais) && (
        <Legend
          items={[
            ...(v.was
              ? ([
                  ["lg-line", "Now"],
                  ["lg-previous", "Before"],
                  ["lg-new", "Added or moved"],
                ] as Array<[string, string]>)
              : []),
            ...(v.ais ? ([["lg-ai", "Automation item (one colour per pool)"]] as Array<[string, string]>) : []),
          ]}
        />
      )}
    </>
  );
}

type EnvView = Extract<EditView, { kind: "envelope" }>;

/** One colour per pool, in the order pools first appear, so pooled items share it */
function poolColors(v: EnvView): Map<number, string> {
  const colors = new Map<number, string>();
  for (const a of [...(v.ais ?? []), ...(v.wasAis ?? [])])
    if (!colors.has(a[2])) colors.set(a[2], `var(--h${colors.size % 6})`);
  return colors;
}

const sameItem = (a: AutoItem, b: AutoItem) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** A pool's curve placed at an item, held at its last value to the item's end */
function poolCurve(
  pts: EnvPoint[],
  item: AutoItem,
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  const placed = pts
    .filter((p) => p[0] <= item[1] + 1e-6)
    .map((p) => [item[0] + p[0], p[1], p[2]] as EnvPoint);
  if (!placed.length) return "";
  const last = placed[placed.length - 1];
  if (last[0] < item[0] + item[1]) placed.push([item[0] + item[1], last[1], 0]);
  if (placed[0][0] > item[0]) placed.unshift([item[0], placed[0][1], 0]);
  return curve(placed, x, y);
}

/** Automation items over the envelope (they override it where they sit), each with its pool's curve */
function AutomationItems({
  v,
  x,
  y,
}: {
  v: EnvView;
  x: (t: number) => number;
  y: (v: number) => number;
}) {
  const colors = poolColors(v);
  const pts = new Map((v.pools ?? []).map((p) => [p[0], p[1]]));
  const wasPts = new Map((v.wasPools ?? []).map((p) => [p[0], p[1]]));
  const ais = v.ais ?? [];
  // Items that moved, resized or went: their old place, dashed
  const gone = (v.wasAis ?? []).filter((w) => !ais.some((a) => sameItem(a, w)));
  return (
    <g>
      {gone.map((a, i) => (
        <rect
          key={`g${i}`}
          className="ev-ai-gone"
          x={x(a[0])}
          width={Math.max(0.5, x(a[0] + a[1]) - x(a[0]))}
          y={0}
          height={EH}
          style={{ stroke: colors.get(a[2]) }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {ais.map((a, i) => {
        const color = colors.get(a[2]);
        const before = wasPts.get(a[2]);
        const now = pts.get(a[2]) ?? [];
        const changed = before && JSON.stringify(before) !== JSON.stringify(now);
        return (
          <g key={i}>
            <rect
              className="ev-ai-cover"
              x={x(a[0])}
              width={Math.max(0.5, x(a[0] + a[1]) - x(a[0]))}
              y={0}
              height={EH}
            />
            <rect
              className={`ev-ai ${v.ai === i ? "ev-ai-touched" : ""}`}
              x={x(a[0])}
              width={Math.max(0.5, x(a[0] + a[1]) - x(a[0]))}
              y={0}
              height={EH}
              style={{ fill: color, stroke: color }}
              vectorEffect="non-scaling-stroke"
            />
            {changed && (
              <path
                className="spectrum-previous"
                d={poolCurve(before, a, x, y)}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              className="ev-ai-line"
              d={poolCurve(now, a, x, y)}
              style={{ stroke: color }}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </g>
  );
}

/** Pool names on the items wide enough to hold one; every item says its name and pool on hover */
function AutomationItemLabels({ v, x }: { v: EnvView; x: (t: number) => number }) {
  const ais = v.ais ?? [];
  const uses = new Map<number, number>();
  for (const a of ais) uses.set(a[2], (uses.get(a[2]) ?? 0) + 1);
  return (
    <>
      {ais.map((a, i) => {
        const left = Math.max(0, x(a[0]));
        const width = Math.min(EW, x(a[0] + a[1])) - left;
        if (width <= 0) return null;
        const name = a[3] || `Pool ${a[2]}`;
        const pooled = (uses.get(a[2]) ?? 1) > 1;
        return (
          <span
            key={i}
            className={`ev-ai-label mono ${v.ai === i ? "ev-ai-label-touched" : ""}`}
            style={{ left: `${(left / EW) * 100}%`, width: `${(width / EW) * 100}%` }}
            title={`${name} · pool ${a[2]}${pooled ? ` · ${uses.get(a[2])} pooled items` : ""} · ${clock(a[0], 2)}–${clock(a[0] + a[1], 2)}`}
          >
            {width / EW > 0.1 ? `${name}${pooled ? " ⧉" : ""}` : ""}
          </span>
        );
      })}
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
  // Dense markers on a narrow drawer: only the labels that fit are drawn, the rest show on hover
  const [laneRef, laneW] = useWidth<HTMLDivElement>();
  const marks = [...markers.removed, ...v.markers];
  const labelled = fittingLabels(
    marks.map((m) => [pct(m[0], 0, len) / 100, String(m[1] || m[3])]),
    laneW || 1e6,
    new Set(
      marks.flatMap((m, i) =>
        i < markers.removed.length || markers.added.has(m) ? [i] : [],
      ),
    ),
  );
  const time = v.sel !== undefined || v.cur !== undefined || v.wasSel !== undefined;
  // On an item or selection view the markers are only context: their names show on hover
  const context = time || v.lanes !== undefined;
  const quiet = (i: number) => (!context && labelled.has(i) ? "" : "ev-quiet");
  // A region too narrow for a letter or two shows its colour only
  const roomy = (r: Region) =>
    !laneW || ((r[1] - r[0]) / len) * laneW >= 28;
  const lanes = v.lanes ?? [];
  const laneDiffs = lanes.map((l) => timelineDiff<Item>(l.items, l.was));
  const itemsAdded = laneDiffs.reduce((n, d) => n + d.added.size, 0);
  const itemsRemoved = laneDiffs.reduce((n, d) => n + d.removed.length, 0);
  const itemWrite = lanes.some((l) => l.was);
  return (
    <>
      {time ? (
        <div className="measure-readouts">
          <Readout label="Selection" value={v.sel ? clock(v.sel[0], 1) : "none"} />
          <Readout label="End" value={v.sel ? clock(v.sel[1], 1) : "–"} />
          <Readout
            label="Length"
            value={v.sel ? (v.sel[1] - v.sel[0]).toFixed(1) : "–"}
            unit={v.sel ? "s" : undefined}
          />
          <Readout label="Cursor" value={clock(v.cur ?? 0, 1)} />
        </div>
      ) : v.lanes ? (
        <div className="measure-readouts">
          <Readout
            label="Items"
            value={String(lanes.reduce((n, l) => n + l.items.length, 0))}
          />
          {itemWrite ? (
            <Readout label="Changed" value={`+${itemsAdded} −${itemsRemoved}`} />
          ) : (
            <Readout
              label="MIDI"
              value={String(lanes.reduce((n, l) => n + l.items.filter((it) => it[4]).length, 0))}
            />
          )}
          <Readout label={lanes.length > 1 ? "Tracks" : "Track"} value={lanes.map((l) => l.t).join(", ")} />
        </div>
      ) : (
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
          <>
            <Readout label="Regions" value={String(v.regions.length)} />
            <Readout label="Markers" value={String(v.markers.length)} />
          </>
        )}
      </div>
      )}
      <div className="ev-timeline" ref={laneRef}>
        {v.wasSel && (
          <span
            className="ev-sel ev-sel-was"
            style={{ left: at(v.wasSel[0]), width: `${pct(v.wasSel[1], 0, len) - pct(v.wasSel[0], 0, len)}%` }}
            title={`Selection before: ${clock(v.wasSel[0], 1)}–${clock(v.wasSel[1], 1)}`}
          />
        )}
        {v.sel && (
          <span
            className="ev-sel"
            style={{ left: at(v.sel[0]), width: `${pct(v.sel[1], 0, len) - pct(v.sel[0], 0, len)}%` }}
            title={`Selection ${clock(v.sel[0], 1)}–${clock(v.sel[1], 1)}`}
          />
        )}
        {v.wasCur !== undefined && v.wasCur !== v.cur && (
          <span className="ev-cur ev-cur-was" style={{ left: at(v.wasCur) }} title={`Cursor before: ${clock(v.wasCur, 1)}`} />
        )}
        {v.cur !== undefined && (
          <span className="ev-cur" style={{ left: at(v.cur) }} title={`Cursor ${clock(v.cur, 1)}`} />
        )}
        {(v.markers.length > 0 || markers.removed.length > 0) && (
          <div className={`ev-lane ev-lane-markers ${context ? "ev-lane-context" : ""}`}>
            {markers.removed.map((m, i) => (
              <span
                key={`r${m[3]}${m[0]}`}
                className={`ev-marker ev-gone ${quiet(i)}`}
                style={{ left: at(m[0]) }}
                title={`Removed: ${m[1] || `Marker ${m[3]}`} at ${clock(m[0], 1)}`}
              >
                <i />
                <b>{m[1] || m[3]}</b>
              </span>
            ))}
            {v.markers.map((m, i) => (
              <span
                key={`${m[3]}${m[0]}`}
                className={`ev-marker ${markers.added.has(m) ? "ev-new" : ""} ${quiet(markers.removed.length + i)}`}
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
              {roomy(r) && r[2]}
            </span>
          ))}
        </div>
        {v.items && <ItemsLane items={v.items} len={len} />}
        {v.lanes?.map((lane, i) => (
          <ItemsLane
            key={i}
            items={lane.items}
            was={lane.was}
            len={len}
            name={lane.t}
          />
        ))}
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
      {(itemsAdded > 0 || itemsRemoved > 0) && (
        <Legend
          items={[
            ["lg-new-mark", "Added or changed"],
            ["lg-gone-mark", "Before"],
          ]}
        />
      )}
      {time && (v.wasSel !== undefined || v.wasCur !== undefined) && (
        <Legend
          items={[
            ["lg-sel", "Now"],
            ["lg-gone-mark", "Before"],
          ]}
        />
      )}
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

function MixerRow({
  row,
  master,
  c,
  gone,
}: {
  row: MixRow;
  master?: boolean;
  c?: SlotChange;
  gone?: boolean;
}) {
  const [name, depth, color, db, pan, flags] = row;
  const hot = db > 0;
  const folder = flags.includes("F");
  return (
    <div
      className={`ev-trk ${master ? "ev-trk-master" : ""} ${flags.includes("M") ? "ev-trk-muted" : ""} ${c ? `ev-slot-${c}` : ""} ${gone ? "ev-slot-gone" : ""}`}
      title={`${name} · ${fmt(db)} dB · pan ${panText(pan)}${gone ? " · removed" : c ? ` · ${CHANGE_WORD[c]}` : ""}`}
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
      >
        <span className="ev-tn-text">
          {folder ? "▾ " : ""}
          {name}
        </span>
        {gone ? (
          <span className="ev-mark ev-mark-gone">removed</span>
        ) : (
          <ChangeMark c={c} />
        )}
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
  // Structure edits carry each track's id before and after, so added, removed and moved tracks can be told apart
  const was = v.ids && v.was ? v.was : undefined;
  const ids = v.ids ?? [];
  const d = listDiff(
    v.tracks.map((t, i): [string, MixRow] => [ids[i] ?? "", t]),
    was?.tracks.map((t, i): [string, MixRow] => [was.ids[i] ?? "", t]),
    (t) => t[0],
    (a, b) => JSON.stringify(a[1]) === JSON.stringify(b[1]),
  );
  const added = [...d.change.values()].filter((c) => c === "new").length;
  return (
    <>
      {was && (
        <div className="measure-readouts">
          <Readout label="Tracks" value={String(v.total)} />
          <Readout label="Changed" value={changedText(added, d.removed.length, d.change.size + d.removed.length)} />
        </div>
      )}
      {(v.from ?? 0) > 0 && <div className="ev-more">{plural(v.from ?? 0, "track")} above</div>}
      <div className="ev-mix">
        {v.tracks.map((t, i) => (
          <MixerRow key={ids[i] ?? i} row={t} c={d.change.get(i)} />
        ))}
        {d.removed.map(([i, t]) => (
          <MixerRow key={`gone${i}`} row={t[1]} gone />
        ))}
        {v.master && <MixerRow row={v.master} master />}
      </div>
      {was && <ChangeLegend change={d.change} removed={d.removed.length} />}
      {v.total > (v.from ?? 0) + v.tracks.length && (
        <div className="ev-more">
          +{v.total - (v.from ?? 0) - v.tracks.length} more tracks not drawn
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

// ── Render results ───────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  master: "Master",
  stems: "Stems",
  master_and_stems: "Mix + stems",
  selected_via_master: "Via master",
  region_matrix: "Regions",
  selected_items: "Items",
  selected_items_via_master: "Items via mix",
};
const NORM_LABEL: Record<string, [string, string]> = {
  lufs_i: ["LUFS-I", "LUFS"],
  lufs_m_max: ["LUFS-M max", "LUFS"],
  lufs_s_max: ["LUFS-S max", "LUFS"],
  rms: ["RMS", "dB"],
  peak: ["Peak", "dBFS"],
  true_peak: ["True peak", "dBTP"],
};
/** −150 marks a level REAPER could not measure (silence, or an older bridge) */
const measured = (db: number) => db > -150;
const RENDER_W = 120;
const RENDER_H = 22;
/** The same dB scale as the full waveform: −48 dB at the centre line, full scale at the edges */
const renderWaveY = (v: number) => {
  const a = Math.min(1, Math.abs(v));
  const h = a > 0 ? Math.max(0, (20 * Math.log10(a) + 48) / 48) : 0;
  return ((1 - (v < 0 ? -h : h)) / 2) * RENDER_H;
};

function RenderWave({ hi, lo }: { hi: number[]; lo: number[] }) {
  if (hi.length < 2 || lo.length !== hi.length) return <span className="ev-render-wave ev-render-wave-none" />;
  const at = (vals: number[]) => vals.map((v, i) => `${((i / (vals.length - 1)) * RENDER_W).toFixed(1)},${renderWaveY(v).toFixed(1)}`);
  return (
    <svg className="ev-render-wave" viewBox={`0 0 ${RENDER_W} ${RENDER_H}`} preserveAspectRatio="none" aria-hidden="true">
      <line className="spectrum-base" x1={0} x2={RENDER_W} y1={RENDER_H / 2} y2={RENDER_H / 2} vectorEffect="non-scaling-stroke" />
      <path className="ev-render-shape" d={`M${at(hi).join("L")}L${at(lo).reverse().join("L")}Z`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Render({ v }: { v: Extract<EditView, { kind: "render" }> }) {
  const files = v.groups.reduce((n, g) => n + g.f.length, 0) + (v.more ?? 0);
  const [normName, normUnit] = (v.norm && NORM_LABEL[v.norm]) || ["", ""];
  // Only an integrated target grades a file's integrated loudness; a momentary or short-term max target does not
  const lufsTarget = v.norm === "lufs_i" && v.nt !== undefined ? v.nt : undefined;
  const encoding = [v.fmt.toUpperCase() || "–", v.bd ?? (v.kbps ? String(v.kbps) : "")].filter(Boolean).join(" ");
  /** On target within 1 LU (accent), off target (amber); plain without a LUFS target */
  const lufsZone = (db: number) => (lufsTarget === undefined || !measured(db) ? "ok" : Math.abs(db - lufsTarget) <= 1 ? "ok" : "hot");
  const tpZone = (db: number) => (!measured(db) ? "ok" : db > 0 ? "over" : v.lim !== undefined ? (db > v.lim + 0.05 ? "hot" : "ok") : db > -1 ? "hot" : "ok");
  const row = (f: RenderFile, key: string) => {
    const [name, dur, lufs, tp, peak, hi, lo] = f;
    const label = `${name} · ${dur >= 0 ? clock(dur, 1) : "length unknown"}${measured(lufs) ? ` · ${fmt(lufs)} LUFS-I` : ""}${measured(tp) ? ` · true peak ${fmt(tp)} dBTP` : ""}${measured(peak) ? ` · sample peak ${fmt(peak)} dBFS` : ""}`;
    return (
      <div className="ev-render-row" key={key} role="group" aria-label={label} title={label}>
        <span className="ev-render-name">{name}</span>
        <RenderWave hi={hi} lo={lo} />
        <span className={`ev-render-v ev-render-lufs mono zone-${lufsZone(lufs)}`}>{measured(lufs) ? fmt(lufs) : "–"}</span>
        <span className={`ev-render-v ev-render-tp mono zone-${tpZone(tp)}`}>{measured(tp) ? fmt(tp) : "–"}</span>
        <span className="ev-render-v ev-render-dur mono">{dur >= 0 ? clock(dur) : "–"}</span>
      </div>
    );
  };
  return (
    <>
      <div className="measure-readouts">
        <Readout label="Files" value={String(files)} />
        <Readout label="Format" value={encoding} title={v.bd ? `${v.fmt.toUpperCase()} ${v.bd === "32f" ? "32-bit float" : `${v.bd}-bit`}` : v.kbps ? `${v.fmt.toUpperCase()} ${v.kbps} kbps` : undefined} />
        <Readout label="Source" value={SOURCE_LABEL[v.src] ?? v.src} />
        <Readout label="Target" value={v.nt !== undefined && v.norm ? fmt(v.nt) : "None"} unit={v.norm ? normUnit : undefined} title={v.norm ? `Normalized by ${normName}` : "Not normalized"} />
      </div>
      {(v.norm || v.lim !== undefined) && (
        <div className="ev-render-tags">
          {v.norm && <span className="ev-render-tag">Normalize {normName} {v.nt !== undefined ? fmt(v.nt) : ""}</span>}
          {v.lim !== undefined && <span className="ev-render-tag">Limit {fmt(v.lim)} {v.tp ? "dBTP" : "dBFS"}</span>}
        </div>
      )}
      <div className="ev-render" role="group" aria-label="Rendered files">
        <div className="ev-render-row ev-render-head" aria-hidden="true">
          <span>File</span>
          <span className="ev-render-wave-h">Waveform</span>
          <span className="ev-render-v">LUFS-I</span>
          <span className="ev-render-v">TP</span>
          <span className="ev-render-v ev-render-dur">Len</span>
        </div>
        {v.groups.map((g, gi) => (
          <div className="ev-render-group" key={gi}>
            {g.v && (
              <div className="ev-render-version">
                <b>{g.v}</b>
                <span className="muted" title={g.m.join(", ")}>{g.m.length ? `muted ${g.m.join(", ")}` : "full mix"}</span>
              </div>
            )}
            {g.f.map((f, i) => row(f, `${gi}:${i}`))}
          </div>
        ))}
      </div>
      {(v.more ?? 0) > 0 && <div className="ev-more">+{plural(v.more ?? 0, "more file")} not listed</div>}
      {lufsTarget !== undefined && (
        <Legend items={[["lg-tick", `On target (±1 LU of ${fmt(lufsTarget)})`], ["lg-warn", "Off target"]]} />
      )}
    </>
  );
}

// ── FX chain ─────────────────────────────────────────────────────────────────

/** "VST3: Pro-Q 3 (FabFilter)" → "Pro-Q 3"; the full name stays in the tooltip */
const fxShort = (name: string) =>
  name.replace(/^[A-Z0-9]+i?:\s*/, "").replace(/\s*\([^()]*\)$/, "") || name;
const sameSlot = (a: FxSlot, b: FxSlot) =>
  a[0] === b[0] && a[1] === b[1] && a[3] === b[3];

function FxChains({ v }: { v: Extract<EditView, { kind: "fxChain" }> }) {
  const diffs = v.chains.map((c) =>
    listDiff(c.fx, c.was, (f, i) => f[2] || `${i}:${f[0]}`, sameSlot),
  );
  const added = diffs.reduce(
    (n, d) => n + [...d.change.values()].filter((c) => c === "new").length,
    0,
  );
  const removed = diffs.reduce((n, d) => n + d.removed.length, 0);
  const touched = diffs.reduce((n, d) => n + d.change.size, 0) + removed;
  const write = v.chains.some((c) => c.was);
  const all = v.chains.flatMap((c) => c.fx);
  return (
    <>
      <div className="measure-readouts">
        <Readout
          label={v.chains.length > 1 ? "Tracks" : "Track"}
          value={v.chains.map((c) => c.t).join(" → ")}
        />
        <Readout label="FX" value={String(all.length)} />
        {write ? (
          <Readout label="Changed" value={changedText(added, removed, touched)} />
        ) : (
          <Readout
            label="Bypassed"
            value={String(all.filter((f) => f[1].includes("B")).length)}
          />
        )}
      </div>
      {v.chains.map((c, ci) => (
        <FxChainList key={ci} chain={c} diff={diffs[ci]} named={v.chains.length > 1} />
      ))}
      {write && touched === 0 && (
        <div className="ev-more">Nothing in the chain changed</div>
      )}
    </>
  );
}

function FxChainList({
  chain,
  diff,
  named,
}: {
  chain: FxChain;
  diff: ReturnType<typeof listDiff<FxSlot>>;
  named: boolean;
}) {
  return (
    <div className="ev-chain">
      {named && <div className="ev-lane-name">{chain.t}</div>}
      {chain.fx.length === 0 && diff.removed.length === 0 && (
        <div className="ev-more">No FX on this track</div>
      )}
      <ol className="ev-slots">
        {chain.fx.map((f, i) => {
          const c = diff.change.get(i);
          const was = chain.was?.find((w) => w[2] && w[2] === f[2]);
          return (
            <li
              key={`${f[2]}${i}`}
              className={`ev-slot ${f[1].includes("B") ? "ev-slot-bypassed" : ""} ${f[1].includes("O") ? "ev-slot-offline" : ""} ${c ? `ev-slot-${c}` : ""}`}
              title={[f[0], f[3] && `preset ${f[3]}`, was && was[0] !== f[0] && `was ${was[0]}`].filter(Boolean).join(" · ")}
            >
              <span className="ev-op-n mono">{i + 1}</span>
              <span className="ev-slot-name">
                {fxShort(f[0])}
                {f[3] && <small>{f[3]}</small>}
              </span>
              <span className="ev-slot-state">
                {f[1].includes("O") ? "offline" : f[1].includes("B") ? "bypassed" : ""}
                <ChangeMark c={c} />
              </span>
            </li>
          );
        })}
        {diff.removed.map(([i, f]) => (
          <li key={`gone${f[2]}${i}`} className="ev-slot ev-slot-gone" title={`Removed: ${f[0]}`}>
            <span className="ev-op-n mono">{i + 1}</span>
            <span className="ev-slot-name">{fxShort(f[0])}</span>
            <span className="ev-slot-state">
              <span className="ev-mark ev-mark-gone">removed</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Routing ──────────────────────────────────────────────────────────────────

const ROUTE_KIND: Record<Route[0], [string, string]> = {
  s: ["→", "Send to"],
  r: ["←", "Receive from"],
  h: ["⇥", "Hardware output"],
};
const sameRoute = (a: Route, b: Route) =>
  a[2] === b[2] && a[3] === b[3] && a[4] === b[4];

function Routing({ v }: { v: Extract<EditView, { kind: "routing" }> }) {
  const ids = routeIds(v.routes);
  const wasIds = v.was ? routeIds(v.was) : [];
  const diff = listDiff(
    v.routes.map((r, i): [string, Route] => [ids[i], r]),
    v.was?.map((r, i): [string, Route] => [wasIds[i], r]),
    (r) => r[0],
    (a, b) => sameRoute(a[1], b[1]),
  );
  const count = (k: Route[0]) => v.routes.filter((r) => r[0] === k).length;
  return (
    <>
      <div className="measure-readouts">
        <Readout label="Track" value={v.t} />
        <Readout label="Sends" value={String(count("s") + count("h"))} />
        <Readout label="Receives" value={String(count("r"))} />
      </div>
      {v.routes.length === 0 && diff.removed.length === 0 ? (
        <div className="ev-more">No sends, receives or hardware outputs</div>
      ) : (
        <div className="ev-mix">
          {v.routes.map((r, i) => {
            const c = diff.change.get(i);
            const before = c === "changed" ? v.was?.[wasIds.indexOf(ids[i])] : undefined;
            return <RouteRow key={ids[i]} r={r} c={c} was={before} />;
          })}
          {diff.removed.map(([i, r]) => (
            <RouteRow key={`gone${wasIds[i]}`} r={r[1]} gone />
          ))}
        </div>
      )}
      {v.was && <ChangeLegend change={diff.change} removed={diff.removed.length} />}
      {v.was && diff.change.size + diff.removed.length > 0 && (
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

function RouteRow({ r, c, was, gone }: { r: Route; c?: SlotChange; was?: Route; gone?: boolean }) {
  const [kind, other, db, pan, flags] = r;
  const [glyph, word] = ROUTE_KIND[kind];
  const hot = db > 0;
  return (
    <div
      className={`ev-trk ev-route ${flags.includes("M") ? "ev-trk-muted" : ""} ${gone ? "ev-slot-gone" : ""} ${c ? `ev-slot-${c}` : ""}`}
      title={`${word} ${other} · ${fmt(db)} dB · pan ${panText(pan)}${flags.includes("M") ? " · muted" : ""}${was ? ` · was ${fmt(was[2])} dB, pan ${panText(was[3])}` : ""}${gone ? " · removed" : c ? ` · ${CHANGE_WORD[c]}` : ""}`}
    >
      <span className="ev-route-kind" aria-label={word}>
        {glyph}
      </span>
      <span className="ev-tn">
        <span className="ev-tn-text">{other}</span>
        {gone ? <span className="ev-mark ev-mark-gone">removed</span> : <ChangeMark c={c} />}
      </span>
      <span className="ev-bar ev-fader" role="img" aria-label={`${fmt(db)} dB`}>
        <span className="ev-zero" style={{ left: `${pct(0, -60, 6)}%` }} />
        <span
          className={`ev-fill ${hot ? "ev-fill-hot" : ""}`}
          style={{ left: 0, width: `${pct(db, -60, 6)}%` }}
        />
        {was && was[2] !== db && (
          <span className="ev-was" style={{ left: `${pct(was[2], -60, 6)}%` }} />
        )}
      </span>
      <span className={`ev-tv mono zone-${hot ? "hot" : "ok"}`}>{fmt(db)}</span>
      <span className="ev-pan" role="img" aria-label={`pan ${panText(pan)}`}>
        <span className="ev-pan-c" />
        <span className="ev-pan-d" style={{ left: `${pct(pan, -1, 1)}%` }} />
      </span>
      <span className="ev-chips">
        <span className={`ev-chip ${flags.includes("M") ? "ev-chip-m" : ""}`}>M</span>
      </span>
    </div>
  );
}

/** One track's items; with `was`, the items before the edit show dashed where they no longer are */
function ItemsLane({
  items,
  was,
  len,
  name,
}: {
  items: Item[];
  was?: Item[];
  len: number;
  name?: string;
}) {
  const at = (t: number) => `${pct(t, 0, len)}%`;
  const width = (it: Item) =>
    `calc(${pct(it[0] + it[1], 0, len) - pct(it[0], 0, len)}% - 1px)`;
  const { added, removed } = timelineDiff<Item>(items, was);
  return (
    <div className="ev-lane-wrap">
      {name && <div className="ev-lane-name">{name}</div>}
      <div className="ev-lane ev-lane-items">
        {removed.map((it, i) => (
          <span
            key={`gone${i}`}
            className="ev-item ev-gone"
            style={{ left: at(it[0]), width: width(it) }}
            title={`Before · ${clock(it[0], 1)}–${clock(it[0] + it[1], 1)}`}
          />
        ))}
        {items.map((it, i) => (
          <span
            key={i}
            className={`ev-item ${it[4] ? "ev-item-midi" : ""} ${it[5] ? "ev-item-muted" : ""} ${added.has(it) ? "ev-new" : ""}`}
            style={{ left: at(it[0]), width: width(it) }}
            title={`${it[4] ? "MIDI" : "Audio"} item · ${clock(it[0], 1)}–${clock(it[0] + it[1], 1)}${it[5] ? " · muted" : ""}`}
          >
            {it[2] > 0 && (
              <i className="ev-fade-in" style={{ width: `${(it[2] / it[1]) * 100}%` }} />
            )}
            {it[3] > 0 && (
              <i className="ev-fade-out" style={{ width: `${(it[3] / it[1]) * 100}%` }} />
            )}
          </span>
        ))}
        {items.length === 0 && removed.length === 0 && (
          <span className="ev-more ev-lane-empty">No items</span>
        )}
      </div>
    </div>
  );
}
