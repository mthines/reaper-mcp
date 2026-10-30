import { lufsPct } from './Loudness.js';
import { Readout, Scale } from './Readout.js';
import { fmt, pct, tpWord, tpZone } from './format.js';
import type { Measurement } from '../../lib/commands.js';

const BAND_NAMES = ['Sub', 'Bass', 'Low mid', 'Mid', 'Upper mid', 'Presence', 'Brilliance'];
const BAND_RANGES = ['20–60 Hz', '60–250 Hz', '250–500 Hz', '500 Hz–2 kHz', '2–4 kHz', '4–6 kHz', '6–20 kHz'];
const secs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Offline loudness of a render or a file: the integrated number first, then how it moves and where the energy sits */
export function Offline({ m, was }: { m: Extract<Measurement, { kind: 'offline' }>; was?: number }) {
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
