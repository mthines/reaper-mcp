import { Icon } from '../../components/index.js';
import { useCopy } from '../../lib/useCopy.js';
import styles from './CodeBlock.module.css';

const LABELS: Record<string, string> = { bash: 'Terminal', sh: 'Terminal', shell: 'Terminal', zsh: 'Terminal', powershell: 'PowerShell', json: 'JSON', lua: 'Lua', text: '', txt: '' };

/** A code block in a guide: what it is (Terminal, JSON…) on a header strip, and one Copy button that copies all of it. */
export function CodeBlock({ text, lang }: { text: string; lang: string }) {
  const [copied, copy] = useCopy();
  const done = copied === 'code';
  const label = LABELS[lang.toLowerCase()] ?? lang;
  return (
    <figure className={styles.block}>
      <figcaption className={styles.bar}>
        <span className={styles.label}>{label}</span>
        <button className={styles.copy} onClick={() => void copy(text, 'code')} aria-label={label ? `Copy the ${label.toLowerCase()} commands` : 'Copy the code'} data-copied={done}>
          {done ? <Icon.Check /> : <Icon.Copy />} <span aria-live="polite">{done ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre className={styles.code} tabIndex={0}>
        <code>{text}</code>
      </pre>
    </figure>
  );
}
