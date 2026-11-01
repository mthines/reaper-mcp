import { lufsPct } from './Loudness.js';
import { Readout } from './Readout.js';
import { fmt } from './format.js';
import { HoverTip } from '../../components/index.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';

const stemLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Each stem's loudness, how fast the split ran, and the tracks it added */
export function Stems({ m }: { m: Extract<Measurement, { kind: 'stems' }> }) {
  const speed = m.secs && m.proc ? m.secs / m.proc : undefined;
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Readout label="Model" value={m.model ?? '–'} />
        <Readout label="Device" value={m.device === 'cpu_fallback' ? 'CPU (fallback)' : (m.device ?? '–')} />
        <Readout label="Speed" value={speed === undefined ? '–' : speed.toFixed(1)} unit="× real time" title={m.secs !== undefined && m.proc !== undefined ? `${m.secs} s of audio in ${m.proc} s` : undefined} />
      </div>
      <div className={chartStyles.evRows}>
        {m.stems.map(([stem, lufs, peak]) => {
          const over = peak !== null && peak > 0;
          return (
            <HoverTip key={stem} className={cx(chartStyles.evRow, over && chartStyles.evHot)} tip={[stemLabel(stem), lufs === null ? 'Silent' : `${fmt(lufs)} LUFS`, ...(peak !== null ? [`Peak ${fmt(peak)} dBFS`] : [])]}>
              <span className={chartStyles.evName}>{stemLabel(stem)}</span>
              <span className={cx(chartStyles.evVal, 'mono')}>
                {lufs === null ? <b>silent</b> : <><b>{fmt(lufs)}</b> LUFS</>}
                {peak !== null && <span className={over ? chartStyles.evWord : undefined}> · peak {fmt(peak)}</span>}
              </span>
              <span className={chartStyles.evBar}>
                <span className={chartStyles.evFill} style={{ left: 0, width: `${lufs === null ? 0 : lufsPct(lufs)}%` }} />
              </span>
            </HoverTip>
          );
        })}
      </div>
      <div className={chartStyles.offHints}>
        <span>
          {m.name ?? 'Source'}
          {m.secs !== undefined ? `, ${Math.round(m.secs)} s` : ''}
          {m.inserted ? ` · ${m.inserted} tracks added under “${m.folder ?? 'Stems'}”${m.muted ? ', muted: they sum back to the source' : ''}` : ' · written to disk, not added to the project'}
          {m.stems.some(([, , p]) => p !== null && p > 0) && '. A stem peaking over 0 is kept unclipped (32-bit float).'}
        </span>
      </div>
    </>
  );
}
