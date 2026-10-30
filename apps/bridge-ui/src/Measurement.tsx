import { useId, useState, type PointerEvent, type ReactNode } from 'react';
import { formatAgo, measurementOf, parseParams, type CommandEntry, type Measurement } from './status.js';

/**
 * What a measuring command read, in the page's meter language: hairline lines with one accent for levels,
 * stereo and the spectrum; loudness leads with one big number against the agent's target. A level turns
 * amber from −6 dB and red over 0 dB (correlation below 0), and the problem is named in words too.
 */

export const fmt = (v: number | undefined, digits = 1) =>
  v === undefined ? '–' : v <= -149 ? '−∞' : (v > 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits)).replace('-', '−');
const pct = (v: number, min: number, max: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));

export type Zone = 'ok' | 'hot' | 'over';
/** Level zones: amber from −6 dB, red over 0 dB */
export const zoneOf = (db: number | undefined): Zone => (db === undefined ? 'ok' : db > 0 ? 'over' : db > -6 ? 'hot' : 'ok');
const ZONE_WORD: Record<Zone, string | null> = { ok: null, hot: 'hot', over: 'over 0' };
/** True peak: amber over −1 dBTP (the streaming ceiling), red over 0 */
const tpZone = (v?: number): Zone => (v === undefined ? 'ok' : v > 0 ? 'over' : v > -1 ? 'hot' : 'ok');
const tpWord = (v?: number) => (v === undefined ? undefined : v > 0 ? 'over 0' : v > -1 ? 'over −1' : undefined);

/** The loudness the agent said it is working to (`targetLufs` on the call), if any */
function targetOf(e: CommandEntry): number | null {
  const p = parseParams(e.p);
  const t = p && typeof p === 'object' ? (p as Record<string, unknown>).targetLufs : undefined;
  return typeof t === 'number' && t < 0 && t > -60 ? t : null;
}

/**
 * The result of a measuring command, plus `history`: the same command on the same track, newest first
 * (this entry included). The call before this one is shown for comparison, and opens on click.
 */
