import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { AUTOSTART_MARKER } from './cli.js';
import type { BridgeStatus } from './bridge.js';

/**
 * How far each server start got with setup, as closed values for the startup span (usage telemetry keeps
 * them: ALLOWED_SPAN_ATTRIBUTES). `reaper.bridge.state` alone can't tell why a bridge is down: `stale`
 * covers both "REAPER is closed" (often just a Claude Code session with no music in it) and "REAPER is
 * open but the bridge stopped" (a setup gap), and nothing said whether the bridge starts with REAPER or
 * whether the audio sidecar is there.
 */

/** How long ago the bridge last wrote its heartbeat, in ranges coarse enough to say nothing about a person. */
export type HeartbeatAge = '<1m' | '1m-1h' | '1h-1d' | '1d-7d' | '>7d';

export function heartbeatAgeBucket(ms: number): HeartbeatAge {
  const min = 60_000;
  if (ms < min) return '<1m';
  if (ms < 60 * min) return '1m-1h';
  if (ms < 24 * 60 * min) return '1h-1d';
  if (ms < 7 * 24 * 60 * min) return '1d-7d';
  return '>7d';
}

/**
 * Whether a REAPER process is running: `pgrep` on macOS and Linux, `tasklist` on Windows.
 * Undefined when that could not be found out (no pgrep, or it took longer than `timeoutMs`).
 */
export function isReaperProcessRunning(timeoutMs = 2000): Promise<boolean | undefined> {
  const win = platform() === 'win32';
  const [cmd, args] = win ? ['tasklist', ['/FI', 'IMAGENAME eq reaper.exe', '/NH']] : ['pgrep', ['-xi', 'reaper']];
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (win) return resolve(err ? undefined : /reaper\.exe/i.test(String(stdout)));
      if (!err) return resolve(true);
      // pgrep exits 1 when nothing matches; anything else (missing, killed by the timeout) is unknown
      resolve(Number((err as { code?: unknown }).code) === 1 ? false : undefined);
    });
  });
}

/** Whether REAPER's Scripts/__startup.lua holds the block that starts the bridge with REAPER. */
export function autostartInstalled(scriptsDir: string): boolean {
  try {
    return readFileSync(join(scriptsDir, '__startup.lua'), 'utf-8').includes(AUTOSTART_MARKER);
  } catch {
    return false;
  }
}

export interface SetupHealth {
  status: BridgeStatus;
  /** isReaperProcessRunning(); only looked up when the bridge did not answer */
  reaperRunning?: boolean;
  autostart: boolean;
  sidecarInstalled: boolean;
}

/**
 * The startup span's setup attributes. Each is set only where it means something:
 * - `reaper.sidecar.installed`: always
 * - `reaper.bridge.autostart`: when the bridge is installed (connected, stale, never_started)
 * - `reaper.app.running`: when the bridge did not answer, so `stale` + false is "REAPER closed" and
 *   `stale` + true is "REAPER open, bridge stopped"
 * - `reaper.bridge.heartbeat_age`: when the heartbeat is stale
 */
export function setupHealthAttributes(h: SetupHealth): Record<string, string | boolean> {
  const attrs: Record<string, string | boolean> = { 'reaper.sidecar.installed': h.sidecarInstalled };
  const { state, heartbeatAgeMs } = h.status;
  if (state === 'connected' || state === 'stale' || state === 'never_started') attrs['reaper.bridge.autostart'] = h.autostart;
  if (state !== 'connected' && h.reaperRunning !== undefined) attrs['reaper.app.running'] = h.reaperRunning;
  if (state === 'stale' && heartbeatAgeMs !== undefined) attrs['reaper.bridge.heartbeat_age'] = heartbeatAgeBucket(heartbeatAgeMs);
  return attrs;
}
