import { useState } from 'react';
import { listDiff, routeIds, type EditView, type Route, type SlotChange } from '../edit-views.js';
import { ChangeLegend, ChangeMark, Legend } from './ChangeLegend.js';
import { ChipLegend } from './Mixer.js';
import { PointTip } from './Envelope.js';
import { HoverTip } from './HoverTip.js';
import { CHANGE_WORD, panText, panWords, pct } from './format.js';
import { Measurement, fmt } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import mixerStyles from './Mixer.module.css';
import styles from './Routing.module.css';

const ROUTE_KIND: Record<Route[0], [string, string]> = {
  s: ["→", "Send to"],
  r: ["←", "Receive from"],
  h: ["⇥", "Hardware output"],
};
/** Where each kind sits: the sections in signal order, each headed in words so the glyph is not the only cue */
const SECTIONS: Array<[Route[0], string]> = [["r", "Receives from"], ["s", "Sends to"], ["h", "Hardware outputs"]];

/** One route as drawn: now (with its change and level before), or removed */
interface Entry { key: string; r: Route; c?: SlotChange; was?: Route; gone?: boolean }
interface Focus { key: string; inFlow: boolean }

const sameRoute = (a: Route, b: Route) =>
  a[2] === b[2] && a[3] === b[3] && a[4] === b[4];

export function Routing({ v }: { v: Extract<EditView, { kind: "routing" }> }) {
  const ids = routeIds(v.routes);
  const wasIds = v.was ? routeIds(v.was) : [];
  const diff = listDiff(
    v.routes.map((r, i): [string, Route] => [ids[i], r]),
    v.was?.map((r, i): [string, Route] => [wasIds[i], r]),
    (r) => r[0],
    (a, b) => sameRoute(a[1], b[1]),
  );
  // A changed route whose level moved draws its old level as a hollow mark
  const levelMoved = v.routes.some((r, i) => diff.change.get(i) === "changed" && v.was?.[wasIds.indexOf(ids[i])]?.[2] !== r[2]);
  // The route under the pointer, in the flow or the rows: its wire lights up and its row is marked. The flow says
  // its level only when hovered there (a row shows its own)
  const [focus, setFocus] = useState<Focus | null>(null);
  const count = (k: Route[0]) => v.routes.filter((r) => r[0] === k).length;
  const entries: Entry[] = [
    ...v.routes.map((r, i): Entry => {
      const c = diff.change.get(i);
      return { key: ids[i], r, c, was: c === "changed" ? v.was?.[wasIds.indexOf(ids[i])] : undefined };
    }),
    ...diff.removed.map(([i, r]): Entry => ({ key: `gone${wasIds[i]}`, r: r[1], gone: true })),
  ];
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Track" value={v.t} />
        <Measurement.Readout label="Sends" value={String(count("s") + count("h"))} />
        <Measurement.Readout label="Receives" value={String(count("r"))} />
      </div>
      {v.routes.length === 0 && diff.removed.length === 0 ? (
        <div className={chartStyles.evMore}>No sends, receives or hardware outputs</div>
      ) : (
        <>
          <RouteFlow t={v.t} entries={entries} write={!!v.was} focus={focus} onFocus={(key) => setFocus(key ? { key, inFlow: true } : null)} />
          {SECTIONS.map(([k, heading]) => {
            const group = entries.filter((e) => e.r[0] === k);
            return group.length ? (
              <section key={k} className={styles.section} aria-label={heading}>
                <h4 className={styles.heading}>
                  <span className="mono" aria-hidden>{ROUTE_KIND[k][0]}</span> {heading}
                </h4>
                <div className={mixerStyles.evMix}>
                  {group.map((e) => (
                    <RouteRow
                      key={e.key}
                      r={e.r}
                      c={e.c}
                      was={e.was}
                      gone={e.gone}
                      focused={focus?.key === e.key}
                      onFocus={(on) => setFocus(on ? { key: e.key, inFlow: false } : null)}
                    />
                  ))}
                </div>
              </section>
            ) : null;
          })}
        </>
      )}
      {entries.length > 0 && <FlowLegend entries={entries} write={!!v.was} />}
      <ChipLegend flags={v.routes.map((r) => r[4])} />
      {v.was && <ChangeLegend change={diff.change} removed={diff.removed.length} />}
      {levelMoved && (
        <Legend
          items={[
            [chartStyles.lgWas, "Before"],
            [chartStyles.lgRange, "Now"],
          ]}
        />
      )}
    </>
  );
}

