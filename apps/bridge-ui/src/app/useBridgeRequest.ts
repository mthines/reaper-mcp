import { useEffect, useRef } from 'react';
import { controlUrl, type BridgeAction } from '../lib/update.js';
import type { BridgeStatus } from '../lib/status.js';
import { DEMO } from './demo-mode.js';

export type BridgeRequest = (action: BridgeAction) => void;

/**
 * Send an update/restart request to the bridge. A restart or a developer rebuild reloads the page once the bridge comes
 * back as a new run (its startedAt changes), since the installer may have replaced this page too. A release update never
 * reloads by itself: UpdateToasts tells the person it is ready and Reload is theirs to press, so nothing is lost mid-read.
 */
export function useBridgeRequest(status: BridgeStatus | null): BridgeRequest {
  const expectRestart = useRef(false);
  const update = status?.control?.update;
  const rebuild = update?.kind === 'rebuild';
  useEffect(() => {
    if (rebuild) expectRestart.current = true;
  }, [rebuild]);
  const runStartedAt = status?.startedAt;
  const startedAt = useRef(runStartedAt);
  useEffect(() => {
    if (runStartedAt === undefined || runStartedAt === startedAt.current) return;
    const restarted = startedAt.current !== undefined;
    startedAt.current = runStartedAt;
    if (restarted && expectRestart.current) location.reload();
  }, [runStartedAt]);
  // An update that left the bridge script as it was doesn't restart it, but the installer still replaced this page
  useEffect(() => {
    if (update?.state !== 'done' || !rebuild || DEMO) return;
    const key = `mcp-bridge-reloaded-${update.startedAt}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      return; // no way to remember the reload: never risk a reload loop
    }
    location.reload();
  }, [update?.state, update?.startedAt, rebuild]);
  return (action) => {
    const token = status?.control?.token;
    if (!token || DEMO) return;
    if (action !== 'update') expectRestart.current = true;
    fetch(controlUrl(action, token), { cache: 'no-store' }).catch(() => {
      /* the bridge's status shows whether it took */
    });
  };
}
