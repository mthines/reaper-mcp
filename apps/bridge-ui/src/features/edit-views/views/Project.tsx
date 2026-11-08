import type { EditView, TransportState } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { clock, plain } from './format.js';
import { Measurement } from '../../measurements/index.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Project.module.css';

const STATE_WORD: Record<TransportState, string> = { 0: 'Stopped', 1: 'Playing', 2: 'Paused', 3: 'Recording' };
const onOff = (v: boolean) => (v ? 'On' : 'Off');
/** 44100 → "44.1 kHz" */
const kHz = (sr: number) => `${plain(sr / 1000)} kHz`;
/** Seconds one bar lasts: its beats are `den`-th notes at `tempo` quarter notes a minute */
export const barSeconds = (tempo: number, [num, den]: [number, number]) => (num * 4 * 60) / (den * tempo);

/**
 * What a project or transport read answered: tempo, time signature (drawn as the beats of one bar), sample rate,
 * transport state and cursor. Only what the call returned is drawn, so one view serves the project info, the
 * transport and the project settings.
 */
export function Project({ v }: { v: Extract<EditView, { kind: 'project' }> }) {
  const bar = v.tempo && v.ts ? barSeconds(v.tempo, v.ts) : undefined;
  const label = v.name === undefined ? undefined : v.name || 'Not saved yet';
  return (
    <>
      {label !== undefined && <div className={styles.name} title={label}>{label}</div>}
      {(v.title || v.author) && (
        <div className={styles.name} title={[v.title, v.author].filter(Boolean).join(' · ')}>
          {v.title}{v.title && v.author && <span className={styles.by}> by </span>}{v.author}
        </div>
      )}
      <div className={chartStyles.measureReadouts}>
        {v.tempo !== undefined && <Measurement.Readout label="Tempo" value={plain(v.tempo)} unit=" BPM" />}
        {v.ts && <Measurement.Readout label="Meter" value={`${v.ts[0]}/${v.ts[1]}`} title="Time signature" />}
        {bar !== undefined && <Measurement.Readout label="Bar" value={plain(bar)} unit=" s" title="How long one bar lasts at this tempo" />}
        {v.sr !== undefined && (
          <Measurement.Readout label="Sample rate" value={kHz(v.sr)} word={v.forced ? 'project' : ''}
            title={v.forced ? 'This project sets its own sample rate' : undefined} />
        )}
        {v.tracks !== undefined && <Measurement.Readout label="Tracks" value={String(v.tracks)} />}
        {v.state !== undefined && (
          <Measurement.Readout label="Transport" value={STATE_WORD[v.state]} zone={v.state === 3 ? 'hot' : 'ok'} word="" />
        )}
        {v.cur !== undefined && <Measurement.Readout label="Cursor" value={clock(v.cur, 1)} title="Edit cursor position" />}
        {v.pos !== undefined && <Measurement.Readout label="Playhead" value={clock(v.pos, 1)} title="Where playback is now" />}
        {v.repeat !== undefined && <Measurement.Readout label="Repeat" value={onOff(v.repeat)} />}
        {v.metro !== undefined && <Measurement.Readout label="Metronome" value={onOff(v.metro)} />}
        {v.notes !== undefined && <Measurement.Readout label="Notes" value={v.notes ? 'written' : 'none'} />}
      </div>
      {v.ts && <Beats num={v.ts[0]} />}
    </>
  );
}

/** One bar as its beats: the downbeat stands out */
function Beats({ num }: { num: number }) {
  const shown = Math.min(num, 32);
  return (
    <>
      <div className={styles.beats} role="img" aria-label={`One bar: ${num} beats`}>
        {Array.from({ length: shown }, (_, i) => <span key={i} className={i === 0 ? styles.down : styles.beat} />)}
      </div>
      <Legend items={[[styles.lgDown, 'Downbeat'], ...(shown > 1 ? [[styles.lgBeat, 'Beat']] : [])] as Array<[string, string]>} />
      {num > shown && <div className={chartStyles.evMore}>{num - shown} more beats not drawn</div>}
    </>
  );
}
