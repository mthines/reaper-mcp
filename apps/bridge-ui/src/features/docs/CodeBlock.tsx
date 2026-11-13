import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/index.js';
import styles from './CodeBlock.module.css';

const LABELS: Record<string, string> = { bash: 'Terminal', sh: 'Terminal', shell: 'Terminal', zsh: 'Terminal', powershell: 'PowerShell', json: 'JSON', lua: 'Lua', text: '', txt: '' };

/** A code block in a guide: what it is (Terminal, JSON…) on a header strip, and one Copy button that copies all of it. */
export function CodeBlock({ text, lang }: { text: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const label = LABELS[lang.toLowerCase()] ?? lang;
  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        // clipboard blocked: the text is selectable on the page
      });
  };
  return (
    <figure className={styles.block}>
      <figcaption className={styles.bar}>
        <span className={styles.label}>{label}</span>
        <button className={styles.copy} onClick={copy} aria-label={label ? `Copy the ${label.toLowerCase()} commands` : 'Copy the code'} data-copied={copied}>
          {copied ? <Icon.Check /> : <Icon.Copy />} <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre className={styles.code} tabIndex={0}>
        <code>{text}</code>
      </pre>
    </figure>
  );
}
