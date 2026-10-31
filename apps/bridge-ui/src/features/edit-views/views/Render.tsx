import type { EditView, RenderFile } from '../edit-views.js';
import { Legend } from './ChangeLegend.js';
import { clock, plural } from './format.js';
import { Measurement, fmt } from '../../measurements/index.js';
import { cx } from '../../../lib/cx.js';
import chartStyles from '../../../styles/chart.module.css';
import styles from './Render.module.css';

const SOURCE_LABEL: Record<string, string> = {
  master: 'Master',
  stems: 'Stems',
  master_and_stems: 'Mix + stems',
  selected_via_master: 'Via master',
  region_matrix: 'Regions',
  selected_items: 'Items',
  selected_items_via_master: 'Items via mix',
};
const NORM_LABEL: Record<string, [string, string]> = {
  lufs_i: ['LUFS-I', 'LUFS'],
  lufs_m_max: ['LUFS-M max', 'LUFS'],
  lufs_s_max: ['LUFS-S max', 'LUFS'],
  rms: ['RMS', 'dB'],
  peak: ['Peak', 'dBFS'],
  true_peak: ['True peak', 'dBTP'],
};
/** −150 marks a level REAPER could not measure (silence, or an older bridge) */
const measured = (db: number) => db > -150;
const RENDER_W = 120;
const RENDER_H = 22;
/** The same dB scale as the full waveform: −48 dB at the centre line, full scale at the edges */
const renderWaveY = (v: number) => {
  const a = Math.min(1, Math.abs(v));
  const h = a > 0 ? Math.max(0, (20 * Math.log10(a) + 48) / 48) : 0;
  return ((1 - (v < 0 ? -h : h)) / 2) * RENDER_H;
};

function RenderWave({ hi, lo }: { hi: number[]; lo: number[] }) {
  if (hi.length < 2 || lo.length !== hi.length) return <span className={styles.wave} />;
  const at = (vals: number[]) => vals.map((v, i) => `${((i / (vals.length - 1)) * RENDER_W).toFixed(1)},${renderWaveY(v).toFixed(1)}`);
  return (
    <svg className={styles.wave} viewBox={`0 0 ${RENDER_W} ${RENDER_H}`} preserveAspectRatio="none" aria-hidden="true">
      <line className={chartStyles.spectrumBase} x1={0} x2={RENDER_W} y1={RENDER_H / 2} y2={RENDER_H / 2} vectorEffect="non-scaling-stroke" />
      <path className={styles.shape} d={`M${at(hi).join('L')}L${at(lo).reverse().join('L')}Z`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A render's files: a mini waveform each, LUFS-I against the normalize target, true peak against the limiter; versions grouped */
export function Render({ v }: { v: Extract<EditView, { kind: 'render' }> }) {
  const files = v.groups.reduce((n, g) => n + g.f.length, 0) + (v.more ?? 0);
  const [normName, normUnit] = (v.norm && NORM_LABEL[v.norm]) || ['', ''];
  // Only an integrated target grades a file's integrated loudness; a momentary or short-term max target does not
  const lufsTarget = v.norm === 'lufs_i' && v.nt !== undefined ? v.nt : undefined;
  const encoding = [v.fmt.toUpperCase() || '–', v.bd ?? (v.kbps ? String(v.kbps) : '')].filter(Boolean).join(' ');
  /** On target within 1 LU (accent), off target (amber); plain without a LUFS target */
  const lufsZone = (db: number) => (lufsTarget === undefined || !measured(db) ? 'ok' : Math.abs(db - lufsTarget) <= 1 ? 'ok' : 'hot');
  const tpZone = (db: number) => (!measured(db) ? 'ok' : db > 0 ? 'over' : v.lim !== undefined ? (db > v.lim + 0.05 ? 'hot' : 'ok') : db > -1 ? 'hot' : 'ok');
  const row = (f: RenderFile, key: string) => {
    const [name, dur, lufs, tp, peak, hi, lo] = f;
    const lz = lufsZone(lufs);
    const tz = tpZone(tp);
    const label = `${name} · ${dur >= 0 ? clock(dur, 1) : 'length unknown'}${measured(lufs) ? ` · ${fmt(lufs)} LUFS-I${lz === 'hot' ? ' (off target)' : ''}` : ''}${measured(tp) ? ` · true peak ${fmt(tp)} dBTP${tz === 'over' ? ' (over 0)' : tz === 'hot' ? ' (hot)' : ''}` : ''}${measured(peak) ? ` · sample peak ${fmt(peak)} dBFS` : ''}`;
    return (
      <div className={styles.row} key={key} role="group" aria-label={label} title={label}>
        <span className={styles.name}>{name}</span>
        <RenderWave hi={hi} lo={lo} />
        <span className={cx(styles.v, styles.lufs, 'mono')} data-zone={lz}>{measured(lufs) ? fmt(lufs) : '–'}</span>
        <span className={cx(styles.v, styles.tp, 'mono')} data-zone={tz}>{measured(tp) ? fmt(tp) : '–'}</span>
        <span className={cx(styles.v, styles.dur, 'mono')}>{dur >= 0 ? clock(dur) : '–'}</span>
      </div>
    );
  };
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Files" value={String(files)} />
        <Measurement.Readout label="Format" value={encoding} title={v.bd ? `${v.fmt.toUpperCase()} ${v.bd === '32f' ? '32-bit float' : `${v.bd}-bit`}` : v.kbps ? `${v.fmt.toUpperCase()} ${v.kbps} kbps` : undefined} />
        <Measurement.Readout label="Source" value={SOURCE_LABEL[v.src] ?? v.src} />
        <Measurement.Readout label="Target" value={v.nt !== undefined && v.norm ? fmt(v.nt) : 'None'} unit={v.norm ? normUnit : undefined} title={v.norm ? `Normalized by ${normName}` : 'Not normalized'} />
      </div>
      {(v.norm || v.lim !== undefined) && (
        <div className={styles.tags}>
          {v.norm && <span className={styles.tag}>Normalize {normName} {v.nt !== undefined ? fmt(v.nt) : ''}</span>}
          {v.lim !== undefined && <span className={styles.tag}>Limit {fmt(v.lim)} {v.tp ? 'dBTP' : 'dBFS'}</span>}
        </div>
      )}
      <div className={styles.files} role="group" aria-label="Rendered files">
        <div className={cx(styles.row, styles.head)} aria-hidden="true">
          <span>File</span>
          <span>Waveform</span>
          <span className={styles.v}>LUFS-I</span>
          <span className={styles.v}>TP</span>
          <span className={cx(styles.v, styles.dur)}>Len</span>
        </div>
        {v.groups.map((g, gi) => (
          <div className={styles.group} key={gi}>
            {g.v && (
              <div className={styles.version}>
                <b>{g.v}</b>
                <span className={cx(styles.muted, 'muted')} title={g.m.join(', ')}>{g.m.length ? `muted ${g.m.join(', ')}` : 'full mix'}</span>
              </div>
            )}
            {g.f.map((f, i) => row(f, `${gi}:${i}`))}
          </div>
        ))}
      </div>
      {(v.more ?? 0) > 0 && <div className={chartStyles.evMore}>+{plural(v.more ?? 0, 'more file')} not listed</div>}
      {lufsTarget !== undefined && <Legend items={[[chartStyles.lgTick, `On target (±1 LU of ${fmt(lufsTarget)})`], [chartStyles.lgWarn, 'Off target']]} />}
    </>
  );
}
