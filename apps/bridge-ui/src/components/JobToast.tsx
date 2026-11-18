import type { CSSProperties, ReactNode } from 'react';
import { toast } from 'sonner';
import styles from './JobToast.module.css';

/**
 * The toasts of a background job the bridge runs and the page follows (the update, the sidecar install; the pattern is
 * in .claude/rules/background-jobs.md). One toast per job, kept by its id: it says the job is running, then how it ended.
 * Every job's toast goes through these, so they look and behave alike.
 */

/** Text that replays a short enter animation each time it changes (the keyed span remounts). */
export function Swap({ text }: { text: string }) {
  return (
    <span key={text} className={styles.swap}>
      {text}
    </span>
  );
}

/** A job prints "==> Downloading the new version"; the toast shows the step without the arrow. */
export function stepText(line: string | undefined): string {
  return (line ?? '').replace(/^=+>\s*/, '').trim();
}

/** The last line of a job's log as a step; a Lua table that was empty arrives as `{}`, so anything but an array has none. */
export function lastStep(log: unknown): string {
  return stepText(Array.isArray(log) ? (log as string[]).at(-1) : undefined);
}

/** The toast colours, from the page's tokens: pass to the one `<Toaster style>` */
export const JOB_TOAST_THEME = {
  '--normal-bg': 'var(--panel-2)',
  '--normal-border': 'var(--line-2)',
  '--normal-text': 'var(--text)',
  '--success-bg': 'var(--panel-2)',
  '--success-border': 'var(--line-2)',
  '--success-text': 'var(--text)',
  '--error-bg': 'var(--panel-2)',
  '--error-border': 'var(--bad)',
  '--error-text': 'var(--text)',
  fontFamily: 'var(--sans)',
} as CSSProperties;

/** The reason a job failed and, under it, the way out: lay them out as a column */
export function JobFailure({ children }: { children: ReactNode }) {
  return <span className={styles.failure}>{children}</span>;
}

// An update with the same id keeps the old toast's action unless it is cleared, so every call sets `action`.
export const jobToast = {
  /** It is working: a spinner, the step in words. Stays until the job ends. */
  running(id: string, title: string, step: string) {
    toast.loading(<Swap text={title} />, { id, description: <Swap text={step} />, duration: Infinity, action: undefined });
  },
  /** It ended and changed nothing worth a result (already up to date). Goes away by itself. */
  info(id: string, title: string, description: string) {
    toast.info(<Swap text={title} />, { id, description: <Swap text={description} />, duration: 8000, action: undefined });
  },
  /** It worked. `action` is what to do next (Reload); without one the toast goes away by itself. */
  done(id: string, title: string, description: string, action?: { label: string; onClick: () => void }) {
    toast.success(<Swap text={title} />, { id, description: <Swap text={description} />, duration: action ? Infinity : 10_000, action });
  },
  /** It failed: a red title, the reason, the way out. Stays until dismissed. */
  failed(id: string, title: string, description: ReactNode) {
    toast.error(<Swap text={title} />, { id, className: styles.failed, description, duration: Infinity, action: undefined });
  },
};
