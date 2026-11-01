import { useState } from 'react';
import type { EditView } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { PointTip } from './Envelope.js';
import { fxShort } from './format.js';
import { Measurement } from '../../measurements/index.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Pins.module.css';

type PinsView = Extract<EditView, { kind: "pins" }>;
type Side = "in" | "out";
/** A wire on a read, or on a write: kept, newly connected, or disconnected */
type WireState = "on" | "same" | "new" | "gone";
interface Wire { side: Side; pin: number; ch: number; state: WireState }
/** What the pointer is on: a pin of the plugin, or a track channel on one side */
type Focus = { side: Side; pin: number } | { side: Side; ch: number };

/** Most pins a side draws; a multichannel plugin's rest is counted under the patch */
const MAX_PINS = 16;
const ROW = 22;

function wiresOf(now: number[][], was: number[][] | undefined, side: Side, write: boolean): Wire[] {
  const wires: Wire[] = [];
  for (let pin = 0; pin < Math.max(now.length, was?.length ?? 0); pin++) {
    const a = now[pin] ?? [];
    const b = was?.[pin] ?? (write ? [] : a);
    for (const ch of [...new Set([...a, ...b])].sort((x, y) => x - y)) {
      const on = a.includes(ch);
      const before = b.includes(ch);
      wires.push({ side, pin, ch, state: !write ? "on" : on && before ? "same" : on ? "new" : "gone" });
    }
  }
  return wires;
}

const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
const WORD: Record<WireState, string> = { on: "", same: "", new: " (new)", gone: " (disconnected)" };

/**
 * The plugin as a patch: track channels on the left wired into its input pins, its output pins wired back to track
 * channels on the right. Only connected pins and channels are drawn, so the change is the only thing to find.
 */
