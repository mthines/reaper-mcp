import type { EditView } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { clock, plural } from './format.js';
import { Measurement } from '../../measurements/index.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Stretch.module.css';

const SW = 400;
const SH = 56;

/** A marker at t in the list (within half a millisecond) */
const near = (list: number[] | undefined, t: number) => (list ?? []).some((m) => Math.abs(m - t) < 0.0005);

export function Stretch({ v }: { v: Extract<EditView, { kind: "stretch" }> }) {
  const x = (t: number) => (Math.min(v.len, Math.max(0, t)) / v.len) * SW;
  const moves = v.moves ?? [];
  const moved = moves.filter(([a, b]) => Math.abs(a - b) > 0.0005).length;
  const legend = [
    ...(v.grid?.length ? [[styles.lgGrid, "Grid line"]] : []),
    ...(v.marks && v.was
      ? [
          ...(v.marks.some((t) => near(v.was, t)) ? [[styles.lgKept, "Kept"]] : []),
          ...(v.marks.some((t) => !near(v.was, t)) ? [[chartStyles.lgTick, "Added"]] : []),
          ...(v.was.some((t) => !near(v.marks, t)) ? [[chartStyles.lgWas, "Removed"]] : []),
        ]
      : [
          ...(moved > 0 ? [[chartStyles.lgWas, "Before"]] : []),
          [chartStyles.lgTick, moves.length ? "Now" : "Marker"],
          ...(moved > 0 ? [[styles.lgMove, "Moved"]] : []),
        ]),
  ] as Array<[string, string]>;
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        {v.off ? (
          <>
            <Measurement.Readout label="Hits moved" value={`${moved} of ${moves.length + (v.more ?? 0)}`} />
            <Measurement.Readout label="Timing off" title="Average distance of the hits from the grid" value={`${Math.round(v.off[0])} → ${Math.round(v.off[1])}`} unit="ms" zone={v.off[1] > 10 ? "hot" : "ok"} word="" />
          </>
        ) : (
          <Measurement.Readout label="Markers" value={v.was ? `${v.was.length} → ${(v.marks ?? []).length}` : String((v.marks ?? []).length)} />
        )}
        <Measurement.Readout label="Item length" value={clock(v.len, 2)} />
      </div>
      <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" className={styles.stretch} role="img"
        aria-label={v.off ? `${moved} hits moved toward the grid` : `${(v.marks ?? []).length} stretch markers`}>
        <rect className={styles.item} x={0} y={8} width={SW} height={SH - 16} rx={3} />
        {(v.grid ?? []).map((g, i) => (
          <line key={`g${i}`} className={styles.grid} x1={x(g)} x2={x(g)} y1={8} y2={SH - 8} vectorEffect="non-scaling-stroke" />
        ))}
        {(v.was ?? []).filter((t) => !near(v.marks, t)).map((t, i) => (
          <line key={`w${i}`} className={styles.was} x1={x(t)} x2={x(t)} y1={4} y2={SH - 4} vectorEffect="non-scaling-stroke" />
        ))}
        {moves.map(([from, to], i) => (
          <g key={`m${i}`}>
            {Math.abs(from - to) > 0.0005 && <line className={styles.was} x1={x(from)} x2={x(from)} y1={4} y2={SH - 4} vectorEffect="non-scaling-stroke" />}
            {Math.abs(from - to) > 0.0005 && <line className={styles.move} x1={x(from)} x2={x(to)} y1={SH / 2} y2={SH / 2} vectorEffect="non-scaling-stroke" />}
            <line className={styles.mark} x1={x(to)} x2={x(to)} y1={4} y2={SH - 4} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {(v.marks ?? []).map((t, i) => (
          <line key={`k${i}`} className={v.was && near(v.was, t) ? styles.kept : styles.mark} x1={x(t)} x2={x(t)} y1={4} y2={SH - 4} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {(v.more ?? 0) > 0 && <div className={chartStyles.evMore}>+{plural(v.more ?? 0, "more marker")} not drawn</div>}
      <Legend items={legend} />
    </>
  );
}
