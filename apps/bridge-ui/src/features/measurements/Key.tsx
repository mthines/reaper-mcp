import { PreviousLegend } from './Measurement.js';
import { Readout } from './Readout.js';
import { pct, type Zone } from './format.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './Key.module.css';

const PITCH_CLASSES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SCALE_STEPS: Record<string, number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const DEGREE: Record<string, string[]> = { major: ['1', '2', '3', '4', '5', '6', '7'], minor: ['1', '2', '♭3', '4', '5', '♭6', '♭7'] };

/** The key: how much of each pitch class there is, the key's scale lit, its tonic strongest; the previous call ghosted */
export function Key({ m, was }: { m: Extract<Measurement, { kind: 'key' }>; was: Extract<Measurement, { kind: 'key' }> | null }) {
  const tonic = PITCH_CLASSES.indexOf(m.tonic ?? '');
  const steps = SCALE_STEPS[m.mode ?? ''] ?? [];
  const degreeOf = (pc: number) => (tonic < 0 ? -1 : steps.indexOf((pc - tonic + 12) % 12));
  const conf = m.conf;
  const zone: Zone = conf === undefined || conf >= 0.25 ? 'ok' : 'hot';
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Readout label="Key" value={m.key ?? '–'} />
        <Readout label="Confidence" value={conf === undefined ? '–' : `${Math.round(conf * 100)}`} unit="%" zone={zone} word={zone === 'hot' ? 'low' : undefined}
          title="How far this key stands out from the next one that is not its relative key, scaled by how well it fits" />
        <Readout label="Relative" value={m.rel ?? '–'} />
      </div>
      <div className={styles.bars} role="img" aria-label={`Pitch classes: ${PITCH_CLASSES.map((p, i) => `${p} ${Math.round(m.chroma[i] * 100)}%`).join(', ')}`}>
        {PITCH_CLASSES.map((pc, i) => {
          const d = degreeOf(i);
          const w = was?.chroma[i];
          return (
            <div key={pc} className={styles.col} data-scale={d === 0 ? 'tonic' : d > 0 ? 'in' : 'out'} title={`${pc}: ${Math.round(m.chroma[i] * 100)}%${d >= 0 ? ` · scale degree ${DEGREE[m.mode ?? 'major']?.[d] ?? ''}` : ' · outside the key'}`}>
              <span className={styles.track}>
                <span className={styles.fill} style={{ height: `${pct(m.chroma[i], 0, 1)}%` }} />
                {w !== undefined && <span className={styles.was} style={{ bottom: `${pct(w, 0, 1)}%` }} />}
              </span>
              <span className={cx(styles.pc, 'mono')}>{pc}</span>
              <span className={cx(styles.deg, 'mono')}>{d >= 0 ? DEGREE[m.mode ?? 'major']?.[d] : ''}</span>
            </div>
          );
        })}
      </div>
      {was && <PreviousLegend />}
      <div className={chartStyles.offHints}>
        <span>
          {m.name ? `${m.name}, ` : ''}from {m.src === 'midi' ? 'MIDI notes' : m.src === 'file' ? 'an audio file' : 'the rendered audio'}
          {m.r !== undefined && ` · r ${m.r.toFixed(2)}`}
          {m.alt.length > 0 && <> · next: {m.alt.map(([k, r]) => `${k} (${r.toFixed(2)})`).join(', ')}</>}
        </span>
      </div>
    </>
  );
}
