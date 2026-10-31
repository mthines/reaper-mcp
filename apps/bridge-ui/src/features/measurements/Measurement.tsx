import type { ReactNode } from 'react';
import { Aesthetics } from './Aesthetics.js';
import { Alignment } from './Alignment.js';
import { Key } from './Key.js';
import { Loudness } from './Loudness.js';
import { LoudnessCurve } from './LoudnessCurve.js';
import { Masking } from './Masking.js';
import { Offline } from './OfflineAnalysis.js';
import { Level, Readout, Scale } from './Readout.js';
import { Spectrum } from './Spectrum.js';
import { Stems } from './Stems.js';
import { StereoBands } from './StereoBands.js';
import { Waveform } from './Waveform.js';
import { fmt, pct, targetOf, zoneOf } from './format.js';
import { formatAgo } from '../../lib/format.js';
import { measurementOf, type CommandEntry, type Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import readoutStyles from './Readout.module.css';

/**
 * What a measuring command read, in the page's meter language: hairline lines with one accent for levels,
 * stereo and the spectrum; loudness leads with one big number against the agent's target. A level turns
 * amber from −6 dB and red over 0 dB (correlation below 0), and the problem is named in words too.
 */

/**
 * The result of a measuring command, plus `history`: the same command on the same track, newest first
 * (this entry included). The call before this one is shown for comparison, and opens on click.
 */
export function MeasurementView({ entry, history, now, onPick }: { entry: CommandEntry; history: CommandEntry[]; now: number; onPick: (e: CommandEntry) => void }) {
  const m = measurementOf(entry);
  if (!m) return null;
  const previous = history.find((h) => h.n < entry.n);
  return (
    <section className={chartStyles.measure} aria-label="Result">
      <div className={chartStyles.measureHead}>Result</div>
      <div className={chartStyles.measureBody}>{render(m, entry, previous)}</div>
      {previous && <Previous m={m} previous={previous} now={now} onPick={onPick} />}
    </section>
  );
}

/** The previous call's result when it measured the same kind of thing, for the ghost marks */
function same<K extends Measurement['kind']>(kind: K, e: CommandEntry | undefined): Extract<Measurement, { kind: K }> | null {
  const m = e ? measurementOf(e) : null;
  return m?.kind === kind ? (m as Extract<Measurement, { kind: K }>) : null;
}

/** Legend for the ghost marks, shown whenever a chart draws the previous call */
export const PreviousLegend = () => (
  <div className={chartStyles.measureLegend}>
    <span><i className={chartStyles.lgLine} /> This call</span>
    <span><i className={chartStyles.lgPrevious} /> Previous call</span>
  </div>
);

function render(m: Measurement, entry: CommandEntry, previous: CommandEntry | undefined): ReactNode {
  switch (m.kind) {
    case 'meters': {
      const was = same('meters', previous);
      return (
        <>
          <Level label="L" value={m.rmsL} hold={m.peakL} was={was && { value: was.rmsL, hold: was.peakL }} />
          <Level label="R" value={m.rmsR} hold={m.peakR} was={was && { value: was.rmsR, hold: was.peakR }} />
          <Scale ticks={[-60, -40, -20, -6, 0]} min={-60} max={6} indent />
          {was && <PreviousLegend />}
          <div className={chartStyles.measureReadouts}>
            <Readout label="Peak L" value={fmt(m.peakL)} unit="dB" zone={zoneOf(m.peakL)} />
            <Readout label="Peak R" value={fmt(m.peakR)} unit="dB" zone={zoneOf(m.peakR)} />
            <Readout label="RMS L" value={fmt(m.rmsL)} unit="dB" />
            <Readout label="RMS R" value={fmt(m.rmsR)} unit="dB" />
          </div>
        </>
      );
    }
    case 'lufs':
      return <Loudness m={m} target={targetOf(entry)} was={same('lufs', previous)?.integrated} />;
    case 'offline':
      return <Offline m={m} was={same('offline', previous)?.lufs} />;
    case 'alignment':
      return <Alignment m={m} />;
    case 'aesthetics':
      return <Aesthetics m={m} was={same('aesthetics', previous)} />;
    case 'key':
      return <Key m={m} was={same('key', previous)} />;
    case 'curve':
      return <LoudnessCurve m={m} was={same('curve', previous)} />;
    case 'stereo':
      return <StereoBands m={m} was={same('stereo', previous)} />;
    case 'masking':
      return <Masking m={m} />;
    case 'stems':
      return <Stems m={m} />;
    case 'correlation': {
      const c = m.correlation;
      const wc = same('correlation', previous)?.correlation;
      const phase = c !== undefined && c < 0;
      return (
        <>
          <div className={chartStyles.measureReadouts}>
            <Readout label="Correlation" value={c === undefined ? '–' : fmt(c, 2)} zone={phase ? 'over' : 'ok'} word={phase ? 'phase' : undefined} />
            <Readout label="Width" value={m.stereoWidth?.toFixed(2) ?? '–'} />
            <Readout label="Side" value={fmt(m.sideLevel)} unit="dB" />
          </div>
          <div className={readoutStyles.hlTrack} role="img" aria-label={`Correlation ${c?.toFixed(2) ?? 'unknown'}, from −1 out of phase to +1 mono`}>
            <span className={readoutStyles.hlCentre} />
            {c !== undefined && (
              <>
                <span
                  className={cx(readoutStyles.hlFill, readoutStyles.hlFillCorrelation)}
                  style={{ clipPath: `inset(0 ${100 - Math.max(50, pct(c, -1, 1))}% 0 ${Math.min(50, pct(c, -1, 1))}% round 2px)` }}
                />
                <span className={readoutStyles.hlDot} data-zone={phase ? 'over' : 'ok'} style={{ left: `${pct(c, -1, 1)}%` }} />
              </>
            )}
            {wc !== undefined && <span className={readoutStyles.hlWasDot} style={{ left: `${pct(wc, -1, 1)}%` }} title={`Previous call ${fmt(wc, 2)}`} />}
          </div>
          <div className={chartStyles.measureScaleWords}>
            <span>−1 phase</span>
            <span>0</span>
            <span>+1 mono</span>
          </div>
          {wc !== undefined && <PreviousLegend />}
        </>
      );
    }
    case 'crest': {
      const was = same('crest', previous);
      return (
        <>
          <div className={chartStyles.measureReadouts}>
            <Readout label="Crest" value={fmt(m.crestFactor)} unit="dB" />
            <Readout label="Peak" value={fmt(m.peakLevel)} unit="dB" zone={zoneOf(m.peakLevel)} />
            <Readout label="RMS" value={fmt(m.rmsLevel)} unit="dB" zone={zoneOf(m.rmsLevel)} />
          </div>
          <Level label="" value={m.rmsLevel} hold={m.peakLevel} was={was && { value: was.rmsLevel, hold: was.peakLevel }} />
          <Scale ticks={[-60, -40, -20, -6, 0]} min={-60} max={6} indent />
          {was && <PreviousLegend />}
        </>
      );
    }
    case 'spectrum': {
      const prev = previous ? measurementOf(previous) : null;
      return <Spectrum m={m} previous={prev?.kind === 'spectrum' ? prev.bands : null} />;
    }
    case 'waveform':
      return <Waveform m={m} entry={entry} previous={same('waveform', previous)} />;
  }
}

/** The one number each measurement is judged by, compared against the previous call */
function headline(m: Measurement): { value: number; label: string; unit: string; plain: boolean } | null {
  const v = (x: number | undefined, label: string, unit: string, plain = false) => (x === undefined || x <= -149 ? null : { value: x, label, unit, plain });
  switch (m.kind) {
    case 'lufs':
      return v(m.integrated, 'Integrated', 'LUFS');
    case 'meters':
      return v(m.peakL === undefined ? m.peakR : m.peakR === undefined ? m.peakL : Math.max(m.peakL, m.peakR), 'Peak', 'dB');
    case 'correlation':
      return v(m.correlation, 'Correlation', '');
    case 'crest':
      return v(m.crestFactor, 'Crest', 'dB');
    case 'spectrum':
      return v(m.rmsDb, 'RMS', 'dB');
    case 'waveform':
      return v(m.peakDb, 'Peak', 'dB');
    case 'offline':
      return v(m.lufs, 'Integrated', 'LUFS');
    case 'alignment':
      return v(m.delayMs, 'Delay', 'ms');
    case 'aesthetics':
      return v(m.pq, 'Quality', '/ 10', true);
    case 'key':
      return v(m.conf === undefined ? undefined : m.conf * 100, 'Confidence', '%', true);
    case 'curve':
      return v(m.lufs, 'Integrated', 'LUFS');
    case 'stereo': {
      const low = m.bands.find((b) => b[0] === 'low')?.[1];
      return v(low ?? undefined, 'Low-end correlation', '', true);
    }
    case 'masking':
      return v(m.pairs[0]?.[2], 'Worst pair', '', true);
    case 'stems':
      return m.secs && m.proc ? v(m.secs / m.proc, 'Speed', '× real time', true) : null;
  }
}

/** The previous call on the same track: its headline value and how far this call moved from it */
function Previous({ m, previous, now, onPick }: { m: Measurement; previous: CommandEntry; now: number; onPick: (e: CommandEntry) => void }) {
  const p = measurementOf(previous);
  const cur = headline(m);
  const was = p && headline(p);
  if (!was) return null;
  const digits = was.unit === '%' ? 0 : was.unit ? 1 : 2;
  const delta = cur ? cur.value - was.value : null;
  const flat = delta === null || Math.abs(delta) < 0.5 / 10 ** digits;
  return (
    <button className={chartStyles.measurePrevious} onClick={() => onPick(previous)} title="Open the previous call (↓)">
      <span>Previous call · {formatAgo(now - previous.t)}</span>
      <span className="mono">
        {was.label} {was.plain ? was.value.toFixed(digits) : fmt(was.value, digits)} {was.unit}
        {delta !== null && <b className={chartStyles.measurePreviousDelta}> {flat ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(digits)}`}</b>}
      </span>
    </button>
  );
}