function RouteRow({ r, c, was, gone, focused, onFocus }: {
  r: Route; c?: SlotChange; was?: Route; gone?: boolean; focused?: boolean; onFocus?: (on: boolean) => void;
}) {
  const [kind, other, db, pan, flags] = r;
  const [glyph, word] = ROUTE_KIND[kind];
  const hot = db > 0;
  return (
    <div
      className={cx(mixerStyles.evTrk, mixerStyles.evRoute, styles.row, flags.includes("M") && mixerStyles.evTrkMuted)}
      data-change={gone ? "gone" : c}
      data-focus={focused || undefined}
      aria-current={focused || undefined}
      onPointerEnter={() => onFocus?.(true)}
      onPointerLeave={() => onFocus?.(false)}
      title={`${word} ${other} · ${fmt(db)} dB · pan ${panText(pan)}${flags.includes("M") ? " · muted" : ""}${was ? ` · was ${fmt(was[2])} dB, pan ${panText(was[3])}` : ""}${gone ? " · removed" : c ? ` · ${CHANGE_WORD[c]}` : ""}`}
    >
      <span className={mixerStyles.evRouteKind} aria-label={word}>
        {glyph}
      </span>
      <span className={mixerStyles.evTn}>
        <span className={mixerStyles.evTnText}>{other}</span>
        {gone ? <span className={mixerStyles.evMark} data-change="gone">removed</span> : <ChangeMark c={c} />}
      </span>
      <HoverTip
        className={cx(chartStyles.evBar, mixerStyles.evFader)}
        role="img"
        aria-label={`${fmt(db)} dB`}
        tip={`Level ${was && was[2] !== db ? `${fmt(was[2])} → ` : ""}${fmt(db)} dB`}
      >
        <span className={chartStyles.evZero} style={{ left: `${pct(0, -60, 6)}%` }} />
        <span
          className={cx(chartStyles.evFill, hot ? mixerStyles.evFillHot : '')}
          style={{ left: 0, width: `${pct(db, -60, 6)}%` }}
        />
        {was && was[2] !== db && (
          <span className={chartStyles.evWas} style={{ left: `${pct(was[2], -60, 6)}%` }} />
        )}
      </HoverTip>
      <span className={cx(mixerStyles.evTv, "mono")} data-zone={hot ? "hot" : "ok"}>{fmt(db)}</span>
      <HoverTip
        className={mixerStyles.evPan}
        role="img"
        aria-label={`pan ${panText(pan)}`}
        tip={`Pan ${was && was[3] !== pan ? `${panWords(was[3])} → ` : ""}${panWords(pan)}`}
      >
        <span className={mixerStyles.evPanC} />
        <span className={mixerStyles.evPanD} style={{ left: `${pct(pan, -1, 1)}%` }} />
      </HoverTip>
      <span className={mixerStyles.evChips}>
        <span className={mixerStyles.evChip} data-chip={flags.includes("M") ? "m" : undefined}>M</span>
      </span>
    </div>
  );
}

/** Most routes a flow draws on one side; past it the sections below say it all */
const FLOW_MAX = 16;
const ROW = 24;
const fits = (entries: Entry[]) =>
  Math.max(entries.filter((e) => e.r[0] === "r").length, entries.filter((e) => e.r[0] !== "r").length) <= FLOW_MAX;
/** Wire weight from the level: −60 dB a hairline, +6 dB the thickest */
const weight = (db: number) => 0.75 + (Math.min(6, Math.max(-60, db)) + 60) / 66 * 2.75;
const wireState = (e: Entry, write: boolean) =>
  e.gone ? "gone" : e.r[4].includes("M") ? "muted" : !write || e.c ? "now" : "same";

/**
 * The signal flow: receives wire in from the left, sends and hardware outputs leave on the right, each wire as
 * thick as its level. Numbers stay in the rows below; hovering a wire or name says its level and pan and marks its
 * row, and hovering a row lights its wire.
 */
