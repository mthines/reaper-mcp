import { useState, type PointerEvent } from 'react';
import { Readout } from './Readout.js';
import { fmt, secs, tpWord, tpZone } from './format.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import loudnessStyles from './Loudness.module.css';
import spectrumStyles from './Spectrum.module.css';
import styles from './LoudnessCurve.module.css';

const CW = 600;
const CH = 120;

/** Short-term loudness over time against the target, loudest and quietest windows marked; hover for values */
export function LoudnessCurve({ m, was }: { m: Extract<Measurement, { kind: 'curve' }>; was: Extract<Measurement, { kind: 'curve' }> | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = m.curve.length;
  const step = m.step ?? 1;
  const dur = n * step;
  const audible = [...m.curve, ...(was?.curve ?? [])].filter((v) => v > -69);
  const top = Math.min(0, Math.ceil(Math.max(m.target ?? -60, ...audible, -30) / 6) * 6 + 3);
  const floor = Math.max(-60, Math.floor(Math.min(top - 18, ...audible) / 6) * 6);
  const y = (v: number) => ((top - Math.min(top, Math.max(floor, v))) / (top - floor)) * CH;
  const x = (t: number) => ((t - m.start) / dur) * CW;
  const path = (vals: number[], s = step, start = m.start) =>
    `M${vals.map((v, i) => `${((((start + i * s) - m.start) / dur) * CW).toFixed(1)},${y(v).toFixed(1)}`).join('L')}`;
  const onMove = (ev: PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.round(((ev.clientX - r.left) / r.width) * n - 0.5))));
  };
  // The tool's own count; entries from before it was kept fall back to the drawn spans
  const overSecs = m.overS ?? m.over.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
  const hx = hover === null ? 0 : x(m.start + hover * step);
  // Grid on 6 dB steps, at most three lines
  const gridStep = top - floor > 24 ? 12 : 6;
  const grid = Array.from({ length: 8 }, (_, i) => Math.floor(top / gridStep) * gridStep - i * gridStep).filter((d) => d < top - 1 && d > floor + 1).slice(0, 3);
  return (
    <>
      <div className={loudnessStyles.lufsBig}>
        <b className="mono">{fmt(m.lufs)}</b>
        <small>LUFS integrated{m.name ? ` · ${m.name}` : ''}</small>
        {m.target !== undefined && (
          <span className={cx(loudnessStyles.lufsDelta, 'mono', overSecs === 0 && loudnessStyles.lufsOn)}>
            {overSecs === 0 ? `never over ${fmt(m.target, 0)} LUFS` : `${Math.round(overSecs)} s over ${fmt(m.target, 0)} LUFS`}
          </span>
        )}
      </div>
      <div className={chartStyles.measureReadouts}>
        <Readout label="True peak" value={fmt(m.tp)} unit="dBTP" zone={tpZone(m.tp)} word={m.tp !== undefined && m.tp > 0 ? 'over 0' : ''} title={tpWord(m.tp) ? `True peak ${tpWord(m.tp)} dBTP` : undefined} />
        <Readout label="Range (LRA)" value={m.lra === undefined ? '–' : m.lra.toFixed(1)} unit="LU" />
        <Readout label="PLR" value={m.plr === undefined ? '–' : m.plr.toFixed(1)} unit="dB" title="True peak minus integrated loudness: how much dynamic headroom is left" />
      </div>
      <div className={spectrumStyles.spectrum}>
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
          aria-label={`${m.term === 'm' ? 'Momentary' : 'Short-term'} loudness over ${Math.round(dur)} s${m.loud ? `, loudest ${fmt(m.loud[2] ?? undefined)} LUFS at ${secs(m.loud[0])}` : ''}`}>
          {grid.map((d) => <line key={d} className={chartStyles.spectrumGrid} x1={0} x2={CW} y1={y(d)} y2={y(d)} vectorEffect="non-scaling-stroke" />)}
          {m.over.map(([a, b], i) => <rect key={i} className={styles.over} x={x(a)} width={Math.max(1, x(b) - x(a))} y={0} height={CH} />)}
          {m.loud && <rect className={styles.loud} x={x(m.loud[0])} width={Math.max(1, x(m.loud[1]) - x(m.loud[0]))} y={0} height={CH} />}
          {m.quiet && <rect className={styles.quiet} x={x(m.quiet[0])} width={Math.max(1, x(m.quiet[1]) - x(m.quiet[0]))} y={0} height={CH} />}
          {m.target !== undefined && <line className={styles.target} x1={0} x2={CW} y1={y(m.target)} y2={y(m.target)} vectorEffect="non-scaling-stroke" />}
          {m.lufs !== undefined && <line className={styles.integrated} x1={0} x2={CW} y1={y(m.lufs)} y2={y(m.lufs)} vectorEffect="non-scaling-stroke" />}
          {was && was.curve.length > 1 && <path className={chartStyles.spectrumPrevious} d={path(was.curve, was.step ?? step, was.start)} vectorEffect="non-scaling-stroke" />}
          <path className={styles.line} d={path(m.curve)} vectorEffect="non-scaling-stroke" />
          {hover !== null && <line className={chartStyles.spectrumCursor} x1={hx} x2={hx} y1={0} y2={CH} vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover !== null && (
          <div className={cx(chartStyles.spectrumTip, 'mono')} style={{ left: `${Math.min(80, Math.max(20, (hx / CW) * 100))}%` }}>
            {secs(m.start + hover * step)} · <span data-zone={m.target !== undefined && m.curve[hover] > m.target ? 'hot' : undefined}>{fmt(m.curve[hover])} LUFS</span>
          </div>
        )}
        {grid.map((d) => <span key={d} className={cx(chartStyles.spectrumY, 'mono')} style={{ top: `${(y(d) / CH) * 100}%` }}>{fmt(d, 0)}</span>)}
      </div>
      <div className={cx(chartStyles.measureScaleWords, 'mono')}>
        <span>{secs(m.start)}</span>
        <span>{secs(m.start + dur)}</span>
      </div>
      <div className={chartStyles.measureLegend}>
        <span><i className={chartStyles.lgLine} /> {m.term === 'm' ? 'Momentary' : 'Short-term'}</span>
        {m.target !== undefined && <span><i className={styles.lgTarget} /> Target</span>}
        {m.over.length > 0 && <span><i className={styles.lgOver} /> Over target</span>}
        {m.loud && <span><i className={styles.lgLoud} /> Loudest 3 s</span>}
        {was && <span><i className={chartStyles.lgPrevious} /> Previous call</span>}
      </div>
      {(m.loud || m.quiet) && (
        <div className={chartStyles.offHints}>
          {m.loud && <span>Loudest <span className="mono">{secs(m.loud[0])}–{secs(m.loud[1])} · {fmt(m.loud[2] ?? undefined)} LUFS</span></span>}
          {m.quiet && <span>Quietest <span className="mono">{secs(m.quiet[0])}–{secs(m.quiet[1])} · {fmt(m.quiet[2] ?? undefined)} LUFS</span></span>}
        </div>
      )}
    </>
  );
}
