import { useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import type { CSSProperties } from 'react';
import type { BridgeAction } from '../lib/update.js';
import { markUpdateReady, updateLog } from '../lib/update.js';
import type { BridgeStatus } from '../lib/status.js';
import { track } from '../lib/analytics.js';

const TOAST_ID = 'reaper-mcp-update';

/** The installer prints "==> Downloading the new version"; the toast shows it without the arrow. */
function stepText(line: string | undefined): string {
  return (line ?? '').replace(/^=+>\s*/, '').trim();
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
  request,
  onReload = () => location.reload(),
}: {
  status: BridgeStatus | null;
  request: (action: BridgeAction) => void;
  onReload?: () => void;
}) {
  const update = status?.control?.update;
  const runStartedAt = status?.startedAt;
  const watched = useRef(false);
  const source = status?.control?.updateSource ?? 'clone';
  const state = update?.kind === 'rebuild' ? undefined : update?.state;
  const step = stepText(updateLog(update).at(-1));

  useEffect(() => {
    if (runStartedAt === undefined) return;
    if (state === 'running') {
      watched.current = true;
      toast.loading('Updating reaper-mcp…', {
        id: TOAST_ID,
        description: step || 'Downloading the new version. You can keep working.',
        duration: Infinity,
      });
    } else if (state === 'failed') {
      if (!watched.current) return;
      watched.current = false;
      track({ name: 'update_finished', result: 'failed', source });
      toast.error('The update didn’t finish', {
        id: TOAST_ID,
        description: step || 'Nothing was changed. Try again in a minute.',
        duration: Infinity,
        action: { label: 'Try again', onClick: () => request('update') },
      });
    } else if (watched.current && (state === 'done' || state === undefined)) {
      // done, or the bridge restarted into the new version and no longer remembers the update
      watched.current = false;
      markUpdateReady();
      track({ name: 'update_finished', result: 'ready', source });
      toast.success('reaper-mcp is up to date', {
        id: TOAST_ID,
        description: 'Reload this page to use the new version. Then restart Claude Code, or type /mcp there, to get the new tools.',
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
  }, [state, step, runStartedAt, request, onReload, source]);

  return <Toaster position="bottom-right" theme="dark" style={THEME} />;
}
