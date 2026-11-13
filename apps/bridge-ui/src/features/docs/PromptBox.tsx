import { Icon } from '../../components/index.js';
import { useCopy } from '../../lib/useCopy.js';
import styles from './PromptBox.module.css';

/** "Say this": a prompt to type into the AI app, with a Copy button. */
export function PromptBox({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  const done = copied === 'prompt';
  return (
    <figure className={styles.box}>
      <figcaption className={styles.label}>Say this</figcaption>
      <p className={styles.text}>{text}</p>
      <button className="btn btn-sm" onClick={() => void copy(text, 'prompt')} aria-label="Copy the prompt">
        {done ? <Icon.Check /> : <Icon.Copy />} {done ? 'Copied' : 'Copy'}
      </button>
    </figure>
  );
}
