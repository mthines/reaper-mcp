import { useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import type { CSSProperties } from 'react';
import { CLONE_INSTALL_DOC, failureReason, markUpdateReady, updateLog } from '../lib/update.js';
import type { BridgeStatus } from '../lib/status.js';
import { track } from '../lib/analytics.js';
import styles from './UpdateToasts.module.css';

const TOAST_ID = 'reaper-mcp-update';

/** The installer prints "==> Downloading the new version"; the toast shows it without the arrow. */
function stepText(line: string | undefined): string {
  return (line ?? '').replace(/^=+>\s*/, '').trim();
}

/** Text that replays a short enter animation each time it changes (the keyed span remounts). */
function Swap({ text }: { text: string }) {
  return (
    <span key={text} className={styles.swap}>
      {text}
    </span>
  );
}

const THEME = {
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

/**
 * The update, in the background: one click on Update and a toast follows it. It says the download is running (the page keeps
 * working), then, when the new version is installed, that it is ready with a Reload button. Reload is the person's to press:
 * the page never reloads under someone who is reading a call. A developer's rebuild reloads by itself (useBridgeRequest).
 *
 * Only an update this page watched start gets a toast. The bridge keeps "done" and "failed" until it restarts, so a page
 * opened later would otherwise offer Reload on every visit (Notices still shows a failed update).
 */
export function UpdateToasts({
  status,
  onReload = () => location.reload(),
}: {
  status: BridgeStatus | null;
  onReload?: () => void;
}) {
  const update = status?.control?.update;
  const runStartedAt = status?.startedAt;
  const watched = useRef(false);
  const source = status?.control?.updateSource ?? 'clone';
  const state = update?.kind === 'rebuild' ? undefined : update?.state;
  const log = updateLog(update);
  const step = stepText(log.at(-1));

  useEffect(() => {
    if (runStartedAt === undefined) return;
    if (state === 'running') {
      watched.current = true;
      toast.loading(<Swap text="Updating reaper-mcp…" />, {
        id: TOAST_ID,
        description: <Swap text={step || 'Downloading the new version. You can keep working.'} />,
        duration: Infinity,
        action: undefined, // an update with the same id keeps the old toast's action unless it is cleared
      });
    } else if (state === 'current') {
      if (!watched.current) return;
      watched.current = false;
      track({ name: 'update_finished', result: 'current', source });
      toast.info(<Swap text="Already up to date" />, { id: TOAST_ID, description: <Swap text="There is no newer version to install yet." />, duration: 8000, action: undefined });
    } else if (state === 'failed') {
      if (!watched.current) return;
      watched.current = false;
      track({ name: 'update_finished', result: 'failed', source });
      const reason = failureReason(log) ?? 'Nothing was changed. Use Try again in the notice above.';
      toast.error(<Swap text="Update failed" />, {
        id: TOAST_ID,
        className: styles.failed,
        description: (
          <span className={styles.failure}>
            <Swap text={reason} />
            {source === 'npm' && (
              <span>
                Installing from a clone avoids npm.{' '}
                <a href={CLONE_INSTALL_DOC} target="_blank" rel="noreferrer">See how</a>
              </span>
            )}
          </span>
        ),
        duration: Infinity,
        action: undefined,
      });
    } else if (watched.current && (state === 'done' || state === undefined)) {
      // done, or the bridge restarted into the new version and no longer remembers the update
      watched.current = false;
      markUpdateReady();
      track({ name: 'update_finished', result: 'ready', source });
      toast.success(<Swap text="reaper-mcp is up to date" />, {
        id: TOAST_ID,
        description: <Swap text="Reload this page to use the new version. Then restart Claude Code, or type /mcp there, to get the new tools." />,
        duration: Infinity,
        action: {
          label: 'Reload',
          onClick: () => {
            track({ name: 'update_reload_clicked', source });
            onReload();
          },
        },
      });
    }
  }, [state, step, log, runStartedAt, onReload, source]);

  return <Toaster position="bottom-right" theme="dark" style={THEME} closeButton />;
}
