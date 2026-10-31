import type { CSSProperties } from 'react';
import { fittingLabels, timelineDiff, type EditView, type Item, type Marker, type Region, type Tempo } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { EW } from './Envelope.js';
import { clock, hueOf, pct } from './format.js';
import { useWidth } from '../../../lib/useWidth.js';
import { Measurement } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import envelopeStyles from './Envelope.module.css';
import styles from './Timeline.module.css';

export function Timeline({ v }: { v: Extract<EditView, { kind: "timeline" }> }) {
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
  const quiet = (i: number) => !(!context && labelled.has(i));
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
        <div className={chartStyles.measureReadouts}>
          <Measurement.Readout label="Selection" value={v.sel ? clock(v.sel[0], 1) : "none"} />
          <Measurement.Readout label="End" value={v.sel ? clock(v.sel[1], 1) : "–"} />
          <Measurement.Readout
            label="Length"
            value={v.sel ? (v.sel[1] - v.sel[0]).toFixed(1) : "–"}
            unit={v.sel ? "s" : undefined}
          />
          <Measurement.Readout label="Cursor" value={clock(v.cur ?? 0, 1)} />
        </div>
      ) : v.lanes ? (
        <div className={chartStyles.measureReadouts}>
          <Measurement.Readout
            label="Items"
            value={String(lanes.reduce((n, l) => n + l.items.length, 0))}
          />
          {itemWrite ? (
            <Measurement.Readout label="Changed" value={`+${itemsAdded} −${itemsRemoved}`} />
          ) : (
            <Measurement.Readout
              label="MIDI"
              value={String(lanes.reduce((n, l) => n + l.items.filter((it) => it[4]).length, 0))}
            />
          )}
          <Measurement.Readout label={lanes.length > 1 ? "Tracks" : "Track"} value={lanes.map((l) => l.t).join(", ")} />
        </div>
      ) : (
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout
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
        <Measurement.Readout label="Time sig" value={sig} />
        {v.was ? (
          <Measurement.Readout label="Changed" value={`+${changed} −${removed}`} />
        ) : (
          <>
            <Measurement.Readout label="Regions" value={String(v.regions.length)} />
            <Measurement.Readout label="Markers" value={String(v.markers.length)} />
          </>
        )}
      </div>
      )}
      <div className={styles.evTimeline} ref={laneRef}>
        {v.wasSel && (
          <span
            className={cx(styles.evSel, styles.evSelWas)}
            style={{ left: at(v.wasSel[0]), width: `${pct(v.wasSel[1], 0, len) - pct(v.wasSel[0], 0, len)}%` }}
            title={`Selection before: ${clock(v.wasSel[0], 1)}–${clock(v.wasSel[1], 1)}`}
          />
        )}
        {v.sel && (
          <span
            className={styles.evSel}
            style={{ left: at(v.sel[0]), width: `${pct(v.sel[1], 0, len) - pct(v.sel[0], 0, len)}%` }}
            title={`Selection ${clock(v.sel[0], 1)}–${clock(v.sel[1], 1)}`}
          />
        )}
        {v.wasCur !== undefined && v.wasCur !== v.cur && (
          <span className={cx(styles.evCur, styles.evCurWas)} style={{ left: at(v.wasCur) }} title={`Cursor before: ${clock(v.wasCur, 1)}`} />
        )}
        {v.cur !== undefined && (
          <span className={styles.evCur} style={{ left: at(v.cur) }} title={`Cursor ${clock(v.cur, 1)}`} />
        )}
        {(v.markers.length > 0 || markers.removed.length > 0) && (
          <div className={cx(styles.evLane, styles.evLaneMarkers, context ? styles.evLaneContext : '')}>
            {markers.removed.map((m, i) => (
              <span
                key={`r${m[3]}${m[0]}`}
                className={cx(styles.evMarker, styles.evGone, quiet(i) && styles.evQuiet)}
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
                className={cx(styles.evMarker, markers.added.has(m) && styles.evNew, quiet(markers.removed.length + i) && styles.evQuiet)}
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
        <div className={cx(styles.evLane, styles.evLaneRegions)}>
          {regions.removed.map((r) => (
            <span
              key={`r${r[4]}${r[0]}`}
              className={cx(styles.evRegion, styles.evGone)}
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
              className={cx(styles.evRegion, regions.added.has(r) ? styles.evNew : '')}
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
      <div className={cx(chartStyles.measureScaleWords, 'mono')}>
        <span>0:00</span>
        <span>{clock(len / 2)}</span>
        <span>{clock(len)}</span>
      </div>
      {(itemsAdded > 0 || itemsRemoved > 0) && (
        <Legend
          items={[
            [chartStyles.lgNewMark, "Added or changed"],
            [chartStyles.lgGoneMark, "Before"],
          ]}
        />
      )}
      {time && (v.wasSel !== undefined || v.wasCur !== undefined) && (
        <Legend
          items={[
            [chartStyles.lgSel, "Now"],
            [chartStyles.lgGoneMark, "Before"],
          ]}
        />
      )}
      {v.was && (changed > 0 || removed > 0) && (
        <Legend
          items={[
            [chartStyles.lgNewMark, "Added or changed"],
            [chartStyles.lgGoneMark, "Removed"],
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
    <div className={styles.evTempo}>
      <span className={cx(styles.evTempoLabel, 'mono')}>tempo</span>
      <svg
        viewBox={`0 0 ${EW} ${TH}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Tempo from ${Math.min(...bpms)} to ${Math.max(...bpms)} BPM`}
      >
        {removed.length > 0 && (
          <path
            className={chartStyles.spectrumPrevious}
            d={path([...tempo.filter((t) => !added.has(t)), ...removed])}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          className={envelopeStyles.evEnvLine}
          d={path(tempo)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {tempo.map((t, i) => (
        <span
          key={i}
          className={cx(envelopeStyles.evDot, added.has(t) ? envelopeStyles.evDotNew : '')}
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
    <div className={styles.evLaneWrap}>
      {name && <div className={styles.evLaneName}>{name}</div>}
      <div className={cx(styles.evLane, styles.evLaneItems)}>
        {removed.map((it, i) => (
          <span
            key={`gone${i}`}
            className={cx(styles.evItem, styles.evGone)}
            style={{ left: at(it[0]), width: width(it) }}
            title={`Before · ${clock(it[0], 1)}–${clock(it[0] + it[1], 1)}`}
          />
        ))}
        {items.map((it, i) => (
          <span
            key={i}
            className={cx(styles.evItem, it[4] ? styles.evItemMidi : '', it[5] ? styles.evItemMuted : '', added.has(it) ? styles.evNew : '')}
            style={{ left: at(it[0]), width: width(it) }}
            title={`${it[4] ? "MIDI" : "Audio"} item · ${clock(it[0], 1)}–${clock(it[0] + it[1], 1)}${it[5] ? " · muted" : ""}`}
          >
            {it[2] > 0 && (
              <i className={styles.evFadeIn} style={{ width: `${(it[2] / it[1]) * 100}%` }} />
            )}
            {it[3] > 0 && (
              <i className={styles.evFadeOut} style={{ width: `${(it[3] / it[1]) * 100}%` }} />
            )}
          </span>
        ))}
        {items.length === 0 && removed.length === 0 && (
          <span className={cx(chartStyles.evMore, styles.evLaneEmpty)}>No items</span>
        )}
      </div>
    </div>
  );
}
