import { Counts } from './Counts.js';
import { listDiff, type EditView, type SlotChange, type MixRow } from '../edit-views.js';
import { ChangeLegend, ChangeMark } from './ChangeLegend.js';
import { HoverTip } from './HoverTip.js';
import { CHANGE_WORD, panText, panWords, pct, plural } from './format.js';
import { Measurement, fmt } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Mixer.module.css';

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
  const states = [["M", "muted"], ["S", "soloed"], ["R", "armed"]].filter(([f]) => flags.includes(f)).map(([, word]) => word);
  return (
    <div
      className={cx(styles.evTrk, master && styles.evTrkMaster, flags.includes("M") && styles.evTrkMuted)}
      data-change={gone ? "gone" : c}
      title={`${name} · ${fmt(db)} dB · pan ${panText(pan)}${gone ? " · removed" : c ? ` · ${CHANGE_WORD[c]}` : ""}`}
    >
      <span
        className={styles.evSw}
        style={{
          background: master ? "var(--line-2)" : color || "var(--line-2)",
        }}
      />
      <span
        className={cx(styles.evTn, folder ? styles.evTnFolder : '')}
        style={{ paddingLeft: `${Math.min(depth, 4) * 12}px` }}
      >
        <span className={styles.evTnText}>
          {folder ? "▾ " : ""}
          {name}
        </span>
        {gone ? (
          <span className={styles.evMark} data-change="gone">removed</span>
        ) : (
          <ChangeMark c={c} />
        )}
      </span>
      <HoverTip
        className={cx(chartStyles.evBar, styles.evFader)}
        role="img"
        aria-label={`${name} ${fmt(db)} dB`}
        tip={`Volume ${fmt(db)} dB`}
      >
        <span className={chartStyles.evZero} style={{ left: `${pct(0, -60, 6)}%` }} />
        <span
          className={cx(chartStyles.evFill, hot ? styles.evFillHot : '')}
          style={{ left: 0, width: `${pct(db, -60, 6)}%` }}
        />
      </HoverTip>
      <span className={cx(styles.evTv, "mono")} data-zone={hot ? "hot" : "ok"}>{fmt(db)}</span>
      <HoverTip className={styles.evPan} role="img" aria-label={`pan ${panText(pan)}`} tip={`Pan ${panWords(pan)}`}>
        <span className={styles.evPanC} />
        <span className={styles.evPanD} style={{ left: `${pct(pan, -1, 1)}%` }} />
      </HoverTip>
      <span
        className={styles.evChips}
        aria-label={states.length ? states.join(", ") : undefined}
      >
        {(["M", "S", "R"] as const).map((f) => (
          <span
            key={f}
            className={styles.evChip}
            data-chip={flags.includes(f) ? f.toLowerCase() : undefined}
          >
            {f}
          </span>
        ))}
      </span>
    </div>
  );
}

const CHIP_WORD = { M: "muted", S: "soloed", R: "armed" } as const;

/** Names the lit M / S / R chips, only those some row shows */
export function ChipLegend({ flags }: { flags: string[] }) {
  const lit = (["M", "S", "R"] as const).filter((f) => flags.some((x) => x.includes(f)));
  if (!lit.length) return null;
  return (
    <div className={chartStyles.measureLegend}>
      {lit.map((f) => (
        <span key={f}>
          <span className={styles.evChip} data-chip={f.toLowerCase()}>{f}</span> {CHIP_WORD[f]}
        </span>
      ))}
    </div>
  );
}

export function Mixer({ v }: { v: Extract<EditView, { kind: "mixer" }> }) {
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
        <div className={chartStyles.measureReadouts}>
          <Measurement.Readout label="Tracks" value={String(v.total)} />
          <Counts added={added} removed={d.removed.length} changed={d.change.size} />
        </div>
      )}
      {(v.from ?? 0) > 0 && <div className={chartStyles.evMore}>{plural(v.from ?? 0, "track")} above</div>}
      <div className={styles.evMix}>
        {v.tracks.map((t, i) => (
          <MixerRow key={ids[i] ?? i} row={t} c={d.change.get(i)} />
        ))}
        {d.removed.map(([i, t]) => (
          <MixerRow key={`gone${i}`} row={t[1]} gone />
        ))}
        {v.master && <MixerRow row={v.master} master />}
      </div>
      {was && <ChangeLegend change={d.change} removed={d.removed.length} />}
      <ChipLegend flags={[...v.tracks, ...(v.master ? [v.master] : [])].map((t) => t[5])} />
      {v.total > (v.from ?? 0) + v.tracks.length && (
        <div className={chartStyles.evMore}>
          +{v.total - (v.from ?? 0) - v.tracks.length} more tracks not drawn
        </div>
      )}
    </>
  );
}

// ── Plan ─────────────────────────────────────────────────────────────────────
