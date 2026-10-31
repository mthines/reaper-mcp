import type { CSSProperties } from 'react';
import type { EditView, Lane, LaneItem } from '../edit-views.js';
import { ChangeMark, Legend } from './ChangeLegend.js';
import { clock, pct, plural } from './format.js';
import { Measurement } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import mixerStyles from './Mixer.module.css';
import timelineStyles from './Timeline.module.css';
import styles from './Lanes.module.css';

/** One colour per lane, as automation pools have, so a comp's parts match the takes they came from */
const laneHue = (lane: number) => `var(--h${lane % 6})`;
const PLAYS_WORD = ["silent", "plays", "plays (layered)"];

/** Fixed lanes, one row each: their items, which lanes play, and for a comp where each part came from */
export function Lanes({ v }: { v: Extract<EditView, { kind: "lanes" }> }) {
  // Zoomed to the items, as takes rarely start at 0
  const all = [...v.items, ...(v.was?.items ?? [])];
  const from = all.length ? Math.min(...all.map((it) => it[0])) : 0;
  const len = Math.max(v.len, from + 1);
  const at = (t: number) => `${pct(t, from, len)}%`;
  const width = (s: number, l: number) => `calc(${pct(s + l, from, len) - pct(s, from, len)}% - 1px)`;
  const segAt = (pos: number) => v.segs?.find((s) => Math.abs(s[0] - pos) < 0.011);
  const playing = v.lanes.map((l, i) => [l, i] as const).filter(([l]) => l[1] > 0);
  const wasLanes = v.was?.lanes;
  const same = (a: LaneItem, b: LaneItem) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const gone = (v.was?.items ?? []).filter((w) => !v.items.some((it) => same(it, w)));
  const fresh = (it: LaneItem) => v.was !== undefined && !v.was.items.some((w) => same(w, it));
  const laneName = (l: Lane | undefined, i: number) => (l && l[0]) || `Lane ${i + 1}`;
  const rows = Math.max(v.lanes.length, wasLanes?.length ?? 0);
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Track" value={v.t} />
        <Measurement.Readout label="Lanes" value={v.fixed ? String(v.lanes.length + (v.more ?? 0)) : "off"}
          word={v.was && v.was.fixed !== v.fixed ? (v.fixed ? "turned on" : "turned off") : ""} />
        <Measurement.Readout label="Playing" value={playing.length === 0 ? "–" : playing.length === 1 ? laneName(playing[0][0], playing[0][1]) : `${playing.length} lanes`}
          word={playing.length > 1 ? "layered" : ""} title={playing.map(([l, i]) => laneName(l, i)).join(" + ") || undefined} />
      </div>
      <div className={styles.lanes}>
        {Array.from({ length: rows }, (_, i) => {
          const lane = v.lanes[i];
          const was = wasLanes?.[i];
          const plays = lane?.[1] ?? 0;
          const playsChanged = was !== undefined && lane !== undefined && was[1] !== plays;
          const isComp = v.comp === i;
          return (
            <div key={i} className={cx(styles.lane, !!plays && styles.on, !lane && styles.gone)}>
              <span className={styles.name} style={{ "--hue": laneHue(i) } as CSSProperties}
                title={`${laneName(lane ?? was, i)} · ${PLAYS_WORD[plays]}${playsChanged ? ` (was ${PLAYS_WORD[was[1]]})` : ""}`}>
                <i className={cx(styles.play, playsChanged && styles.changed)} data-plays={plays} aria-hidden />
                <span className={mixerStyles.evTnText}>{laneName(lane ?? was, i)}</span>
                {isComp && <ChangeMark c="new" />}
              </span>
              <span className={cx(timelineStyles.evLane, timelineStyles.evLaneItems)}>
                {gone.filter((it) => it[2] === i).map((it, k) => (
                  <span key={`g${k}`} className={cx(timelineStyles.evItem, timelineStyles.evGone)} style={{ left: at(it[0]), width: width(it[0], it[1]) }}
                    title={`Before · ${clock(it[0], 1)}–${clock(it[0] + it[1], 1)}`} />
                ))}
                {v.items.filter((it) => it[2] === i).map((it, k) => {
                  const seg = isComp ? segAt(it[0]) : undefined;
                  const hue = laneHue(seg ? seg[2] : i);
                  return (
                    <span key={k} className={cx(timelineStyles.evItem, styles.item, !!it[3] && timelineStyles.evItemMidi, fresh(it) && !isComp && timelineStyles.evNew)}
                      style={{ left: at(it[0]), width: width(it[0], it[1]), "--hue": hue } as CSSProperties}
                      title={`${seg ? `From ${laneName(v.lanes[seg[2]], seg[2])} · ` : ""}${clock(it[0], 1)}–${clock(it[0] + it[1], 1)}`} />
                  );
                })}
              </span>
            </div>
          );
        })}
        <div className={cx(styles.lane, styles.axisRow)} aria-hidden>
          <span />
          <span className={cx(styles.axis, 'mono')}><span>{clock(from)}</span><span>{clock(len)}</span></span>
        </div>
      </div>
      {v.more !== undefined && v.more > 0 && <div className={chartStyles.evMore}>+{plural(v.more, "more lane")} not drawn</div>}
      {v.was && (gone.length > 0 || v.lanes.some((l, i) => wasLanes?.[i] && wasLanes[i][1] !== l[1])) && (
        <Legend items={[[chartStyles.lgGoneMark, "Before"], [chartStyles.lgNewMark, "Added or changed"]]} />
      )}
    </>
  );
}
