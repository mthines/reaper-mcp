import type { ReactNode } from 'react';
import styles from './Notice.module.css';

export function Notice({ tone, action, children }: { tone: 'warn' | 'bad' | 'info'; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.notice} data-tone={tone} role="status">
      <span className={styles.noticeDot} aria-hidden />
      <span className={styles.noticeText}>{children}</span>
      {action}
    </div>
  );
}
