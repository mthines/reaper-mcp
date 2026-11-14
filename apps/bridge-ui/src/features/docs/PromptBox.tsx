import { Icon } from '../../components/index.js';
import { trackSite } from '../../lib/analytics.js';
import { useCopy } from '../../lib/useCopy.js';
import styles from './PromptBox.module.css';

/** "Say this": a prompt to type into the AI app, with a Copy button. */
export function PromptBox({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  const done = copied === 'prompt';
  const copyPrompt = () => {
    void copy(text, 'prompt');
    trackSite({ name: 'prompt_copied' });
  };
  return (
    <figure className={styles.box}>
      <figcaption className={styles.label}>Say this</figcaption>
      <p className={styles.text}>{text}</p>
      <button className="btn btn-sm" onClick={copyPrompt} data-capture="off" aria-label="Copy the prompt">
        {done ? <Icon.Check /> : <Icon.Copy />} {done ? 'Copied' : 'Copy'}
      </button>
    </figure>
  );
}