export function MeasurementView({ entry, history, now, onPick }: { entry: CommandEntry; history: CommandEntry[]; now: number; onPick: (e: CommandEntry) => void }) {
  const m = measurementOf(entry);
  if (!m) return null;
  const previous = history.find((h) => h.n < entry.n);
  return (
    <section className="measure" aria-label="Result">
      <div className="measure-head">Result</div>
      <div className="measure-body">{render(m, entry, previous)}</div>
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
const PreviousLegend = () => (
  <div className="measure-legend">
    <span><i className="lg-line" /> This call</span>
    <span><i className="lg-previous" /> Previous call</span>
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
          <div className="measure-readouts">
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
    case 'curve':
      return <Curve m={m} was={same('curve', previous)} />;
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
          <div className="measure-readouts">
            <Readout label="Correlation" value={c === undefined ? '–' : fmt(c, 2)} zone={phase ? 'over' : 'ok'} word={phase ? 'phase' : undefined} />
            <Readout label="Width" value={m.stereoWidth?.toFixed(2) ?? '–'} />
            <Readout label="Side" value={fmt(m.sideLevel)} unit="dB" />
          </div>
          <div className="hl-track hl-track-solo" role="img" aria-label={`Correlation ${c?.toFixed(2) ?? 'unknown'}, from −1 out of phase to +1 mono`}>
            <span className="hl-centre" />
            {c !== undefined && (
              <>
                <span
                  className="hl-fill hl-fill-correlation"
                  style={{ clipPath: `inset(0 ${100 - Math.max(50, pct(c, -1, 1))}% 0 ${Math.min(50, pct(c, -1, 1))}% round 2px)` }}
                />
                <span className={`hl-dot zone-${phase ? 'over' : 'ok'}`} style={{ left: `${pct(c, -1, 1)}%` }} />
              </>
            )}
            {wc !== undefined && <span className="hl-was-dot" style={{ left: `${pct(wc, -1, 1)}%` }} title={`Previous call ${fmt(wc, 2)}`} />}
          </div>
          <div className="measure-scale-words">
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
          <div className="measure-readouts">
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

/** Label over value; a zone other than ok colors the value and names the problem beside the label */
export function Readout({ label, value, unit, zone = 'ok', word, title }: { label: string; value: string; unit?: string; zone?: Zone; word?: string; title?: string }) {
  const w = word ?? ZONE_WORD[zone];
  return (
    <div className={`measure-ro zone-${zone}`} title={title}>
      <span className="measure-ro-label">
        {label}
        {w && <span className="measure-ro-word"> · {w}</span>}
      </span>
      <span className="measure-ro-value mono">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

/**
 * Hairline level: the line is the value (RMS), the tick the peak hold; each takes the zone of what it shows.
 * `was` ghosts the previous call: a faint mark where its RMS ended and a hollow tick at its peak.
 */
function Level({ label, value, hold, was }: { label: string; value?: number; hold?: number; was?: { value?: number; hold?: number } | null }) {
  return (
    <div className="hl-level">
      <span className="hl-label mono">{label}</span>
      <div className="hl-track" title={`Peak ${fmt(hold)} dB · RMS ${fmt(value)} dB`}>
        {value !== undefined && <span className="hl-fill hl-fill-level" style={{ clipPath: `inset(0 ${100 - pct(value, -60, 6)}% 0 0 round 2px)` }} />}
        <span className="hl-zero" style={{ left: `${pct(0, -60, 6)}%` }} />
        {was?.value !== undefined && <span className="hl-was" style={{ left: `${pct(was.value, -60, 6)}%` }} title={`Previous call RMS ${fmt(was.value)} dB`} />}
        {was?.hold !== undefined && <span className="hl-was-hold" style={{ left: `${pct(was.hold, -60, 6)}%` }} title={`Previous call peak ${fmt(was.hold)} dB`} />}
        {hold !== undefined && <span className={`hl-hold zone-${zoneOf(hold)}`} style={{ left: `${pct(hold, -60, 6)}%` }} />}
      </div>
      <span className={`hl-value mono zone-${zoneOf(hold ?? value)}`}>{fmt(hold ?? value)}</span>
    </div>
  );
}

/** Tick labels on the same scale as the marks above; `indent` lines up with a Level's track */
function Scale({ ticks, min, max, indent }: { ticks: number[]; min: number; max: number; indent?: boolean }) {
  return (
    <div className={`measure-scale ${indent ? 'measure-scale-indent' : ''}`}>
      <div>
        {ticks.map((t) => (
          <span key={t} style={{ left: `${pct(t, min, max)}%` }}>
            {fmt(t, 0)}
          </span>
        ))}
      </div>
    </div>
  );
}

const lufsPct = (v: number) => pct(v, -40, 0);

/** One big integrated number, then where the three readings sit, against the agent's target when it gave one */
function Loudness({ m, target, was }: { m: Extract<Measurement, { kind: 'lufs' }>; target: number | null; was?: number }) {
  const i = m.integrated;
  const delta = target === null || i === undefined || i <= -149 ? null : i - target;
  return (
    <>
      <div className="lufs-big">
        <b className="mono">{fmt(i)}</b>
        <small>LUFS integrated</small>
        {delta !== null && target !== null && (
          <span className={`lufs-delta mono ${Math.abs(delta) <= 1 ? 'lufs-on' : delta > 0 ? 'lufs-over' : ''}`}>{Math.abs(delta) < 0.05 ? `on ${fmt(target, 0)}` : `${Math.abs(delta).toFixed(1)} ${delta > 0 ? 'over' : 'under'} ${fmt(target, 0)}`}</span>
        )}
      </div>
      <div className="lufs-track" role="img" aria-label={`Integrated ${fmt(i)} LUFS, short-term ${fmt(m.shortTerm)}, momentary ${fmt(m.momentary)}${target !== null ? `, target ${fmt(target, 0)}` : ''}`}>
        {target !== null && (
          <span className="lufs-target" style={{ left: `${lufsPct(target - 1)}%`, width: `${lufsPct(target + 1) - lufsPct(target - 1)}%` }}>
            <span className="lufs-target-label mono">target {fmt(target, 0)}</span>
          </span>
        )}
        {m.shortTerm !== undefined && <span className="lufs-short" style={{ width: `${lufsPct(m.shortTerm)}%` }} />}
        {m.momentary !== undefined && <span className="lufs-momentary" style={{ left: `${lufsPct(m.momentary)}%` }} />}
        {was !== undefined && was > -149 && <span className="lufs-was" style={{ left: `${lufsPct(was)}%` }} title={`Previous call ${fmt(was)} LUFS`} />}
        {i !== undefined && <span className="lufs-needle" style={{ left: `${lufsPct(i)}%` }} />}
      </div>
      <Scale ticks={[-40, -30, -20, -10, 0]} min={-40} max={0} />
      <div className="measure-legend">
        <span><i className="lg-needle" /> Integrated</span>
        <span><i className="lg-short" /> Short-term</span>
        <span><i className="lg-momentary" /> Momentary</span>
        {target !== null && <span><i className="lg-target" /> Target ±1</span>}
        {was !== undefined && was > -149 && <span><i className="lg-previous" /> Previous call</span>}
      </div>
      <div className="measure-readouts">
        <Readout label="Short-term" value={fmt(m.shortTerm)} unit="LUFS" />
        <Readout label="Momentary" value={fmt(m.momentary)} unit="LUFS" />
        {m.duration !== undefined && <Readout label="Measured" value={m.duration.toFixed(1)} unit="s" />}
        <Readout label="True peak L" value={fmt(m.truePeakL)} unit="dBTP" zone={tpZone(m.truePeakL)} word={tpWord(m.truePeakL)} />
        <Readout label="True peak R" value={fmt(m.truePeakR)} unit="dBTP" zone={tpZone(m.truePeakR)} word={tpWord(m.truePeakR)} />
      </div>
    </>
  );
}

const W = 320;
const H = 110;
const F_MIN = 20;
const F_MAX = 20_000;
const xOf = (hz: number) => (Math.log10(hz / F_MIN) / Math.log10(F_MAX / F_MIN)) * W;
const hzLabel = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toFixed(hz >= 10_000 ? 0 : 1)}k` : `${Math.round(hz)}`);

/** 48 log-spaced bands (20 Hz – 20 kHz, loudest bin each): a hairline over a faint fill, the previous call ghosted */
function Spectrum({ m, previous }: { m: Extract<Measurement, { kind: 'spectrum' }>; previous: number[] | null }) {
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
      <div className="measure-readouts">
        <Readout label="Peak" value={fmt(m.peakDb)} unit="dB" zone={zoneOf(m.peakDb)} />
        <Readout label="RMS" value={fmt(m.rmsDb)} unit="dB" />
        {m.fftSize !== undefined && <Readout label="FFT" value={String(m.fftSize)} />}
      </div>
      <div className="spectrum">
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
            <line key={d} className="spectrum-grid" x1={0} x2={W} y1={yOf(d)} y2={yOf(d)} vectorEffect="non-scaling-stroke" />
          ))}
          <line className="spectrum-base" x1={0} x2={W} y1={H} y2={H} vectorEffect="non-scaling-stroke" />
          {previous && <path className="spectrum-previous" d={path(previous)} vectorEffect="non-scaling-stroke" />}
          <path className="spectrum-area" d={area} fill={`url(#spec-heat-${uid})`} />
          <path className="spectrum-line" d={line} stroke={`url(#spec-heat-${uid})`} vectorEffect="non-scaling-stroke" />
          {hover !== null && <line className="spectrum-cursor" x1={xOf(centre(hover))} x2={xOf(centre(hover))} y1={0} y2={H} vectorEffect="non-scaling-stroke" />}
        </svg>
        {grid.map((d) => (
          <span key={d} className="spectrum-y mono" style={{ top: `${(yOf(d) / H) * 100}%` }}>
            {fmt(d, 0)}
          </span>
        ))}
        {hover !== null && (
          <div className="spectrum-tip mono" style={{ left: `${(xOf(centre(hover)) / W) * 100}%` }}>
            {hzLabel(centre(hover))} Hz · {fmt(bands[hover])} dB
            {previous && previous.length === n && <span className="muted"> (was {fmt(previous[hover])})</span>}
          </div>
        )}
      </div>
      <div className="spectrum-x mono">
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
  const digits = was.unit ? 1 : 2;
  const delta = cur ? cur.value - was.value : null;
  const flat = delta === null || Math.abs(delta) < (digits === 1 ? 0.05 : 0.005);
  return (
    <button className="measure-previous" onClick={() => onPick(previous)} title="Open the previous call (↓)">
      <span>Previous call · {formatAgo(now - previous.t)}</span>
      <span className="mono">
        {was.label} {was.plain ? was.value.toFixed(digits) : fmt(was.value, digits)} {was.unit}
        {delta !== null && <b className="measure-previous-delta"> {flat ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(digits)}`}</b>}
      </span>
    </button>
  );
}

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
function Waveform({ m, entry, previous }: { m: Extract<Measurement, { kind: 'waveform' }>; entry: CommandEntry; previous: Extract<Measurement, { kind: 'waveform' }> | null }) {
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
      <div className="measure-readouts">
        <Readout label="Peak" value={fmt(m.peakDb)} unit="dBFS" zone={clipped ? 'over' : zoneOf(m.peakDb)} word={clipped ? 'clipped' : undefined} />
        <Readout label="RMS" value={fmt(m.rmsDb)} unit="dBFS" />
        <Readout label="Clipped" value={String(m.clipped ?? '–')} unit="samples" zone={clipped ? 'over' : 'ok'} word={clipped ? '' : undefined} />
      </div>
      <div className="waveform">
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
            <line key={f} className="spectrum-grid" x1={0} x2={WW} y1={f * WH} y2={f * WH} vectorEffect="non-scaling-stroke" />
          ))}
          <line className="spectrum-base" x1={0} x2={WW} y1={WH / 2} y2={WH / 2} vectorEffect="non-scaling-stroke" />
          {previous && <path className="spectrum-previous" d={outline(previous)} vectorEffect="non-scaling-stroke" />}
          <path className="waveform-shape" d={shape} fill={`url(#wave-heat-${uid})`} stroke={`url(#wave-heat-${uid})`} vectorEffect="non-scaling-stroke" />
          {hover !== null && <line className="spectrum-cursor" x1={hx} x2={hx} y1={0} y2={WH} vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover !== null && (
          // Kept inside the chart near its edges
          <div className="spectrum-tip mono" style={{ left: `${Math.min(80, Math.max(20, (hx / WW) * 100))}%` }}>
            {(start + ((end - start) * hover) / (n - 1)).toFixed(2)} s · <span className={`zone-${hoverDb >= -0.01 ? 'over' : zoneOf(hoverDb)}`}>{fmt(hoverDb)} dBFS</span>
            {previous && previous.hi.length === n && <span className="muted"> (was {fmt(peakAt(previous, hover))})</span>}
          </div>
        )}
        {/* One label per half so they don't crowd */}
        {[-18, -6].map((db) => (
          <span key={db} className="spectrum-y mono" style={{ top: `${(db === -18 ? waveOffset(db) : 1 - waveOffset(db)) * 100}%` }}>
            {fmt(db, 0)}
          </span>
        ))}
      </div>
      <div className="measure-scale-words mono">
        <span>{start.toFixed(1)} s</span>
        <span>{end.toFixed(1)} s</span>
      </div>
      {previous && <PreviousLegend />}
    </>
  );
}

// ── Sidecar analysis (logged by the server with `_log_result`) ─────────────────

const BAND_NAMES = ['Sub', 'Bass', 'Low mid', 'Mid', 'Upper mid', 'Presence', 'Brilliance'];
const BAND_RANGES = ['20–60 Hz', '60–250 Hz', '250–500 Hz', '500 Hz–2 kHz', '2–4 kHz', '4–6 kHz', '6–20 kHz'];
const secs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Offline loudness of a render or a file: the integrated number first, then how it moves and where the energy sits */
function Offline({ m, was }: { m: Extract<Measurement, { kind: 'offline' }>; was?: number }) {
  const delta = m.ref?.delta;
  const lo = Math.min(-40, ...m.sections.map((s) => s[2]));
  const hasRef = !!m.ref && m.ref.bands.some((b) => b !== null);
  return (
    <>
      <div className="lufs-big">
        <b className="mono">{fmt(m.lufs)}</b>
        <small>LUFS integrated{m.name ? ` · ${m.name}` : ''}</small>
        {delta !== undefined && (
          <span className={`lufs-delta mono ${Math.abs(delta) <= 1 ? 'lufs-on' : ''}`}>
            {Math.abs(delta) < 0.05 ? 'as loud as the reference' : `${Math.abs(delta).toFixed(1)} LU ${delta > 0 ? 'louder' : 'quieter'} than the reference`}
          </span>
        )}
      </div>
      <div className="lufs-track" role="img" aria-label={`Integrated ${fmt(m.lufs)} LUFS`}>
        {m.ref?.lufs !== undefined && <span className="lufs-was off-ref" style={{ left: `${lufsPct(m.ref.lufs)}%` }} title={`Reference ${fmt(m.ref.lufs)} LUFS`} />}
        {was !== undefined && was > -149 && <span className="lufs-was" style={{ left: `${lufsPct(was)}%` }} title={`Previous call ${fmt(was)} LUFS`} />}
        {m.lufs !== undefined && <span className="lufs-needle" style={{ left: `${lufsPct(m.lufs)}%` }} />}
      </div>
      <Scale ticks={[-40, -30, -20, -10, 0]} min={-40} max={0} />
      <div className="measure-readouts">
        <Readout label="Range (LRA)" value={m.lra === undefined ? '–' : m.lra.toFixed(1)} unit="LU" />
        <Readout label="True peak" value={fmt(m.tp)} unit="dBTP" zone={tpZone(m.tp)} word={tpWord(m.tp)} />
        <Readout label="Crest" value={m.crest === undefined ? '–' : m.crest.toFixed(1)} unit="dB" />
      </div>
      {m.sections.length > 1 && (
        <div className="off-block">
          <div className="off-title">Loudness per section</div>
          <div className="off-sections" role="img" aria-label={`Loudness of ${m.sections.length} sections, ${fmt(Math.min(...m.sections.map((s) => s[2])))} to ${fmt(Math.max(...m.sections.map((s) => s[2])))} LUFS`}>
            {m.lufs !== undefined && <span className="off-integrated" style={{ bottom: `${pct(m.lufs, lo, 0)}%` }} />}
            {m.sections.map(([a, b, l], i) => (
              <span key={i} className={l > (m.lufs ?? 0) + 3 ? 'off-loud' : ''} style={{ height: `${Math.max(2, pct(l, lo, 0))}%` }} title={`${secs(a)}–${secs(b)} · ${fmt(l)} LUFS`} />
            ))}
          </div>
          <div className="measure-scale-words mono">
            <span>{secs(m.sections[0][0])}</span>
            <span>{secs(m.sections[m.sections.length - 1][1])}</span>
          </div>
        </div>
      )}
      {m.bands.some((b) => b !== null) && (
        <div className="off-block">
          <div className="off-title">Band balance · share of energy, dB{hasRef ? ' · against the reference' : ''}</div>
          <div className="ev-rows">
            {m.bands.map((b, i) => {
              const d = m.ref?.bands[i] ?? null;
              const off = d !== null && Math.abs(d) >= 3;
              return (
                <div key={i} className={`ev-row ${off ? 'ev-hot' : ''}`} title={`${BAND_NAMES[i]} (${BAND_RANGES[i]}): ${b === null ? 'silent' : `${fmt(b)} dB of the energy`}${d !== null ? `, ${fmt(d)} dB against the reference` : ''}`}>
                  <span className="ev-name">{BAND_NAMES[i]}</span>
                  <span className="ev-val mono">
                    <b>{b === null ? '–' : fmt(b)}</b>
                    {d !== null && <span className={off ? 'ev-word' : ''}> · {fmt(d)} vs ref</span>}
                  </span>
                  <span className="ev-bar">
                    <span className="ev-fill" style={{ left: 0, width: `${b === null ? 0 : pct(b, -40, 0)}%` }} />
                    {d !== null && b !== null && <span className="ev-was" style={{ left: `${pct(b - d, -40, 0)}%` }} />}
                  </span>
                </div>
              );
            })}
          </div>
          {hasRef && (
            <div className="measure-legend">
              <span><i className="lg-line" /> This audio</span>
              <span><i className="lg-was" /> Reference</span>
            </div>
          )}
        </div>
      )}
      {(m.res.length > 0 || (m.sib ?? 0) > 0) && (
        <div className="off-hints">
          {m.res.length > 0 && (
            <span>
              Resonances <span className="mono">{m.res.map(([hz, db]) => `${hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`} +${db.toFixed(1)}`).join(' · ')}</span>
            </span>
          )}
          {(m.sib ?? 0) > 0 && <span>Sibilance <span className="mono">{m.sib} spikes</span></span>}
        </div>
      )}
    </>
  );
}

/** How far a track sits behind (or ahead of) its reference, on a ms axis with the reference at 0 */
function Alignment({ m }: { m: Extract<Measurement, { kind: 'alignment' }> }) {
  const d = m.delayMs ?? 0;
  const span = Math.max(1, Math.ceil(Math.abs(d) * 1.5));
  const at = (ms: number) => pct(ms, -span, span);
  const unsure = m.warn === 1;
  return (
    <>
      <div className="measure-readouts">
        <Readout label="Delay" value={m.delayMs === undefined ? '–' : `${d > 0 ? '+' : ''}${d.toFixed(2)}`} unit="ms" title={m.samples !== undefined ? `${m.samples} samples` : undefined} />
        <Readout label="Polarity" value={m.inv ? 'inverted' : 'normal'} zone={m.inv ? 'hot' : 'ok'} word="" />
        <Readout label="Correlation" value={m.corr === undefined ? '–' : m.corr.toFixed(2)} zone={unsure ? 'hot' : 'ok'} word="" />
      </div>
      <div className="off-align" role="img" aria-label={`${m.name ?? 'Track'} ${Math.abs(d).toFixed(2)} ms ${d >= 0 ? 'after' : 'before'} ${m.ref ?? 'the reference'}`}>
        <span className="off-align-ref" style={{ left: `${at(0)}%` }}><b>{m.ref ?? 'Reference'}</b></span>
        {m.delayMs !== undefined && (
          <>
            <span className="ev-fill" style={{ left: `${Math.min(at(0), at(d))}%`, width: `${Math.abs(at(d) - at(0))}%` }} />
            <span className={`off-align-trk ${m.inv ? 'off-inv' : ''}`} style={{ left: `${at(d)}%` }}><b>{m.name ?? 'Track'}</b></span>
          </>
        )}
      </div>
      <div className="measure-scale-words mono">
        <span>−{span} ms (earlier)</span>
        <span>0</span>
        <span>+{span} ms (later)</span>
      </div>
      {unsure ? (
        <div className="off-hints"><span className="ev-word">Too little in common in this range to trust the delay; no fix suggested.</span></div>
      ) : (
        m.offset !== undefined && (
          <div className="off-hints">
            <span>
              Fix <span className="mono">playOffsetMs {fmt(m.offset, 2)}{m.phase !== undefined ? ` · phase ${m.phase ? 'inverted' : 'normal'}` : ''}</span>
              {m.cur !== undefined && m.cur !== 0 && <span className="mono"> (now {fmt(m.cur, 2)})</span>}
            </span>
          </div>
        )
      )}
    </>
  );
}

const AESTHETICS: Array<[keyof Extract<Measurement, { kind: 'aesthetics' }>, string, string]> = [
  ['pq', 'Production quality', 'How clean and well produced it sounds'],
  ['pc', 'Production complexity', 'How much is going on'],
  ['ce', 'Content enjoyment', 'How enjoyable it is'],
  ['cu', 'Content usefulness', 'How usable it is as material'],
];

/** The four Audiobox Aesthetics scores on 0–10, the previous call ghosted */
function Aesthetics({ m, was }: { m: Extract<Measurement, { kind: 'aesthetics' }>; was: Extract<Measurement, { kind: 'aesthetics' }> | null }) {
  return (
    <>
      <div className="ev-rows">
        {AESTHETICS.map(([k, label, hint]) => {
          const v = m[k] as number | undefined;
          const w = was?.[k] as number | undefined;
          return (
            <div key={k} className="ev-row" title={hint}>
              <span className="ev-name">{label}</span>
              <span className="ev-val mono">
                <b>{v === undefined ? '–' : v.toFixed(1)}</b> / 10
                {w !== undefined && v !== undefined && Math.abs(v - w) >= 0.05 && <span> · {v > w ? '+' : '−'}{Math.abs(v - w).toFixed(1)}</span>}
              </span>
              <span className="ev-bar">
                <span className="ev-fill" style={{ left: 0, width: `${v === undefined ? 0 : pct(v, 0, 10)}%` }} />
                {w !== undefined && <span className="ev-was" style={{ left: `${pct(w, 0, 10)}%` }} />}
              </span>
            </div>
          );
        })}
      </div>
      {was && <PreviousLegend />}
      <div className="off-hints">
        <span>
          {m.name ?? 'Clip'}
          {m.dur !== undefined ? `, ${Math.round(m.dur)} s` : ''}
          {m.lufs !== undefined ? `, scored at ${fmt(m.lufs, 0)} LUFS` : ', scored as rendered'}
          .{m.dur !== undefined && ` Differences under ~${m.dur >= 30 ? '0.1' : '0.4'} are render noise at this length.`}
        </span>
      </div>
    </>
  );
}

// ── Mix checks: loudness over time, stereo per band, masking, stems ───────────

const CW = 600;
const CH = 120;

/** Short-term loudness over time against the target, loudest and quietest windows marked; hover for values */
function Curve({ m, was }: { m: Extract<Measurement, { kind: 'curve' }>; was: Extract<Measurement, { kind: 'curve' }> | null }) {
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
  const overSecs = m.over.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
  const hx = hover === null ? 0 : x(m.start + hover * step);
  // Grid on 6 dB steps, at most three lines
  const gridStep = (top - floor) > 24 ? 12 : 6;
  const grid = Array.from({ length: 8 }, (_, i) => Math.floor(top / gridStep) * gridStep - i * gridStep).filter((d) => d < top - 1 && d > floor + 1).slice(0, 3);
  return (
    <>
      <div className="lufs-big">
        <b className="mono">{fmt(m.lufs)}</b>
        <small>LUFS integrated{m.name ? ` · ${m.name}` : ''}</small>
        {m.target !== undefined && (
          <span className={`lufs-delta mono ${overSecs === 0 ? 'lufs-on' : ''}`}>
            {overSecs === 0 ? `never over ${fmt(m.target, 0)} LUFS` : `${Math.round(overSecs)} s over ${fmt(m.target, 0)} LUFS`}
          </span>
        )}
      </div>
      <div className="measure-readouts">
        <Readout label="True peak" value={fmt(m.tp)} unit="dBTP" zone={tpZone(m.tp)} word={m.tp !== undefined && m.tp > 0 ? 'over 0' : ''} title={tpWord(m.tp) ? `True peak ${tpWord(m.tp)} dBTP` : undefined} />
        <Readout label="Range (LRA)" value={m.lra === undefined ? '–' : m.lra.toFixed(1)} unit="LU" />
        <Readout label="PLR" value={m.plr === undefined ? '–' : m.plr.toFixed(1)} unit="dB" title="True peak minus integrated loudness: how much dynamic headroom is left" />
      </div>
      <div className="spectrum curve">
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
          aria-label={`${m.term === 'm' ? 'Momentary' : 'Short-term'} loudness over ${Math.round(dur)} s${m.loud ? `, loudest ${fmt(m.loud[2] ?? undefined)} LUFS at ${secs(m.loud[0])}` : ''}`}>
          {grid.map((d) => <line key={d} className="spectrum-grid" x1={0} x2={CW} y1={y(d)} y2={y(d)} vectorEffect="non-scaling-stroke" />)}
          {m.over.map(([a, b], i) => <rect key={i} className="curve-over" x={x(a)} width={Math.max(1, x(b) - x(a))} y={0} height={CH} />)}
          {m.loud && <rect className="curve-loud" x={x(m.loud[0])} width={Math.max(1, x(m.loud[1]) - x(m.loud[0]))} y={0} height={CH} />}
          {m.quiet && <rect className="curve-quiet" x={x(m.quiet[0])} width={Math.max(1, x(m.quiet[1]) - x(m.quiet[0]))} y={0} height={CH} />}
          {m.target !== undefined && <line className="curve-target" x1={0} x2={CW} y1={y(m.target)} y2={y(m.target)} vectorEffect="non-scaling-stroke" />}
          {m.lufs !== undefined && <line className="curve-integrated" x1={0} x2={CW} y1={y(m.lufs)} y2={y(m.lufs)} vectorEffect="non-scaling-stroke" />}
          {was && was.curve.length > 1 && <path className="spectrum-previous" d={path(was.curve, was.step ?? step, was.start)} vectorEffect="non-scaling-stroke" />}
          <path className="spectrum-line curve-line" d={path(m.curve)} vectorEffect="non-scaling-stroke" />
          {hover !== null && <line className="spectrum-cursor" x1={hx} x2={hx} y1={0} y2={CH} vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover !== null && (
          <div className="spectrum-tip mono" style={{ left: `${Math.min(80, Math.max(20, (hx / CW) * 100))}%` }}>
            {secs(m.start + hover * step)} · <span className={m.target !== undefined && m.curve[hover] > m.target ? 'zone-hot' : ''}>{fmt(m.curve[hover])} LUFS</span>
          </div>
        )}
        {grid.map((d) => <span key={d} className="spectrum-y mono" style={{ top: `${(y(d) / CH) * 100}%` }}>{fmt(d, 0)}</span>)}
      </div>
      <div className="measure-scale-words mono">
        <span>{secs(m.start)}</span>
        <span>{secs(m.start + dur)}</span>
      </div>
      <div className="measure-legend">
        <span><i className="lg-line" /> {m.term === 'm' ? 'Momentary' : 'Short-term'}</span>
        {m.target !== undefined && <span><i className="lg-target" /> Target</span>}
        {m.over.length > 0 && <span><i className="lg-over" /> Over target</span>}
        {m.loud && <span><i className="lg-loud" /> Loudest 3 s</span>}
        {was && <span><i className="lg-previous" /> Previous call</span>}
      </div>
      {(m.loud || m.quiet) && (
        <div className="off-hints">
          {m.loud && <span>Loudest <span className="mono">{secs(m.loud[0])}–{secs(m.loud[1])} · {fmt(m.loud[2] ?? undefined)} LUFS</span></span>}
          {m.quiet && <span>Quietest <span className="mono">{secs(m.quiet[0])}–{secs(m.quiet[1])} · {fmt(m.quiet[2] ?? undefined)} LUFS</span></span>}
        </div>
      )}
    </>
  );
}

const STEREO_BANDS: Record<string, [string, string]> = {
  low: ['Low', '< 120 Hz'],
  lowMid: ['Low mid', '120–500 Hz'],
  mid: ['Mid', '500 Hz–2 kHz'],
  high: ['High', '2–8 kHz'],
  air: ['Air', '> 8 kHz'],
};

/** Correlation per band on a −1…+1 axis: below 0 cancels in mono (red), a wide low end amber */
function StereoBands({ m, was }: { m: Extract<Measurement, { kind: 'stereo' }>; was: Extract<Measurement, { kind: 'stereo' }> | null }) {
  const at = (c: number) => pct(c, -1, 1);
  return (
    <>
      <div className="ev-rows">
        {m.bands.map(([band, c, worst, neg, side]) => {
          const [label, range] = STEREO_BANDS[band] ?? [band, ''];
          const phase = c !== null && c < 0;
          const wide = !phase && band === 'low' && c !== null && c < 0.7;
          const w = was?.bands.find((b) => b[0] === band)?.[1] ?? null;
          return (
            <div key={band} className={`ev-row ${phase ? 'ev-bad' : wide ? 'ev-hot' : ''}`}
              title={`${label} (${range}): correlation ${c === null ? 'silent' : c.toFixed(2)}${worst !== null ? `, worst ${worst.toFixed(2)}` : ''}${neg !== null ? `, out of phase ${Math.round(neg * 100)}% of the time` : ''}${side !== null ? `, side ${fmt(side)} dB against mid` : ''}`}>
              <span className="ev-name">{label}<small>{range}</small></span>
              <span className="ev-val mono">
                <b>{c === null ? 'silent' : fmt(c, 2)}</b>
                {phase && <span className="ev-word-bad"> · phase</span>}
                {wide && <span className="ev-word"> · wide</span>}
              </span>
              <span className="ev-bar">
                <span className="ev-zero" style={{ left: '50%' }} />
                {c !== null && <span className="ev-fill" style={{ left: `${Math.min(50, at(c))}%`, width: `${Math.abs(at(c) - 50)}%` }} />}
                {worst !== null && c !== null && worst < c && <span className="ev-tick" style={{ left: `${at(worst)}%` }} />}
                {w !== null && <span className="ev-was" style={{ left: `${Math.min(99, Math.max(1, at(w)))}%` }} />}
              </span>
            </div>
          );
        })}
      </div>
      <div className="measure-scale-words">
        <span>−1 phase</span>
        <span>0 wide</span>
        <span>+1 mono</span>
      </div>
      <div className="measure-legend">
        <span><i className="lg-range" /> Correlation</span>
        <span><i className="lg-tick" /> Worst moment</span>
        {was && <span><i className="lg-was" /> Previous call</span>}
      </div>
      {m.flags.length > 0 && (
        <div className="off-hints">
          {m.flags.map((f) => <span key={f} className="ev-word">{f}</span>)}
        </div>
      )}
    </>
  );
}

/** Pairs × third-octave bands: the darker a cell, the more the two tracks fight there; the conflicts in words */
function Masking({ m }: { m: Extract<Measurement, { kind: 'masking' }> }) {
  const marks = m.hz.map((hz, i) => ({ hz, i })).filter(({ hz }) => [63, 250, 1000, 4000, 16000].includes(hz));
  return (
    <>
      {m.pairs.length > 0 && (
        <div className="mask" role="img" aria-label={`Masking between ${m.tracks.length} tracks across ${m.hz.length} bands`}>
          {m.pairs.map(([a, b, overall, scores]) => (
            <div key={`${a}|${b}`} className="mask-row">
              <span className="mask-name" title={`${a} × ${b}: overall ${overall.toFixed(2)}`}>{a} × {b}</span>
              <span className="mask-cells" style={{ gridTemplateColumns: `repeat(${scores.length}, 1fr)` }}>
                {scores.map((s, k) => (
                  <span key={k} className={s >= 0.6 ? 'mask-hot' : ''} style={{ opacity: s <= 0 ? 0.06 : 0.15 + 0.85 * Math.min(1, s) }}
                    title={`${a} × ${b} at ${hzLabel(m.hz[k])} Hz: ${s.toFixed(2)}`} />
                ))}
              </span>
              <span className="mask-score mono">{overall.toFixed(2)}</span>
            </div>
          ))}
          <div className="mask-row mask-axis">
            <span className="mask-name" />
            <span className="mask-marks">
              {marks.map(({ hz, i }) => (i === m.hz.length - 1
                ? <span key={hz} className="mask-mark-end">{hzLabel(hz)}</span>
                : <span key={hz} style={{ left: `${((i + 0.5) / m.hz.length) * 100}%` }}>{hzLabel(hz)}</span>))}
            </span>
            <span className="mask-score" />
          </div>
        </div>
      )}
      <div className="off-hints">
        {m.conflicts.length === 0 ? (
          <span>No band where two of these tracks are both loud and within a few dB: nothing masks.</span>
        ) : (
          m.conflicts.map(([a, b, hz, score, suggestion]) => (
            <span key={`${a}|${b}|${hz}`}>
              <span className="mono">{a} × {b} · {hz === null ? '–' : `${hzLabel(hz)} Hz`} · {score?.toFixed(2) ?? '–'}</span>
              {suggestion && <> — {suggestion}</>}
            </span>
          ))
        )}
      </div>
    </>
  );
}

const STEM_LABEL = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Each stem's loudness, how fast the split ran, and the tracks it added */
function Stems({ m }: { m: Extract<Measurement, { kind: 'stems' }> }) {
  const speed = m.secs && m.proc ? m.secs / m.proc : undefined;
  return (
    <>
      <div className="measure-readouts">
        <Readout label="Model" value={m.model ?? '–'} />
        <Readout label="Device" value={m.device ?? '–'} />
        <Readout label="Speed" value={speed === undefined ? '–' : speed.toFixed(1)} unit="× real time" title={m.secs !== undefined && m.proc !== undefined ? `${m.secs} s of audio in ${m.proc} s` : undefined} />
      </div>
      <div className="ev-rows">
        {m.stems.map(([stem, lufs, peak]) => {
          const over = peak !== null && peak > 0;
          return (
            <div key={stem} className={`ev-row ${over ? 'ev-hot' : ''}`} title={`${STEM_LABEL(stem)}: ${lufs === null ? 'silent' : `${fmt(lufs)} LUFS`}${peak !== null ? `, peak ${fmt(peak)} dBFS` : ''}`}>
              <span className="ev-name">{STEM_LABEL(stem)}</span>
              <span className="ev-val mono">
                <b>{lufs === null ? 'silent' : fmt(lufs)}</b> LUFS
                {peak !== null && <span className={over ? 'ev-word' : ''}> · peak {fmt(peak)}</span>}
              </span>
              <span className="ev-bar">
                <span className="ev-fill" style={{ left: 0, width: `${lufs === null ? 0 : lufsPct(lufs)}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      <div className="off-hints">
        <span>
          {m.name ?? 'Source'}
          {m.secs !== undefined ? `, ${Math.round(m.secs)} s` : ''}
          {m.inserted ? ` · ${m.inserted} tracks added under “${m.folder ?? 'Stems'}”` : ' · written to disk, not added to the project'}
          {m.stems.some(([, , p]) => p !== null && p > 0) && '. A stem peaking over 0 is kept unclipped (32-bit float).'}
        </span>
      </div>
    </>
  );
}
