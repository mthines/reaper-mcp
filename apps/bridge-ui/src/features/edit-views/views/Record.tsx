import type { EditView, RecordRow } from '../edit-views.js';
import { clock, plural } from './format.js';
import { Measurement } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import mixerStyles from './Mixer.module.css';
import styles from './Record.module.css';

const RECORD_MODE: Record<string, string> = { normal: "Normal", time_selection: "Punch: time", selected_items: "Punch: items" };
const PUNCH_ON: Record<string, string> = { time_selection: "time selection", selected_items: "selected items" };
const MODE_WORD: Record<string, string> = {
  input: "input", none: "monitor only", stereo_out: "output (stereo)", stereo_out_latency: "output (stereo, latency comp.)",
  mono_out: "output (mono)", mono_out_latency: "output (mono, latency comp.)", midi_out: "MIDI output",
  midi_overdub: "MIDI overdub", midi_replace: "MIDI replace", midi_touch_replace: "MIDI touch-replace",
  midi_latch_replace: "MIDI latch-replace", multichannel_out: "output (multichannel)",
  multichannel_out_latency: "output (multichannel, latency comp.)", input_mono: "input (mono)",
  input_stereo: "input (stereo)", input_multichannel: "input (multichannel)", input_midi: "input (MIDI)",
};
const punchText = (p?: [number, number]) => (p ? `${clock(p[0])}–${clock(p[1])}` : "–");

/** Record setup: the global mode and, per track, arm, input, monitoring and record mode; a write shows what it was */
export function Record({ v }: { v: Extract<EditView, { kind: "record" }> }) {
  const was = v.was;
  const changed = (a: unknown, b: unknown) => was !== undefined && a !== b;
  const wasRows = new Map((was?.rows ?? []).map((r) => [r[0], r]));
  const modeChanged = changed(was?.mode, v.mode);
  const punchChanged = was !== undefined && punchText(was.punch) !== punchText(v.punch);
  const pathChanged = changed(was?.path, v.path);
  const rows = v.rows ?? [];
  const rowChanged = rows.some((r) => {
    const w = wasRows.get(r[0]);
    return w && w.some((x, i) => x !== r[i]);
  });
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Mode" value={RECORD_MODE[v.mode] ?? v.mode} word={modeChanged ? "new" : ""}
          title={[PUNCH_ON[v.mode] && `Auto-punch on the ${PUNCH_ON[v.mode]}`, modeChanged && was && `Was ${RECORD_MODE[was.mode] ?? was.mode}`].filter(Boolean).join(" · ") || undefined} />
        {(v.mode === "time_selection" || v.punch) && (
          <Measurement.Readout label="Punch" value={punchText(v.punch)} word={punchChanged ? "new" : !v.punch ? "none" : ""}
            zone={!v.punch ? "hot" : "ok"}
            title={punchChanged ? `Was ${punchText(was?.punch)}` : !v.punch ? "No time selection: nothing records" : undefined} />
        )}
        {v.path !== undefined && (
          <Measurement.Readout label="Path" value={v.path || "project folder"} word={pathChanged ? "new" : ""}
            title={pathChanged ? `Was ${was?.path || "project folder"}` : undefined} />
        )}
      </div>
      {v.rows && (rows.length === 0 ? (
        <div className={chartStyles.evMore}>No armed tracks</div>
      ) : (
        <div className={mixerStyles.evMix}>
          {rows.map((r, i) => <RecordTrack key={i} r={r} was={wasRows.get(r[0])} />)}
        </div>
      ))}
      {v.more !== undefined && v.more > 0 && <div className={chartStyles.evMore}>+{plural(v.more, "more track")} not drawn</div>}
      {rowChanged && <div className={chartStyles.evMore}>Changed values are underlined, with what they were beneath</div>}
    </>
  );
}

function RecordTrack({ r, was }: { r: RecordRow; was?: RecordRow }) {
  const [name, armed, input, monitor, mode] = r;
  const field = (i: 2 | 3 | 4, text: string, cls: string | undefined, wasText: (w: RecordRow) => string) => {
    const old = was && was[i] !== r[i] ? wasText(was) : null;
    return (
      <span className={cx(styles.field, cls, old !== null && styles.changed)} title={old !== null ? `${text} · was ${old}` : text}>
        <span className={styles.now}>{text}</span>
        {old !== null && <s className={styles.was}>{old}</s>}
      </span>
    );
  };
  const armChanged = was !== undefined && was[1] !== armed;
  return (
    <div className={cx(styles.rec, !armed && styles.off)}
      title={`${name} · ${armed ? "armed" : "not armed"}${armChanged ? (armed ? " (was not armed)" : " (was armed)") : ""}`}>
      <span className={cx(styles.arm, !!armed && styles.on, armChanged && styles.changed)} role="img" aria-label={armed ? "armed" : "not armed"} />
      <span className={mixerStyles.evTn}><span className={cx(mixerStyles.evTnText, styles.name)}>{name}</span></span>
      {field(2, input, styles.input, (w) => w[2])}
      {field(3, `mon ${monitor}`, undefined, (w) => `mon ${w[3]}`)}
      {field(4, MODE_WORD[mode] ?? mode, styles.mode, (w) => MODE_WORD[w[4]] ?? w[4])}
    </div>
  );
}