function RouteFlow({ t, entries, write, focus, onFocus }: {
  t: string; entries: Entry[]; write: boolean; focus: Focus | null; onFocus: (key: string | null) => void;
}) {
  const ins = entries.filter((e) => e.r[0] === "r");
  const outs = entries.filter((e) => e.r[0] !== "r");
  if (!fits(entries)) return null;
  const rows = Math.max(ins.length, outs.length, 1);
  const H = rows * ROW;
  const mid = H / 2;
  // The track grows with its busiest side, so its wires land side by side on its edge instead of in one point
  const nodeH = Math.min(H - 4, Math.max(26, rows * 6 + 14));
  const land = (i: number, n: number) => mid + (n > 1 ? (i / (n - 1) - 0.5) * (nodeH - 12) : 0);
  // Columns in % of the width: labels, wire, the track, wire, labels; a side with no routes gives its room away
  const [nodeL, nodeR] = !ins.length ? [0, 26] : !outs.length ? [74, 100] : [37, 63];
  const inX = 27;
  const outX = 73;
  const yOf = (i: number, n: number) => ((rows - n) / 2 + i + 0.5) * ROW;
  const wire = (x0: number, y0: number, x1: number, y1: number) => {
    const xm = (x0 + x1) / 2;
    return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1}`;
  };
  const tip = (e: Entry) =>
    `${ROUTE_KIND[e.r[0]][1]} ${e.r[1]} · ${e.was && e.was[2] !== e.r[2] ? `${fmt(e.was[2])} → ` : ""}${fmt(e.r[2])} dB · pan ${e.was && e.was[3] !== e.r[3] ? `${panWords(e.was[3])} → ` : ""}${panWords(e.r[3])}${e.r[4].includes("M") ? " · muted" : ""}${e.gone ? " · removed" : ""}`;
  const hover = (e: Entry) => ({ onPointerEnter: () => onFocus(e.key), onPointerLeave: () => onFocus(null) });
  const lit = (e: Entry) => (focus ? (focus.key === e.key ? "on" : "off") : undefined);
  const inAt = focus?.inFlow ? ins.findIndex((e) => e.key === focus.key) : -1;
  const outAt = focus?.inFlow ? outs.findIndex((e) => e.key === focus.key) : -1;
  const describe = (list: Entry[]) => list.filter((e) => !e.gone).map((e) => e.r[1]).join(", ");
  return (
    <div
      className={styles.flow}
      style={{ height: H }}
      role="img"
      aria-label={[ins.length && `${describe(ins)} into ${t}`, outs.length && `${t} out to ${describe(outs)}`].filter(Boolean).join("; ")}
    >
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden>
        {ins.map((e, i) => (
          <path key={e.key} className={styles.wire} data-state={wireState(e, write)} d={wire(inX, yOf(i, ins.length), nodeL, land(i, ins.length))} data-focus={lit(e)} style={{ strokeWidth: weight(e.r[2]) }} vectorEffect="non-scaling-stroke" {...hover(e)} />
        ))}
        {outs.map((e, i) => (
          <path key={e.key} className={styles.wire} data-state={wireState(e, write)} d={wire(nodeR, land(i, outs.length), ins.length ? outX : 50, yOf(i, outs.length))} data-focus={lit(e)} style={{ strokeWidth: weight(e.r[2]) }} vectorEffect="non-scaling-stroke" {...hover(e)} />
        ))}
      </svg>
      <span className={styles.node} style={{ left: `${nodeL}%`, width: `${nodeR - nodeL}%`, top: mid, height: nodeH }}><span className={styles.nodeName}>{t}</span></span>
      {ins.map((e, i) => (
        <span key={e.key} className={styles.label} data-side="in" data-state={wireState(e, write)} data-focus={lit(e)} style={{ right: `${100 - inX + 1}%`, top: yOf(i, ins.length) }} {...hover(e)}>
          {e.r[1]}
        </span>
      ))}
      {outs.map((e, i) => (
        <span key={e.key} className={styles.label} data-side="out" data-state={wireState(e, write)} data-focus={lit(e)} style={{ left: `${(ins.length ? outX : 50) + 1}%`, top: yOf(i, outs.length) }} {...hover(e)}>
          <span className="mono" aria-hidden>{ROUTE_KIND[e.r[0]][0]}</span> {e.r[1]}
        </span>
      ))}
      {/* Centred over the flow at the route's height, so a long name never runs off the drawer */}
      {inAt >= 0 && <PointTip left={50} top={(yOf(inAt, ins.length) / H) * 100}>{tip(ins[inAt])}</PointTip>}
      {outAt >= 0 && <PointTip left={50} top={(yOf(outAt, outs.length) / H) * 100}>{tip(outs[outAt])}</PointTip>}
    </div>
  );
}

/** Names the wire looks the flow draws, only those drawn */
function FlowLegend({ entries, write }: { entries: Entry[]; write: boolean }) {
  if (!fits(entries)) return null;
  const drawn = new Set(entries.map((e) => wireState(e, write)));
  const items: Array<[string, string]> = [
    [styles.lgWeight, "Thicker = louder"],
    ...(drawn.has("now") ? [[chartStyles.lgLine, write ? "Added or changed" : "Route"] as [string, string]] : []),
    ...(drawn.has("same") ? [[styles.lgSame, "Unchanged"] as [string, string]] : []),
    ...(drawn.has("muted") ? [[styles.lgMuted, "Muted"] as [string, string]] : []),
    ...(drawn.has("gone") ? [[styles.lgGone, "Removed"] as [string, string]] : []),
  ];
  return <Legend items={items} />;
}
