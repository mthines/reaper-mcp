import type { EditView, ModRow } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { fxShort, plain } from './format.js';
import { Measurement } from '../../measurements/index.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Modulation.module.css';

const MW = 400;
const MH = 64;
const LFO_SHAPE: Record<string, (x: number) => number> = {
  sine: (x) => Math.sin(x * 2 * Math.PI),
  square: (x) => (x % 1 < 0.5 ? 1 : -1),
  saw_down: (x) => 1 - 2 * (x % 1),
  saw_up: (x) => 2 * (x % 1) - 1,
  triangle: (x) => 1 - 4 * Math.abs((x % 1) - 0.5),
  // Random steps, the same every render
  random: (x) => Math.sin(Math.floor(x * 8) * 12.9898) * 0.9,
};

/** Two LFO cycles around the baseline: direction 1 moves up from it, -1 down, 0 around it */
function lfoPath(row: ModRow): string {
  if (!row.lfo) return "";
  const [shape, , strength, phase, dir] = row.lfo;
  const f = LFO_SHAPE[shape] ?? LFO_SHAPE.sine;
  const pts: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * 2 + phase;
    const w = f(x);
    const v = dir > 0 ? row.base + strength * (w + 1) / 2 : dir < 0 ? row.base - strength * (w + 1) / 2 : row.base + strength * w / 2;
    const y = MH - Math.min(1, Math.max(0, v)) * MH;
    pts.push(`${i === 0 ? "M" : "L"}${((i / 120) * MW).toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join("");
}

/** The range an audio control signal can move the value over */
function acsBand(row: ModRow): [number, number] | null {
  if (!row.acs) return null;
  const strength = row.acs[4];
  const dir = row.acs[6];
  const lo = dir > 0 ? row.base : dir < 0 ? row.base - strength : row.base - strength / 2;
  return [Math.max(0, lo), Math.min(1, lo + strength)];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const sourcesText = (r: ModRow) =>
  [r.lfo && "LFO", r.acs && "audio", r.link && "link"].filter(Boolean).join(" + ") || "baseline only";

export function Modulation({ v }: { v: Extract<EditView, { kind: "modulation" }> }) {
  const write = v.rows.some((r) => r.was !== undefined);
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Plugin" value={v.fx ? fxShort(v.fx) : "–"} />
        {!write && <Measurement.Readout label="Modulated" value={String(v.total ?? v.rows.length)} unit="params" />}
      </div>
      {v.rows.length === 0 ? (
        <div className={chartStyles.evMore}>No parameter of this FX is modulated</div>
      ) : (
        <div className={styles.mods}>
          {v.rows.map((r, i) => (
            <ModulationRow key={i} r={r} />
          ))}
        </div>
      )}
      {v.rows.some((r) => !r.off) && (
        <Legend
          items={[
            [styles.lgBaseline, "Baseline (the setting's own value)"],
            ...(v.rows.some((r) => r.lfo) ? [[chartStyles.lgLine, "LFO swing"] as [string, string]] : []),
            ...(v.rows.some((r) => r.acs) ? [[styles.lgBand, "Audio follower range"] as [string, string]] : []),
            ...(v.rows.some((r) => r.was && (r.was.lfo || r.was.base !== r.base)) ? [[chartStyles.lgPrevious, "Before"] as [string, string]] : []),
          ]}
        />
      )}
    </>
  );
}

function ModulationRow({ r }: { r: ModRow }) {
  const was = r.was || null;
  const band = acsBand(r);
  const y = (val: number) => MH - Math.min(1, Math.max(0, val)) * MH;
  const label = r.off ? "Modulation off" : sourcesText(r);
  return (
    <div>
      <div className={styles.head}>
        <span className={styles.name} title={r.p}>{r.p}</span>
        <span className={`${styles.src} mono`}>
          {was ? <>{sourcesText(was)} → <b>{label}</b></> : <b>{label}</b>}
        </span>
      </div>
      {!r.off && (
        <svg viewBox={`0 0 ${MW} ${MH}`} preserveAspectRatio="none" className={styles.svg} role="img"
          aria-label={`${r.p}: ${label}, baseline ${Math.round(r.base * 100)}%`}>
          {band && <rect className={styles.band} x={0} width={MW} y={y(band[1])} height={Math.max(1, y(band[0]) - y(band[1]))} />}
          {was?.lfo && <path className={styles.was} d={lfoPath(was)} vectorEffect="non-scaling-stroke" />}
          {was && !was.off && <line className={styles.was} x1={0} x2={MW} y1={y(was.base)} y2={y(was.base)} vectorEffect="non-scaling-stroke" />}
          <line className={styles.base} x1={0} x2={MW} y1={y(r.base)} y2={y(r.base)} vectorEffect="non-scaling-stroke" />
          {r.lfo && <path className={styles.lfo} d={lfoPath(r)} vectorEffect="non-scaling-stroke" />}
        </svg>
      )}
      <div className={`${styles.facts} mono`}>
        {!r.off && <span>Baseline {Math.round(r.base * 100)}%</span>}
        {r.lfo && (
          <>
            <span>{cap(r.lfo[0].replace("_", " "))} LFO</span>
            <span title={r.lfo[5] ? "Cycle length in quarter notes, synced to the tempo" : "Cycles per second"}>
              {r.lfo[5] ? `${plain(r.lfo[1])} QN cycle` : `${plain(r.lfo[1])} Hz`}
            </span>
            <span>Depth {Math.round(r.lfo[2] * 100)}%</span>
          </>
        )}
        {r.acs && (
          <>
            <span>Follows channel {r.acs[5]}</span>
            <span>{plain(r.acs[2])} to {plain(r.acs[3])} dB</span>
            <span title="Attack / release">{plain(r.acs[0])} / {plain(r.acs[1])} ms</span>
          </>
        )}
        {r.link && (
          <span title={`Linked to ${r.link[0]}`}>
            ← {r.link[0]} × {plain(r.link[1])}{r.link[2] ? ` ${r.link[2] > 0 ? "+" : "−"} ${plain(Math.abs(r.link[2]))}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
