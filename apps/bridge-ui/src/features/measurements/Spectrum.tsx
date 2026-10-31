import { useId, useState, type PointerEvent } from 'react';
import { PreviousLegend } from './Measurement.js';
import { Readout } from './Readout.js';
import { fmt, zoneOf, hzLabel } from './format.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './Spectrum.module.css';

const W = 320;
const H = 110;
const F_MIN = 20;
const F_MAX = 20_000;
const xOf = (hz: number) => (Math.log10(hz / F_MIN) / Math.log10(F_MAX / F_MIN)) * W;

/** 48 log-spaced bands (20 Hz – 20 kHz, loudest bin each): a hairline over a faint fill, the previous call ghosted */
export function Spectrum({ m, previous }: { m: Extract<Measurement, { kind: 'spectrum' }>; previous: number[] | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');
  const bands = m.bands;
  const n = bands.length;
  const centre = (b: number, count = n) => F_MIN * (F_MAX / F_MIN) ** ((b + 0.5) / count);
  const all = [...bands, ...(previous ?? [])];
  const top = Math.max(0, Math.ceil(Math.max(...all) / 12) * 12);
  const audible = all.filter((v) => v > -149);
  const floor = Math.max(-120, Math.min(top - 48, Math.floor(Math.min(...(audible.length ? audible : [top - 48])) / 24) * 24));
  const yOf = (v: number) => ((top - Math.max(floor, v)) / (top - floor)) * H;
  const grid = [floor + (top - floor) / 3, floor + ((top - floor) * 2) / 3].map(Math.round);
  const path = (vals: number[]) => `M${vals.map((v, b) => `${xOf(centre(b, vals.length)).toFixed(1)},${yOf(v).toFixed(1)}`).join('L')}`;
  const line = path(bands);
  const area = `${line}L${xOf(centre(n - 1)).toFixed(1)},${H}L${xOf(centre(0)).toFixed(1)},${H}Z`;

  const onMove = (ev: PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const b = Math.round(((ev.clientX - r.left) / r.width) * n - 0.5);
    setHover(Math.min(n - 1, Math.max(0, b)));
  };

  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Readout label="Peak" value={fmt(m.peakDb)} unit="dB" zone={zoneOf(m.peakDb)} />
        <Readout label="RMS" value={fmt(m.rmsDb)} unit="dB" />
        {m.fftSize !== undefined && <Readout label="FFT" value={String(m.fftSize)} />}
      </div>
      <div className={styles.spectrum}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Frequency spectrum, 20 Hz to 20 kHz">
          {/* Tied to the dB scale: accent up to −18 dB, amber by −6, red at 0 */}
          <defs>
            <linearGradient id={`spec-heat-${uid}`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={yOf(0)} y2={yOf(-18)}>
              <stop offset={0} stopColor="var(--bad)" />
              <stop offset={0.33} stopColor="var(--warn)" />
              <stop offset={1} stopColor="var(--accent)" />
            </linearGradient>
          </defs>
          {grid.map((d) => (
            <line key={d} className={chartStyles.spectrumGrid} x1={0} x2={W} y1={yOf(d)} y2={yOf(d)} vectorEffect="non-scaling-stroke" />
          ))}
          <line className={chartStyles.spectrumBase} x1={0} x2={W} y1={H} y2={H} vectorEffect="non-scaling-stroke" />
          {previous && <path className={chartStyles.spectrumPrevious} d={path(previous)} vectorEffect="non-scaling-stroke" />}
          <path className={styles.spectrumArea} d={area} fill={`url(#spec-heat-${uid})`} />
          <path className={styles.spectrumLine} d={line} stroke={`url(#spec-heat-${uid})`} vectorEffect="non-scaling-stroke" />
          {hover !== null && <line className={chartStyles.spectrumCursor} x1={xOf(centre(hover))} x2={xOf(centre(hover))} y1={0} y2={H} vectorEffect="non-scaling-stroke" />}
        </svg>
        {grid.map((d) => (
          <span key={d} className={cx(chartStyles.spectrumY, 'mono')} style={{ top: `${(yOf(d) / H) * 100}%` }}>
            {fmt(d, 0)}
          </span>
        ))}
        {hover !== null && (
          <div className={cx(chartStyles.spectrumTip, 'mono')} style={{ left: `${(xOf(centre(hover)) / W) * 100}%` }}>
            {hzLabel(centre(hover))} Hz · {fmt(bands[hover])} dB
            {previous && previous.length === n && <span className="muted"> (was {fmt(previous[hover])})</span>}
          </div>
        )}
      </div>
      <div className={cx(styles.spectrumX, 'mono')}>
        {[100, 1000, 10_000].map((hz) => (
          <span key={hz} style={{ left: `${(xOf(hz) / W) * 100}%` }}>
            {hzLabel(hz)}
          </span>
        ))}
      </div>
      {previous && <PreviousLegend />}
    </>
  );
}
