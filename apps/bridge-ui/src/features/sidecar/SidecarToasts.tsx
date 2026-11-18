import { useEffect, useRef } from 'react';
import type { BridgeSidecarInstall, BridgeStatus } from '../../lib/status.js';
import { JobFailure, jobToast, lastStep } from '../../components/index.js';
import { SETUP_SIDECAR_COMMAND } from '../../lib/sidecar.js';

const TOAST_ID = 'reaper-mcp-sidecar';

const PART: Record<BridgeSidecarInstall['kind'], string> = {
  sidecar: 'audio analysis',
  sidecarsep: 'stem separation',
  sidecarchords: 'the chord model',
};

/**
 * The sidecar install, in the background: one click on Install and a toast follows it (installing, then done or failed),
 * like the update's. It only speaks for an install this page watched start: the bridge keeps "done" and "failed" until
 * it restarts, so a page opened later would otherwise announce an old install. The Toaster is UpdateToasts's.
 */
export function SidecarToasts({ status }: { status: BridgeStatus | null }) {
  const job = status?.control?.sidecar;
  const state = job?.state;
  const part = job ? PART[job.kind] : 'audio analysis';
  const step = lastStep(job?.log);
  const watched = useRef(false);

  useEffect(() => {
    if (state === 'running') {
      watched.current = true;
      jobToast.running(TOAST_ID, `Installing ${part}…`, step || 'Downloading what it needs. You can keep working.');
    } else if (state === 'done' && watched.current) {
      watched.current = false;
      jobToast.done(TOAST_ID, `${part[0].toUpperCase()}${part.slice(1)} is installed`, 'Ask the agent to try again.');
    } else if (state === 'failed' && watched.current) {
      watched.current = false;
      jobToast.failed(
        TOAST_ID,
        'The install failed',
        <JobFailure>
          {step && <span>{step}</span>}
          <span>Run {SETUP_SIDECAR_COMMAND} in a terminal to see why.</span>
        </JobFailure>,
      );
    }
  }, [state, part, step]);

  return null;
}
