import { cx } from '../lib/cx.js';
import styles from './Toggle.module.css';


export function Toggle({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className={cx(styles.toggle, disabled ? styles.toggleDisabled : '')}>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        <span className={styles.toggleHint}>{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(ev) => onChange(ev.target.checked)} />
      <span className={styles.switch} aria-hidden />
    </label>
  );
}
