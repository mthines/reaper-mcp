import { sidecarAction } from '../../lib/sidecar.js';
import { useSidecarInstall } from './install-context.js';
import styles from './SidecarFix.module.css';

const logOf = (log: unknown): string[] => (Array.isArray(log) ? (log as string[]) : []);

/**
 * How to fix a missing sidecar: an Install button when the bridge can run `reaper-mcp setup-sidecar` itself (the same
 * way it runs an update), progress while it runs, and the command to run by hand when it can't or it failed.
 * `compact` is for a notice that already names the command in its own text: only the button or the progress, one line.
 */
export function SidecarFix({ command, compact = false }: { command: string; compact?: boolean }) {
  const install = useSidecarInstall();
  const action = sidecarAction(command);
  const control = install?.control;
  const job = control?.sidecar?.kind === action ? control.sidecar : undefined;
  const lines = logOf(job?.log);
  const byHand = (
    <>
      Or run <code>{command}</code> in a terminal.
    </>
  );

  if (compact) {
    if (job?.state === 'running') return <span className={styles.compact} role="status" title={lines[lines.length - 1]}>Installing…</span>;
    if (job?.state === 'done') return <span className={styles.compact} role="status">Installed. Ask the agent to try again.</span>;
    if (control?.canInstallSidecar && install) {
      return (
        <button className="btn btn-sm" onClick={() => install.request(action)} title={job?.state === 'failed' ? lines.join('\n') : undefined}>
          {job?.state === 'failed' ? 'Install failed. Try again' : 'Install'}
        </button>
      );
    }
    return null;
  }
  if (job?.state === 'running') {
    return (
      <div className={styles.fix} data-state="running" role="status">
        <b>Installing…</b> This downloads the analysis tools and can take a few minutes.
        {lines.length > 0 && <span className={styles.log}>{lines[lines.length - 1]}</span>}
      </div>
    );
  }
  if (job?.state === 'done') {
    return (
      <div className={styles.fix} data-state="done" role="status">
        <b>Installed.</b> Ask the agent to try again.
      </div>
    );
  }
  return (
    <div className={styles.fix} data-state={job?.state === 'failed' ? 'failed' : 'idle'}>
      {job?.state === 'failed' && (
        <>
          <b>The install failed.</b>
          {lines.length > 0 && <pre className={styles.failLog}>{lines.join('\n')}</pre>}
        </>
      )}
      {control?.canInstallSidecar && install ? (
        <span className={styles.row}>
          <button className="btn btn-sm" onClick={() => install.request(action)}>
            {job?.state === 'failed' ? 'Try again' : 'Install'}
          </button>
          <span className={styles.hint}>{byHand}</span>
        </span>
      ) : (
        <span className={styles.hint}>
          Run <code>{command}</code> in a terminal, then ask the agent to try again.
        </span>
      )}
    </div>
  );
}
