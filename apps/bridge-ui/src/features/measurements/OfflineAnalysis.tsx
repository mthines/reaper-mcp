import { lufsPct } from './Loudness.js';
import { Readout, Scale } from './Readout.js';
import { fmt, pct, tpWord, tpZone, secs } from './format.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import loudnessStyles from './Loudness.module.css';
import chartStyles from '../../styles/chart.module.css';
import styles from './OfflineAnalysis.module.css';

const BAND_NAMES = ['Sub', 'Bass', 'Low mid', 'Mid', 'Upper mid', 'Presence', 'Brilliance'];
const BAND_RANGES = ['20–60 Hz', '60–250 Hz', '250–500 Hz', '500 Hz–2 kHz', '2–4 kHz', '4–6 kHz', '6–20 kHz'];

/** Offline loudness of a render or a file: the integrated number first, then how it moves and where the energy sits */
export function Offline({ m, was }: { m: Extract<Measurement, { kind: 'offline' }>; was?: number }) {
  const delta = m.ref?.delta;
  const lo = Math.min(-40, ...m.sections.map((s) => s[2]));
  const hasRef = !!m.ref && m.ref.bands.some((b) => b !== null);
  return (
    <>
      <div className={loudnessStyles.lufsBig}>
        <b className="mono">{fmt(m.lufs)}</b>
        <small>LUFS integrated{m.name ? ` · ${m.name}` : ''}</small>
        {delta !== undefined && (
          <span className={cx(loudnessStyles.lufsDelta, 'mono', Math.abs(delta) <= 1 ? loudnessStyles.lufsOn : '')}>
            {Math.abs(delta) < 0.05 ? 'as loud as the reference' : `${Math.abs(delta).toFixed(1)} LU ${delta > 0 ? 'louder' : 'quieter'} than the reference`}
          </span>
        )}
      </div>
      <div className={loudnessStyles.lufsTrack} role="img" aria-label={`Integrated ${fmt(m.lufs)} LUFS`}>
        {m.ref?.lufs !== undefined && <span className={cx(loudnessStyles.lufsWas, loudnessStyles.offRef)} style={{ left: `${lufsPct(m.ref.lufs)}%` }} title={`Reference ${fmt(m.ref.lufs)} LUFS`} />}
        {was !== undefined && was > -149 && <span className={loudnessStyles.lufsWas} style={{ left: `${lufsPct(was)}%` }} title={`Previous call ${fmt(was)} LUFS`} />}
        {m.lufs !== undefined && <span className={loudnessStyles.lufsNeedle} style={{ left: `${lufsPct(m.lufs)}%` }} />}
      </div>
      <Scale ticks={[-40, -30, -20, -10, 0]} min={-40} max={0} />
      <div className={chartStyles.measureReadouts}>
        <Readout label="Range (LRA)" value={m.lra === undefined ? '–' : m.lra.toFixed(1)} unit="LU" />
        <Readout label="True peak" value={fmt(m.tp)} unit="dBTP" zone={tpZone(m.tp)} word={tpWord(m.tp)} />
        <Readout label="Crest" value={m.crest === undefined ? '–' : m.crest.toFixed(1)} unit="dB" />
      </div>
      {m.sections.length > 1 && (
        <div className={styles.offBlock}>
          <div className={styles.offTitle}>Loudness per section</div>
          <div className={styles.offSections} role="img" aria-label={`Loudness of ${m.sections.length} sections, ${fmt(Math.min(...m.sections.map((s) => s[2])))} to ${fmt(Math.max(...m.sections.map((s) => s[2])))} LUFS`}>
            {m.lufs !== undefined && <span className={styles.offIntegrated} style={{ bottom: `${pct(m.lufs, lo, 0)}%` }} />}
            {m.sections.map(([a, b, l], i) => (
              <span key={i} className={l > (m.lufs ?? 0) + 3 ? styles.offLoud : ''} style={{ height: `${Math.max(2, pct(l, lo, 0))}%` }} title={`${secs(a)}–${secs(b)} · ${fmt(l)} LUFS`} />
            ))}
          </div>
          <div className={cx(chartStyles.measureScaleWords, 'mono')}>
            <span>{secs(m.sections[0][0])}</span>
            <span>{secs(m.sections[m.sections.length - 1][1])}</span>
          </div>
        </div>
      )}
      {m.bands.some((b) => b !== null) && (
        <div className={styles.offBlock}>
          <div className={styles.offTitle}>Band balance · share of energy, dB{hasRef ? ' · against the reference' : ''}</div>
          <div className={chartStyles.evRows}>
            {m.bands.map((b, i) => {
              const d = m.ref?.bands[i] ?? null;
              const off = d !== null && Math.abs(d) >= 3;
              return (
                <div key={i} className={cx(chartStyles.evRow, off ? chartStyles.evHot : '')} title={`${BAND_NAMES[i]} (${BAND_RANGES[i]}): ${b === null ? 'silent' : `${fmt(b)} dB of the energy`}${d !== null ? `, ${fmt(d)} dB against the reference` : ''}`}>
                  <span className={chartStyles.evName}>{BAND_NAMES[i]}</span>
                  <span className={cx(chartStyles.evVal, 'mono')}>
                    <b>{b === null ? '–' : fmt(b)}</b>
                    {d !== null && <span className={off ? chartStyles.evWord : ''}> · {fmt(d)} vs ref</span>}
                  </span>
                  <span className={chartStyles.evBar}>
                    <span className={chartStyles.evFill} style={{ left: 0, width: `${b === null ? 0 : pct(b, -40, 0)}%` }} />
                    {d !== null && b !== null && <span className={chartStyles.evWas} style={{ left: `${pct(b - d, -40, 0)}%` }} />}
                  </span>
                </div>
              );
            })}
          </div>
          {hasRef && (
            <div className={chartStyles.measureLegend}>
              <span><i className={chartStyles.lgLine} /> This audio</span>
              <span><i className={chartStyles.lgWas} /> Reference</span>
            </div>
          )}
        </div>
      )}
      {(m.res.length > 0 || (m.sib ?? 0) > 0) && (
        <div className={chartStyles.offHints}>
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
