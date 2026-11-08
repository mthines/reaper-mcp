import { useId } from 'react';
import { HoverTip } from '../../components/index.js';
import { Readout } from './Readout.js';
import { fmt, zoneOf } from './format.js';
import { WAVE_HEAT, waveOffset, waveOutline } from './wave.js';
import { parseParams, type CommandEntry, type Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './Waveforms.module.css';

const WW = 320;
const WH = 40;

/**
 * Several renders side by side, one lane per track on a shared time axis: the same dB-scaled min/max waveform as a
 * single render, colored by level (accent, amber from −6 dB, red at full scale). Each lane's peak and RMS are on hover.
 */
export function Waveforms({ m, entry, previous }: { m: Extract<Measurement, { kind: 'waveforms' }>; entry: CommandEntry; previous: Extract<Measurement, { kind: 'waveforms' }> | null }) {
  const uid = useId().replace(/:/g, '');
  const p = parseParams(entry.p);
  const startTime = p && typeof p === 'object' ? (p as Record<string, unknown>).startTime : undefined;
  const start = typeof startTime === 'number' ? startTime : 0;
  const end = start + (m.durationSeconds ?? 0);
  const peaks = m.tracks.map((t) => t.peakDb ?? -150);
  const loudest = Math.max(...peaks);
  const clipped = m.tracks.reduce((n, t) => n + (t.clipped ?? 0), 0);
  const drawn = m.tracks.length;
  const hot = loudest > -6;
  /** The previous call's render of the same track (by name), when it has as many slices to lay over this one */
  const ghost = (t: (typeof m.tracks)[number]) => {
    const was = t.name ? previous?.tracks.find((x) => x.name === t.name) : undefined;
    return was && was.hi.length === t.hi.length ? was : undefined;
  };
  const ghosted = m.tracks.some((t) => ghost(t));
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Readout label="Tracks" value={String(drawn + (m.more ?? 0))} title={m.tracks.map((t) => t.name).join(', ')} />
        <Readout label="Loudest" value={fmt(loudest)} unit="dBFS" zone={clipped > 0 ? 'over' : zoneOf(loudest)} word="" title="Highest peak of any track" />
        <Readout label="Clipped" value={String(clipped)} unit="samples" zone={clipped > 0 ? 'over' : 'ok'} word={clipped > 0 ? '' : undefined} />
      </div>
      <svg width="0" height="0" aria-hidden className={styles.defs}>
        <defs>
          <linearGradient id={`waves-heat-${uid}`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={0} y2={WH}>
            {WAVE_HEAT.flatMap(([db, c]) => {
              const o = waveOffset(db);
              return [<stop key={`t${db}`} offset={o} stopColor={`var(--${c})`} />, <stop key={`b${db}`} offset={1 - o} stopColor={`var(--${c})`} />];
            }).sort((a, b) => Number(a.props.offset) - Number(b.props.offset))}
          </linearGradient>
        </defs>
      </svg>
      <div className={styles.lanes}>
        {m.tracks.map((t, i) => {
          const was = ghost(t);
          const tip = [
            t.name || `Track ${i + 1}`,
            `Peak ${fmt(t.peakDb)} dBFS · RMS ${fmt(t.rmsDb)} dBFS`,
            ...((t.clipped ?? 0) > 0 ? [`${t.clipped} clipped samples`] : []),
            ...(was ? [`Previous call: peak ${fmt(was.peakDb)} dBFS`] : []),
          ];
          return (
            <HoverTip key={i} className={styles.lane} tip={tip}>
              <span className={styles.name} title={t.name}>{t.name || `Track ${i + 1}`}</span>
              <svg viewBox={`0 0 ${WW} ${WH}`} preserveAspectRatio="none" role="img" aria-label={`Waveform of ${t.name || `track ${i + 1}`}, peak ${fmt(t.peakDb)} dBFS${(t.clipped ?? 0) > 0 ? `, ${t.clipped} clipped samples` : ''}`}>
                <line className={chartStyles.spectrumBase} x1={0} x2={WW} y1={WH / 2} y2={WH / 2} vectorEffect="non-scaling-stroke" />
                {was && <path className={chartStyles.spectrumPrevious} d={waveOutline(was, WW, WH)} vectorEffect="non-scaling-stroke" />}
                <path className={styles.shape} d={waveOutline(t, WW, WH)} fill={`url(#waves-heat-${uid})`} stroke={`url(#waves-heat-${uid})`} vectorEffect="non-scaling-stroke" />
              </svg>
            </HoverTip>
          );
        })}
      </div>
      {(m.more ?? 0) > 0 && <div className={chartStyles.evMore}>+{m.more} more {m.more === 1 ? 'track' : 'tracks'} rendered, not drawn</div>}
      <div className={cx(chartStyles.measureScaleWords, styles.axis, 'mono')}>
        <span>{start.toFixed(1)} s</span>
        <span>{end.toFixed(1)} s</span>
      </div>
      <div className={chartStyles.measureLegend}>
        <span><i className={chartStyles.lgLine} /> This call</span>
        {ghosted && <span><i className={chartStyles.lgPrevious} /> Previous call</span>}
        {hot && <span><i className={chartStyles.lgWarn} /> Within 6 dB of clipping</span>}
        {clipped > 0 && <span><i className={chartStyles.lgBad} /> Clipping</span>}
      </div>
    </>
  );
}
