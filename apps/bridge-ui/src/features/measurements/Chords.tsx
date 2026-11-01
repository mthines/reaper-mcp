import { Readout } from './Readout.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './Chords.module.css';

type ChordsData = Extract<Measurement, { kind: 'chords' }>;

/** Where a chord stands against the key: its roman numeral carries an accidental when its root is outside the scale */
const placeOf = (chord: string, roman: string) => (chord === 'N' ? 'none' : /[♭♯]/.test(roman) ? 'out' : roman ? 'in' : 'unknown');

/** Every chord is as wide as it lasts, on one scale for the whole chart, so a wrapped row never stretches */
const EM_PER_SECOND = 1.8;

const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** detect_chords: the progression as a chord chart, each chord as wide as it lasts, coloured by whether it is in the key */
export function Chords({ m }: { m: ChordsData }) {
  const names = new Set(m.ch.map((c) => c[2]).filter((c) => c !== 'N'));
  const places = new Set(m.ch.map(([, , chord, roman]) => placeOf(chord, roman)));
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Readout label="Key" value={m.key ?? '–'} />
        <Readout label="Chords" value={String(names.size)} title="Different chords in the range" />
        <Readout label="One per" value={m.per === 'beat' ? 'Beat' : m.per === 'bar' ? 'Bar' : (m.per ?? '–')} />
      </div>
      <ol className={styles.chart} aria-label="Chord progression">
        {m.ch.map(([start, end, chord, roman]) => (
          <li key={start} className={styles.chord} data-place={placeOf(chord, roman)} style={{ flexBasis: `${Math.max(end - start, 0) * EM_PER_SECOND}em` }}
            title={`${chord === 'N' ? 'No chord' : chord}${roman ? ` (${roman})` : ''} · ${time(start)} – ${time(end)}`}>
            <span className={cx(styles.name, 'mono')}>{chord === 'N' ? '–' : chord}</span>
            <span className={cx(styles.roman, 'mono')}>{roman}</span>
          </li>
        ))}
      </ol>
      <div className={chartStyles.measureLegend}>
        {places.has('in') && <span><i className={styles.lgIn} /> In the key</span>}
        {places.has('out') && <span><i className={styles.lgOut} /> Root outside the key</span>}
        {places.has('none') && <span><i className={styles.lgNone} /> No chord</span>}
      </div>
      <div className={chartStyles.offHints}>
        <span>
          {m.name ? `${m.name}, ` : ''}from {m.src === 'midi' ? 'MIDI notes' : m.src === 'file' ? 'an audio file' : 'the rendered audio'}
          {m.start !== undefined && m.end !== undefined && ` · ${time(m.start)} – ${time(m.end)}`}
          {m.more ? ` · ${m.more} more not shown` : ''}
        </span>
      </div>
    </>
  );
}
