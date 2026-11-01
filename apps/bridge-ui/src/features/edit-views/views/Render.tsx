import { useState, type PointerEvent } from 'react';
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

/** A slice's peak in dBFS, the louder of its two sides */
const sliceDb = (hi: number, lo: number) => {
  const a = Math.max(Math.abs(hi), Math.abs(lo));
  return a > 0 ? 20 * Math.log10(a) : -150;
};

/**
 * The file's peaks per slice, each drawn at its slice's centre and closed to the centre line at both ends (the
 * first and last slice are seconds long, so their level is not the file's first or last sample). Hover: time and peak.
 */
function RenderWave({ hi, lo, dur }: { hi: number[]; lo: number[]; dur: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = hi.length;
  if (n < 2 || lo.length !== n) return <span className={styles.waveWrap} />;
  const xOf = (i: number) => ((i + 0.5) / n) * RENDER_W;
  const at = (vals: number[]) => vals.map((v, i) => `${xOf(i).toFixed(1)},${renderWaveY(v).toFixed(1)}`);
  const mid = RENDER_H / 2;
  const onMove = (ev: PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    setHover(r.width > 0 ? Math.min(n - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * n))) : 0);
  };
  const db = hover === null ? 0 : sliceDb(hi[hover], lo[hover]);
  return (
    <span className={styles.waveWrap}>
      <svg className={styles.wave} viewBox={`0 0 ${RENDER_W} ${RENDER_H}`} preserveAspectRatio="none" role="img"
        aria-label="Waveform: peak level over time" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <line className={chartStyles.spectrumBase} x1={0} x2={RENDER_W} y1={mid} y2={mid} vectorEffect="non-scaling-stroke" />
        <path className={styles.shape} d={`M0,${mid}L${at(hi).join('L')}L${RENDER_W},${mid}L${at(lo).reverse().join('L')}Z`} vectorEffect="non-scaling-stroke" />
        {hover !== null && <line className={chartStyles.spectrumCursor} x1={xOf(hover)} x2={xOf(hover)} y1={0} y2={RENDER_H} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && (
        <span role="tooltip" className={cx(chartStyles.spectrumTip, styles.waveTip, 'mono')} style={{ left: `${Math.min(85, Math.max(15, ((hover + 0.5) / n) * 100))}%` }}>
          {dur > 0 ? `${clock(((hover + 0.5) / n) * dur, 1)} · ` : ''}{measured(db) ? `peak ${fmt(db)} dBFS` : 'silence'}
        </span>
      )}
    </span>
  );
}

/** A render's files: a mini waveform each, LUFS-I against the normalize target, true peak against the limiter; versions grouped */
export function Render({ v }: { v: Extract<EditView, { kind: 'render' }> }) {
  const [normName, normUnit] = (v.norm && NORM_LABEL[v.norm]) || ['', ''];
  // Only an integrated target grades a file's integrated loudness; a momentary or short-term max target does not
  const lufsTarget = v.norm === 'lufs_i' && v.nt !== undefined ? v.nt : undefined;
  const encoding = [v.fmt.toUpperCase() || '–', v.bd ?? (v.kbps ? String(v.kbps) : '')].filter(Boolean).join(' ');
  /** On target within 1 LU (accent), off target (amber); plain without a LUFS target */
  const lufsZone = (db: number) => (lufsTarget === undefined || !measured(db) ? 'ok' : Math.abs(db - lufsTarget) <= 1 ? 'ok' : 'hot');
  const tpZone = (db: number) => (!measured(db) ? 'ok' : db > 0 ? 'over' : v.lim !== undefined ? (db > v.lim + 0.05 ? 'hot' : 'ok') : db > -1 ? 'hot' : 'ok');
  const all = v.groups.flatMap((g) => g.f);
  const offWords = [
    all.some((f) => lufsZone(f[2]) === 'hot') && `loudness more than 1 LU from ${fmt(lufsTarget)}`,
    all.some((f) => tpZone(f[3]) === 'hot') && (v.lim !== undefined ? 'peak over the limit' : 'peak within 1 dB of 0'),
  ].filter(Boolean);
  const over = all.some((f) => tpZone(f[3]) === 'over');
  const row = (f: RenderFile, key: string) => {
    const [name, dur, lufs, tp, peak, hi, lo] = f;
    const lz = lufsZone(lufs);
    const tz = tpZone(tp);
    const label = `${name} · ${dur >= 0 ? clock(dur, 1) : 'length unknown'}${measured(lufs) ? ` · ${fmt(lufs)} LUFS-I${lz === 'hot' ? ' (off target)' : ''}` : ''}${measured(tp) ? ` · true peak ${fmt(tp)} dBTP${tz === 'over' ? ' (over 0)' : tz === 'hot' ? ' (hot)' : ''}` : ''}${measured(peak) ? ` · sample peak ${fmt(peak)} dBFS` : ''}`;
    return (
      <div className={styles.row} key={key} role="group" aria-label={label}>
        <span className={styles.name}>{name}</span>
        <RenderWave hi={hi} lo={lo} dur={dur} />
        <span className={cx(styles.v, styles.lufs, 'mono')} data-zone={lz}>{measured(lufs) ? fmt(lufs) : '–'}</span>
        <span className={cx(styles.v, styles.tp, 'mono')} data-zone={tz}>{measured(tp) ? fmt(tp) : '–'}</span>
        <span className={cx(styles.v, styles.dur, 'mono')}>{dur >= 0 ? clock(dur) : '–'}</span>
      </div>
    );
  };
  return (
    <>
      <div className={chartStyles.measureReadouts}>
        <Measurement.Readout label="Format" value={encoding} title={v.bd ? `${v.fmt.toUpperCase()} ${v.bd === '32f' ? '32-bit float' : `${v.bd}-bit`}` : v.kbps ? `${v.fmt.toUpperCase()} ${v.kbps} kbps` : undefined} />
        <Measurement.Readout label="Source" value={SOURCE_LABEL[v.src] ?? v.src} />
        <Measurement.Readout label="Target" value={v.nt !== undefined && v.norm ? fmt(v.nt) : 'off'} unit={v.norm ? normUnit : undefined} title={v.norm ? `Normalized by ${normName}` : 'Not normalized'} />
      </div>
      {v.lim !== undefined && (
        <div className={styles.tags}>
          {v.lim !== undefined && <span className={styles.tag}>Limit {fmt(v.lim)} {v.tp ? 'dBTP' : 'dBFS'}</span>}
        </div>
      )}
      <div className={styles.files} role="group" aria-label="Rendered files">
        <div className={cx(styles.row, styles.head)} aria-hidden="true">
          <span>File</span>
          <span>Waveform</span>
          <span className={styles.v} title="Integrated loudness, LUFS">LUFS</span>
          <span className={styles.v} title="True peak, dBTP">Peak</span>
          <span className={cx(styles.v, styles.dur)}>Length</span>
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
      {v.more ? <div className={chartStyles.evMore}>+{plural(v.more, 'more file')} not listed</div> : null}
      <Legend items={[
        ...(offWords.length ? [[chartStyles.lgWarn, `Off: ${offWords.join(', ')}`]] : []),
        ...(over ? [[chartStyles.lgBad, 'True peak over 0 dB']] : []),
      ] as Array<[string, string]>} />
    </>
  );
}