export function Pins({ v }: { v: PinsView }) {
  const [focus, setFocus] = useState<Focus | null>(null);
  const write = !!v.inWas;
  const all = [...wiresOf(v.in, v.inWas, "in", write), ...wiresOf(v.out, v.outWas, "out", write)];
  const pinsOf = (side: Side) => uniq(all.filter((w) => w.side === side).map((w) => w.pin));
  const inPins = pinsOf("in").slice(0, MAX_PINS);
  const outPins = pinsOf("out").slice(0, MAX_PINS);
  const wires = all.filter((w) => (w.side === "in" ? inPins : outPins).includes(w.pin));
  const chansOf = (side: Side) => uniq(wires.filter((w) => w.side === side).map((w) => w.ch));
  const inChans = chansOf("in");
  const outChans = chansOf("out");
  const pinCount = (side: Side) => Math.max(side === "in" ? v.in.length : v.out.length, (side === "in" ? v.inWas : v.outWas)?.length ?? 0);
  const notDrawn = pinCount("in") - inPins.length + pinCount("out") - outPins.length;

  const pinName = (side: Side, p: number) => (side === "in" ? v.names?.[p] || `In ${p + 1}` : `Out ${p + 1}`);
  const chanState = (c: number) =>
    c > v.ch ? "off" : v.chWas !== undefined && c > v.chWas ? "new" : undefined;

  const rows = Math.max(inChans.length, inPins.length, outPins.length, outChans.length, 1);
  const H = rows * ROW;
  const yOf = (i: number, n: number) => ((rows - n) / 2 + i + 0.5) * ROW;
  // Columns in % of the width: channels, wire, the plugin (inputs | outputs), wire, channels
  const X = { chIn: 10, boxL: 28, boxR: 72, chOut: 90 };
  const wire = (x0: number, y0: number, x1: number, y1: number) => {
    const xm = (x0 + x1) / 2;
    return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1}`;
  };
  const path = (w: Wire) =>
    w.side === "in"
      ? wire(X.chIn + 1, yOf(inChans.indexOf(w.ch), inChans.length), X.boxL, yOf(inPins.indexOf(w.pin), inPins.length))
      : wire(X.boxR, yOf(outPins.indexOf(w.pin), outPins.length), X.chOut - 1, yOf(outChans.indexOf(w.ch), outChans.length));

  const touches = (w: Wire, f: Focus) => w.side === f.side && ("pin" in f ? w.pin === f.pin : w.ch === f.ch);
  const lit = (match: boolean) => (focus ? (match ? "on" : "off") : undefined);
  const wireLit = (w: Wire) => lit(!!focus && touches(w, focus));
  const pinLit = (side: Side, p: number) => lit(!!focus && wires.some((w) => touches(w, focus) && w.side === side && w.pin === p));
  const chanLit = (side: Side, c: number) => lit(!!focus && wires.some((w) => touches(w, focus) && w.side === side && w.ch === c));
  const hover = (f: Focus) => ({ onPointerEnter: () => setFocus(f), onPointerLeave: () => setFocus(null) });

  const tip = (f: Focus) => {
    const mine = wires.filter((w) => touches(w, f));
    const arrow = f.side === "in" ? "←" : "→";
    if ("pin" in f) return `${pinName(f.side, f.pin)} ${arrow} ${mine.map((w) => `channel ${w.ch}${WORD[w.state]}`).join(", ")}`;
    const chan = `Channel ${f.ch}${chanState(f.ch) === "new" ? " (new)" : chanState(f.ch) === "off" ? " (not on the track)" : ""}`;
    return `${chan} ${f.side === "in" ? "→" : "←"} ${mine.map((w) => `${pinName(w.side, w.pin)}${WORD[w.state]}`).join(", ")}`;
  };
  const tipY = (f: Focus) =>
    "pin" in f
      ? yOf((f.side === "in" ? inPins : outPins).indexOf(f.pin), (f.side === "in" ? inPins : outPins).length)
      : yOf((f.side === "in" ? inChans : outChans).indexOf(f.ch), (f.side === "in" ? inChans : outChans).length);

  const describe = (side: Side) =>
    wires.filter((w) => w.side === side).map((w) =>
      side === "in" ? `channel ${w.ch} into ${pinName("in", w.pin)}${WORD[w.state]}` : `${pinName("out", w.pin)} to channel ${w.ch}${WORD[w.state]}`,
    ).join(", ");
  const drawn = new Set(wires.map((w) => w.state));
  const chans = [...inChans, ...outChans];

  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Plugin" value={v.fx ? fxShort(v.fx) : "–"} />
        <Measurement.Readout label="Channels" value={v.chWas !== undefined && v.chWas !== v.ch ? `${v.chWas} → ${v.ch}` : String(v.ch)} />
      </div>
      {wires.length === 0 ? (
        <div className={chartStyles.evMore}>No pin is connected to a track channel</div>
      ) : (
        <>
          <div className={styles.heads} aria-hidden>
            <span>Track</span>
            <span className={styles.headFx}>{v.fx ? fxShort(v.fx) : "Plugin"}</span>
            <span>Track</span>
          </div>
          <div
            className={styles.patch}
            style={{ height: H }}
            role="img"
            aria-label={[describe("in"), describe("out")].filter(Boolean).join("; ")}
          >
            <span className={styles.box} style={{ left: `${X.boxL}%`, width: `${X.boxR - X.boxL}%` }} />
            <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden>
              {wires.map((w) => (
                <path
                  key={`${w.side}${w.pin}-${w.ch}`}
                  className={styles.wire}
                  data-state={w.state}
                  data-focus={wireLit(w)}
                  d={path(w)}
                  vectorEffect="non-scaling-stroke"
                  {...hover({ side: w.side, pin: w.pin })}
                />
              ))}
            </svg>
            {inChans.map((c, i) => (
              <span key={`ci${c}`} className={`${styles.chan} mono`} data-side="in" data-state={chanState(c)} data-focus={chanLit("in", c)}
                style={{ right: `${100 - X.chIn}%`, top: yOf(i, inChans.length) }} {...hover({ side: "in", ch: c })}>
                {c}
              </span>
            ))}
            {inPins.map((p, i) => (
              <span key={`pi${p}`} className={styles.pin} data-side="in" data-focus={pinLit("in", p)}
                style={{ left: `${X.boxL + 1.5}%`, top: yOf(i, inPins.length) }} {...hover({ side: "in", pin: p })}>
                {pinName("in", p)}
              </span>
            ))}
            {outPins.map((p, i) => (
              <span key={`po${p}`} className={styles.pin} data-side="out" data-focus={pinLit("out", p)}
                style={{ right: `${100 - X.boxR + 1.5}%`, top: yOf(i, outPins.length) }} {...hover({ side: "out", pin: p })}>
                {pinName("out", p)}
              </span>
            ))}
            {outChans.map((c, i) => (
              <span key={`co${c}`} className={`${styles.chan} mono`} data-side="out" data-state={chanState(c)} data-focus={chanLit("out", c)}
                style={{ left: `${X.chOut}%`, top: yOf(i, outChans.length) }} {...hover({ side: "out", ch: c })}>
                {c}
              </span>
            ))}
            {/* Centred over the patch at the hovered row's height, so it never runs off the drawer */}
            {focus && <PointTip left={50} top={(tipY(focus) / H) * 100}>{tip(focus)}</PointTip>}
          </div>
          {notDrawn > 0 && (
            <div className={chartStyles.evMore}>
              {notDrawn} {notDrawn === 1 ? "pin" : "pins"} not connected or not drawn
            </div>
          )}
        </>
      )}
      <Legend
        items={[
          ...(drawn.has("on") ? [[chartStyles.lgLine, "Connected"]] : []),
          ...(drawn.has("same") ? [[styles.lgSame, "Unchanged"]] : []),
          ...(drawn.has("new") ? [[chartStyles.lgLine, "Newly connected"]] : []),
          ...(drawn.has("gone") ? [[styles.lgGone, "Disconnected"]] : []),
          ...(chans.some((c) => chanState(c) === "new") ? [[styles.lgNewCh, "Channel added to the track"]] : []),
          ...(chans.some((c) => chanState(c) === "off") ? [[styles.lgOffCh, "Channel the track doesn't have"]] : []),
        ] as Array<[string, string]>}
      />
    </>
  );
}
