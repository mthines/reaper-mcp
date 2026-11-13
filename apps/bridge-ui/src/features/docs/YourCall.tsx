import styles from './YourCall.module.css';

/** "Your call": what stays the user's decision. Every recipe ends its steps with one. */
export function YourCall({ text }: { text: string }) {
  return (
    <aside className={styles.box} aria-label="Your call">
      <strong className={styles.label}>Your call</strong>
      <p className={styles.text}>{text}</p>
    </aside>
  );
}
