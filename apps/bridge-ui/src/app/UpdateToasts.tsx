import { useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { CLONE_INSTALL_DOC, failureReason, markUpdateReady, rememberUpdatedFrom, takeUpdatedFrom, updateLog } from '../lib/update.js';
import type { BridgeStatus } from '../lib/status.js';
import { track } from '../lib/analytics.js';
import { JOB_TOAST_THEME, JobFailure, Swap, jobToast, lastStep } from '../components/index.js';

const TOAST_ID = 'reaper-mcp-update';
const WHATS_NEW_TOAST_ID = 'reaper-mcp-whats-new';
const WHATS_NEW_MS = 30_000;

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
  onOpenChangelog = () => undefined,
  version = __VERSION__,
}: {
  status: BridgeStatus | null;
  onReload?: () => void;
  /** Opens What's new, from the toast shown after an update's reload */
  onOpenChangelog?: () => void;
  /** The version this page is, to tell a reload that picked up the update from one that did not */
  version?: string;
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

  // The toast outlives renders, so its button calls the latest handler
  const openChangelog = useRef(onOpenChangelog);
  useEffect(() => {
    openChangelog.current = onOpenChangelog;
  });
  // The first status says which install this is; taking the note earlier would report an npm install as a clone
  const loaded = status !== null;
  // After the update's reload: this page is the new version, so point at what changed (once, for 30 s)
  useEffect(() => {
    if (!loaded || takeUpdatedFrom(version) === null) return;
    track({ name: 'update_whats_new_shown', source });
    toast.success(<Swap text={`reaper-mcp v${version} is ready`} />, {
      id: WHATS_NEW_TOAST_ID,
      description: <Swap text="Check out what's new since this update." />,
      duration: WHATS_NEW_MS,
      action: {
        label: "See what's new",
        onClick: () => openChangelog.current(),
      },
    });
  }, [loaded, version, source]);

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
      rememberUpdatedFrom(version);
      track({ name: 'update_finished', result: 'ready', source });
      jobToast.done(TOAST_ID, 'reaper-mcp is up to date', 'Reload this page to use the new version. Then restart Claude Code, or type /mcp there, to get the new tools.', {
        label: 'Reload',
        onClick: () => {
          track({ name: 'update_reload_clicked', source });
          onReload();
        },
      });
    }
  }, [state, step, failure, runStartedAt, onReload, source, version]);

  return <Toaster position="bottom-right" theme="dark" style={JOB_TOAST_THEME} closeButton />;
}
