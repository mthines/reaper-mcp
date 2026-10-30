import { useState, type MouseEvent, type ReactNode } from 'react';
import { HISTORY_MAX } from '../../lib/status.js';

const SPARK_W = 100;
const SPARK_H = 24;

/**
 * Last-minute trend, one slot per second, newest on the right. `floor` is the minimum y-range
 * so quiet periods read as a flat baseline instead of noise blown up to full height.
 * Counts render as bars; the line variant connects across seconds with no data (null).
 * Hover shows the value at that second; the guide/dot are HTML so they don't stretch with the SVG.
 */
export function Sparkline({
  values,
  floor,
  tone,
  label,
  format,
  variant = 'line',
}: {
  values: Array<number | null>;
  floor: number;
  tone: 'accent' | 'bad' | 'warn' | 'muted';
  label: string;
  format: (v: number) => string;
  variant?: 'line' | 'bars';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const slots = HISTORY_MAX - 1;
  const max = Math.max(floor, ...values.map((v) => v ?? 0)) * 1.15;
  const slotW = SPARK_W / slots;
  const offset = slots - values.length;
  const y = (v: number) => SPARK_H - 1 - (v / max) * (SPARK_H - 3);

  const onMove = (ev: MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const i = Math.floor(((ev.clientX - rect.left) / rect.width) * slots) - offset;
    if (i < 0 || i >= values.length) return setHover(null);
    if (variant === 'bars' || values[i] !== null) return setHover(i);
    // The line is drawn through empty seconds, so snap to the nearest real point
    let best: number | null = null;
    values.forEach((v, j) => {
      if (v !== null && (best === null || Math.abs(j - i) < Math.abs(best - i))) best = j;
    });
    setHover(best);
  };

  let body: ReactNode;
  if (variant === 'bars') {
    body = values.map((v, i) =>
      v ? (
        <rect
          key={i}
          className={`spark-bar ${hover === i ? 'spark-bar-hover' : ''}`}
          x={(offset + i) * slotW + slotW * 0.15}
          width={slotW * 0.7}
          y={y(v)}
          height={SPARK_H - y(v)}
          rx={0.4}
        />
      ) : null,
    );
  } else {
    const pts = values.flatMap((v, i) => (v === null ? [] : [[(offset + i + 0.5) * slotW, y(v)] as const]));
    if (pts.length > 0) {
      const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`).join('');
      body = <path className="spark-line" d={pts.length > 1 ? line : `M${pts[0][0]},${pts[0][1]}h0.01`} />;
    }
  }

  const hv = hover === null ? undefined : values[hover];
  const leftPct = hover === null ? 0 : ((offset + hover + 0.5) / slots) * 100;
  const ago = hover === null ? 0 : values.length - 1 - hover;
  const tipAlign = leftPct < 18 ? 'start' : leftPct > 82 ? 'end' : 'center';

  return (
    <div className={`spark-wrap spark-${tone}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg className="spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" role="img" aria-label={`${label}, last minute`}>
        <line className="spark-base" x1="0" x2={SPARK_W} y1={SPARK_H - 0.5} y2={SPARK_H - 0.5} />
        {body}
      </svg>
      {hover !== null && (
        <>
          <span className="spark-guide" style={{ left: `${leftPct}%` }} />
          {variant === 'line' && hv != null && (
            <span className="spark-dot" style={{ left: `${leftPct}%`, top: `${(y(hv) / SPARK_H) * 100}%` }} />
          )}
          <span className={`spark-tip spark-tip-${tipAlign}`} style={{ left: `${leftPct}%` }}>
            <b>{hv == null ? 'no commands' : format(hv)}</b>
            <span>{ago === 0 ? 'now' : `${ago}s ago`}</span>
          </span>
        </>
      )}
    </div>
  );
}
