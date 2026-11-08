import { HoverTip } from '../../components/index.js';
import type { Measurement } from '../../lib/commands.js';
import { cx } from '../../lib/cx.js';
import chartStyles from '../../styles/chart.module.css';
import styles from './VerifyEdit.module.css';

const CHECKS: Record<string, [string, string]> = {
  null: ['Null test', 'what is left once delay, gain and polarity are removed'],
  discontinuity: ['Clicks', 'the biggest jump against the track’s own'],
  pitch: ['Pitch', 'drift against the original'],
  tone: ['Tone', 'spectral balance against the original'],
  transients: ['Transients', 'attack sharpness against the original'],
};

const VERDICT: Record<string, string> = { ok: 'Passed', warn: 'Worth a listen', fail: 'Failed', info: 'Reported', skipped: 'Skipped', unknown: 'Unknown' };

/** The verdict of an edit check, then each check: what it measured, its value, and the verdict in words as well as colour */
export function VerifyEdit({ m }: { m: Extract<Measurement, { kind: 'verify' }> }) {
  const overall = m.verdict ?? 'unknown';
  return (
    <>
      <div className={styles.verdict} data-verdict={overall}>
        <b>{VERDICT[overall] ?? overall}</b>
        <span className="muted">
          {m.name ?? 'The edit'}{m.ref ? ` against ${m.ref}` : ''}{m.expect === 'changed' ? ' · expected to sound different' : ''}
        </span>
      </div>
      <div className={chartStyles.evRows}>
        {m.checks.map(([key, verdict, value, detail]) => {
          const [label, what] = CHECKS[key] ?? [key, ''];
          return (
            <HoverTip key={key} className={chartStyles.evRow} tip={[`${label} · ${what}`, ...(detail ? [detail] : [])]}>
              <span className={chartStyles.evName}>{label}{detail && <small>{detail}</small>}</span>
              <span className={cx(chartStyles.evVal, 'mono')} data-verdict={verdict}>
                <b className={styles.value}>{value || '–'}</b>
                <span className={styles.word}> · {VERDICT[verdict] ?? verdict}</span>
              </span>
            </HoverTip>
          );
        })}
      </div>
    </>
  );
}
