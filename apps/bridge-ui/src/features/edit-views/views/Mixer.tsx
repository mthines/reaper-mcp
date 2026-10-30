import { listDiff, type EditView, type SlotChange, type MixRow } from '../edit-views.js';
import { ChangeLegend, ChangeMark } from './ChangeLegend.js';
import { CHANGE_WORD, changedText, panText, pct, plural } from './format.js';
import { Readout } from '../../measurements/Readout.js';
import { fmt } from '../../measurements/format.js';

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
