import { useEffect, useRef } from 'react';
import { Toaster } from 'sonner';
import { CLONE_INSTALL_DOC, failureReason, markUpdateReady, updateLog } from '../lib/update.js';
import type { BridgeStatus } from '../lib/status.js';
import { track } from '../lib/analytics.js';
import { JOB_TOAST_THEME, JobFailure, jobToast, lastStep } from '../components/index.js';

const TOAST_ID = 'reaper-mcp-update';

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
  const step = lastStep(log);
  // A string, so the effect below re-runs when the reason changes, not on every poll's fresh log array
  const failure = state === 'failed' ? (failureReason(log) ?? 'Nothing was changed. Use Try again in the notice above.') : undefined;

  useEffect(() => {
    if (runStartedAt === undefined) return;
    if (state === 'running') {
      watched.current = true;
      jobToast.running(TOAST_ID, 'Updating reaper-mcp…', step || 'Downloading the new version. You can keep working.');
    } else if (state === 'current') {
      if (!watched.current) return;
      watched.current = false;
      track({ name: 'update_finished', result: 'current', source });
      jobToast.info(TOAST_ID, 'Already up to date', 'There is no newer version to install yet.');
    } else if (state === 'failed') {
      if (!watched.current) return;
      watched.current = false;
      track({ name: 'update_finished', result: 'failed', source });
      jobToast.failed(
        TOAST_ID,
        'Update failed',
        <JobFailure>
          <span>{failure}</span>
          {source === 'npm' && (
            <span>
              Installing from a clone avoids npm.{' '}
              <a href={CLONE_INSTALL_DOC} target="_blank" rel="noreferrer">See how</a>
            </span>
          )}
        </JobFailure>,
      );
    } else if (watched.current && (state === 'done' || state === undefined)) {
      // done, or the bridge restarted into the new version and no longer remembers the update
      watched.current = false;
      markUpdateReady();
      track({ name: 'update_finished', result: 'ready', source });
      jobToast.done(TOAST_ID, 'reaper-mcp is up to date', 'Reload this page to use the new version. Then restart Claude Code, or type /mcp there, to get the new tools.', {
        label: 'Reload',
        onClick: () => {
          track({ name: 'update_reload_clicked', source });
          onReload();
        },
      });
    }
  }, [state, step, failure, runStartedAt, onReload, source]);

  return <Toaster position="bottom-right" theme="dark" style={JOB_TOAST_THEME} closeButton />;
}
