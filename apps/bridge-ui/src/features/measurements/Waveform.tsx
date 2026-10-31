import { useId, useState, type PointerEvent } from 'react';
import { PreviousLegend } from './Measurement.js';
import { Readout } from './Readout.js';
import { fmt, zoneOf } from './format.js';
import { parseParams, type CommandEntry, type Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './Waveform.module.css';

const WW = 320;
const WH = 84;
/** The waveform's dB scale: silence at the centre line, full scale at the edges */
const WAVE_FLOOR = -48;
const waveScale = (v: number) => {
  const a = Math.min(1, Math.abs(v));
  const h = a > 0 ? Math.max(0, (20 * Math.log10(a) - WAVE_FLOOR) / -WAVE_FLOOR) : 0;
  return v < 0 ? -h : h;
};
/** Distance from the top (0) to the centre (0.5) at which a level sits, for gradient stops and grid lines */
const waveOffset = (db: number) => (1 - (db - WAVE_FLOOR) / -WAVE_FLOOR) / 2;

/**
 * The rendered audio as min/max per slice, all channels, on a dB scale down to −48 dB so quiet material
 * still reads. Colored by level like the meters: accent, amber from −6 dB, red at full scale.
 */
export function Waveform({ m, entry, previous }: { m: Extract<Measurement, { kind: 'waveform' }>; entry: CommandEntry; previous: Extract<Measurement, { kind: 'waveform' }> | null }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const n = m.hi.length;
  const y = (v: number) => ((1 - waveScale(v)) / 2) * WH;
  const outline = (w: { hi: number[]; lo: number[] }) => {
    const at = (vals: number[]) => vals.map((v, i) => `${((i / (vals.length - 1)) * WW).toFixed(1)},${y(v).toFixed(1)}`);
    return `M${at(w.hi).join('L')}L${at(w.lo).reverse().join('L')}Z`;
  };
  const shape = outline(m);
  const p = parseParams(entry.p);
  const start = p && typeof p === 'object' && typeof (p as Record<string, unknown>).startTime === 'number' ? ((p as Record<string, unknown>).startTime as number) : 0;
  const end = start + (m.durationSeconds ?? 0);
  const clipped = (m.clipped ?? 0) > 0;
  /** A slice's peak in dBFS, the louder of its two sides */
  const peakAt = (w: { hi: number[]; lo: number[] }, i: number) => {
    const a = Math.max(Math.abs(w.hi[i] ?? 0), Math.abs(w.lo[i] ?? 0));
    return a > 0 ? 20 * Math.log10(a) : -150;
  };
  const onMove = (ev: PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.round(((ev.clientX - r.left) / r.width) * (n - 1)))));
  };
  const hx = hover === null ? 0 : (hover / (n - 1)) * WW;
  const hoverDb = hover === null ? 0 : peakAt(m, hover);
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Readout label="Peak" value={fmt(m.peakDb)} unit="dBFS" zone={clipped ? 'over' : zoneOf(m.peakDb)} word={clipped ? 'clipped' : undefined} />
        <Readout label="RMS" value={fmt(m.rmsDb)} unit="dBFS" />
        <Readout label="Clipped" value={String(m.clipped ?? '–')} unit="samples" zone={clipped ? 'over' : 'ok'} word={clipped ? '' : undefined} />
      </div>
      <div className={styles.waveform}>
        <svg viewBox={`0 0 ${WW} ${WH}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Waveform of the rendered audio, peak ${fmt(m.peakDb)} dBFS${clipped ? `, ${m.clipped} clipped samples` : ''}`}>
          <defs>
            <linearGradient id={`wave-heat-${uid}`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={0} y2={WH}>
              {[
                [0, 'bad'],
                [-1, 'warn'],
                [-6, 'warn'],
                [-18, 'accent'],
              ].flatMap(([db, c]) => {
                const o = waveOffset(db as number);
                return [<stop key={`t${db}`} offset={o} stopColor={`var(--${c})`} />, <stop key={`b${db}`} offset={1 - o} stopColor={`var(--${c})`} />];
              }).sort((a, b) => Number(a.props.offset) - Number(b.props.offset))}
            </linearGradient>
          </defs>
          {[-6, -18].flatMap((db) => [waveOffset(db), 1 - waveOffset(db)]).map((f) => (
            <line key={f} className={chartStyles.spectrumGrid} x1={0} x2={WW} y1={f * WH} y2={f * WH} vectorEffect="non-scaling-stroke" />
          ))}
          <line className={chartStyles.spectrumBase} x1={0} x2={WW} y1={WH / 2} y2={WH / 2} vectorEffect="non-scaling-stroke" />
          {previous && <path className={chartStyles.spectrumPrevious} d={outline(previous)} vectorEffect="non-scaling-stroke" />}
          <path className={styles.waveformShape} d={shape} fill={`url(#wave-heat-${uid})`} stroke={`url(#wave-heat-${uid})`} vectorEffect="non-scaling-stroke" />
          {hover !== null && <line className={chartStyles.spectrumCursor} x1={hx} x2={hx} y1={0} y2={WH} vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover !== null && (
          // Kept inside the chart near its edges
          <div className={cx(chartStyles.spectrumTip, 'mono')} style={{ left: `${Math.min(80, Math.max(20, (hx / WW) * 100))}%` }}>
            {(start + ((end - start) * hover) / (n - 1)).toFixed(2)} s · <span data-zone={hoverDb >= -0.01 ? 'over' : zoneOf(hoverDb)}>{fmt(hoverDb)} dBFS</span>
            {previous && previous.hi.length === n && <span className="muted"> (was {fmt(peakAt(previous, hover))})</span>}
          </div>
        )}
        {/* One label per half so they don't crowd */}
        {[-18, -6].map((db) => (
          <span key={db} className={cx(chartStyles.spectrumY, styles.waveformY, 'mono')} style={{ top: `${(db === -18 ? waveOffset(db) : 1 - waveOffset(db)) * 100}%` }}>
            {fmt(db, 0)}
          </span>
        ))}
      </div>
      <div className={cx(chartStyles.measureScaleWords, 'mono')}>
        <span>{start.toFixed(1)} s</span>
        <span>{end.toFixed(1)} s</span>
      </div>
      {previous && <PreviousLegend />}
    </>
  );
}

// ── Sidecar analysis (logged by the server with `_log_result`) ─────────────────
