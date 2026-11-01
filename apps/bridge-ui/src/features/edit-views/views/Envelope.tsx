import { useState, type PointerEvent, type ReactNode } from 'react';
import { newPoints, type AutoItem, type EditView, type EnvPoint } from '../edit-views.js';
import { Counts } from './Counts.js';
import { Legend } from './ChangeLegend.js';
import { dot } from './PianoRoll.js';
import { clock, plural } from './format.js';
import { Measurement, fmt } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Envelope.module.css';

export const EW = 400;

/**
 * The value of the point under the pointer, beside it: above the point, or below it when the point sits near
 * the top. `left` / `top` are percentages of the plot; the tip stays inside it at the edges.
 */
export function PointTip({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  return (
    <div
      role="tooltip"
      className={cx(chartStyles.spectrumTip, styles.evTip, 'mono')}
      data-align={top < 35 ? 'below' : undefined}
      style={{ left: `${Math.min(88, Math.max(12, left))}%`, top: `${top}%` }}
    >
      {children}
    </div>
  );
}
export const EH = 110;

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

export function Envelope({ v }: { v: Extract<EditView, { kind: "envelope" }> }) {
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
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout
          label={v.unit === "cc" ? "CC" : "Envelope"}
          value={v.unit === "cc" ? v.env.split(" · ")[0].replace(/^CC /, "") : v.env}
          unit={v.unit === "cc" ? v.env.split(" · ")[1] : undefined}
        />
        <Measurement.Readout label={v.unit === "cc" ? "Events" : "Points"} value={String(v.count)} />
        {v.ais && (
          <Measurement.Readout
            label="Items"
            value={String(v.ais.length + (v.aisMore ?? 0))}
            unit={plural(new Set(v.ais.map((a) => a[2])).size, "pool")}
          />
        )}
        {v.was && (added.size > 0 || removed.length > 0 || !v.ais) && (
          <Counts added={added.size} removed={removed.length} />
        )}
      </div>
      <div className={cx(styles.evEnv, styles.evGutter)}>
        {ticks.map(([d, label]) => (
          <span
            key={d}
            className={cx(styles.evY, 'mono')}
            style={{ top: `${(y(d) / EH) * 100}%` }}
          >
            {label}
          </span>
        ))}
        <div
          className={styles.evPlot}
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
                className={d === 0 ? chartStyles.spectrumBase : chartStyles.spectrumGrid}
                x1={0}
                x2={EW}
                y1={y(d)}
                y2={y(d)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {v.was && (
              <path
                className={chartStyles.spectrumPrevious}
                d={curve(v.was, x, y)}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {line && (
              <path
                className={styles.evEnvArea}
                d={`${line}V${EH}H${v.pts.length === 1 ? 0 : x(v.pts[0][0])}Z`}
              />
            )}
            {line && (
              <path
                className={styles.evEnvLine}
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
              className={cx(styles.evDot, styles.evDotGone)}
              style={dot(x(p[0]), y(p[1]))}
              title={`Removed: ${when(p[0], 2)} · ${envValue(v.unit, p[1])}`}
            />
          ))}
          {v.pts.filter(inView).map((p, i) => (
            <span
              key={i}
              className={cx(styles.evDot, added.has(p) ? styles.evDotNew : '', p === hover ? styles.evDotHover : '')}
              style={dot(x(p[0]), y(p[1]))}
            />
          ))}
          {hover && (
            <PointTip left={(x(hover[0]) / EW) * 100} top={(y(hover[1]) / EH) * 100}>
              {when(hover[0], 2)} · {envValue(v.unit, hover[1])}
            </PointTip>
          )}
        </div>
      </div>
      <div className={cx(chartStyles.measureScaleWords, styles.evGutter, 'mono')}>
        <span>{when(v.from, 1)}</span>
        <span>{when(v.to, 1)}</span>
      </div>
      {v.otherCcs && (
        <div className={chartStyles.evMore}>
          +{plural(v.otherCcs, "other controller")} in this item (filter with ccNumber)
        </div>
      )}
      {(v.was || v.ais) && (
        <Legend
          items={[
            ...(v.was
              ? ([
                  [chartStyles.lgLine, "Now"],
                  [chartStyles.lgPrevious, "Before"],
                  [chartStyles.lgNew, "Added or moved"],
                ] as Array<[string, string]>)
              : []),
            ...(v.ais ? ([[chartStyles.lgAi, "Automation item (one colour per pool)"]] as Array<[string, string]>) : []),
            ...(v.ais && changedItems(v).size
              ? ([[cx(chartStyles.lgAi, styles.lgAiDim), "Unchanged item"]] as Array<[string, string]>)
              : []),
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

/**
 * The items this call changed: the one it touched, ones added or moved, and every item of a pool whose curve
 * changed (pooled items share it). The view dims the others, so the change reads at a glance; empty when the
 * call changed no item (a listing, a plain point edit), and then nothing is dimmed.
 */
function changedItems(v: EnvView): Set<number> {
  const ais = v.ais ?? [];
  const changed = new Set<number>();
  if (v.ai !== undefined && v.ai >= 0) changed.add(v.ai);
  if (v.wasAis) ais.forEach((a, i) => !v.wasAis?.some((w) => sameItem(a, w)) && changed.add(i));
  const before = new Map((v.wasPools ?? []).map((p) => [p[0], JSON.stringify(p[1])]));
  const now = new Map((v.pools ?? []).map((p) => [p[0], JSON.stringify(p[1])]));
  ais.forEach((a, i) => before.has(a[2]) && before.get(a[2]) !== (now.get(a[2]) ?? "[]") && changed.add(i));
  return changed;
}

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
  const focus = changedItems(v);
  // Items that moved, resized or went: their old place, dashed
  const gone = (v.wasAis ?? []).filter((w) => !ais.some((a) => sameItem(a, w)));
  return (
    <g>
      {gone.map((a, i) => (
        <rect
          key={`g${i}`}
          className={styles.evAiGone}
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
          <g key={i} className={styles.evAiItem} data-state={focus.size && !focus.has(i) ? "dim" : undefined}>
            <rect
              className={styles.evAiCover}
              x={x(a[0])}
              width={Math.max(0.5, x(a[0] + a[1]) - x(a[0]))}
              y={0}
              height={EH}
            />
            <rect
              className={cx(styles.evAi, v.ai === i ? styles.evAiTouched : '')}
              x={x(a[0])}
              width={Math.max(0.5, x(a[0] + a[1]) - x(a[0]))}
              y={0}
              height={EH}
              style={{ fill: color, stroke: color }}
              vectorEffect="non-scaling-stroke"
            />
            {changed && (
              <path
                className={chartStyles.spectrumPrevious}
                d={poolCurve(before, a, x, y)}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              className={styles.evAiLine}
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
  const focus = changedItems(v);
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
            className={cx(styles.evAiLabel, 'mono', v.ai === i ? styles.evAiLabelTouched : '')}
            data-state={focus.size && !focus.has(i) ? "dim" : undefined}
            style={{ left: `${(left / EW) * 100}%`, width: `${(width / EW) * 100}%` }}
            title={`${name} · pool ${a[2]}${pooled ? ` · ${uses.get(a[2])} pooled items` : ""} · ${clock(a[0], 2)}–${clock(a[0] + a[1], 2)}${focus.has(i) ? " · changed by this call" : ""}`}
          >
            {width / EW > 0.1 ? `${name}${pooled ? " ⧉" : ""}` : ""}
          </span>
        );
      })}
    </>
  );
}
