import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/index.js';
import styles from './PromptBox.module.css';

/** "Say this": a prompt to type into the AI app, with a Copy button. */
export function PromptBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
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
    <figure className={styles.box}>
      <figcaption className={styles.label}>Say this</figcaption>
      <p className={styles.text}>{text}</p>
      <button className="btn btn-sm" onClick={copy} aria-label="Copy the prompt">
        {copied ? <Icon.Check /> : <Icon.Copy />} {copied ? 'Copied' : 'Copy'}
      </button>
    </figure>
  );
}
