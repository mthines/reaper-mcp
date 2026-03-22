import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { BridgeCommand, CommandType } from '@reaper-mcp/protocol';
import type { BridgeResponse } from '@reaper-mcp/protocol';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  getTracer,
  getTraceContext,
  getCommandDurationHistogram,
  getCommandCounter,
  getTimeoutCounter,
  getHandlerDurationHistogram,
  getPickupDurationHistogram,
  updateDeferStats,
  updateScanStats,
} from './telemetry.js';

const POLL_INTERVAL_MS = 10;
const DEFAULT_TIMEOUT_MS = 10_000;
const PROFILE_BRIDGE = process.env['BRIDGE_PROFILE'] === '1';

/** Per-command phase timing, exported for profiling tests. */
export interface BridgePhaseTimings {
  spanSetupMs: number;
  ensureDirMs: number;
  writeMs: number;
  logMs: number;
  pollWaitMs: number;
  pollAttempts: number;
  readParseMs: number;
  cleanupMs: number;
  metricsMs: number;
  totalMs: number;
}

/** Last command's phase timings — only populated when BRIDGE_PROFILE=1 */
export let lastTimings: BridgePhaseTimings | null = null;

/**
 * Resolves the REAPER resource path based on OS.
 * - macOS: ~/Library/Application Support/REAPER
 * - Windows: %APPDATA%/REAPER
 * - Linux: ~/.config/REAPER
 */
function getReaperResourcePath(): string {
  const env = process.env['REAPER_RESOURCE_PATH'];
  if (env) return env;

  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'REAPER');
    case 'win32':
      return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'REAPER');
    default: // linux
      return join(home, '.config', 'REAPER');
  }
}

function getBridgeDir(): string {
  return join(getReaperResourcePath(), 'Scripts', 'mcp_bridge_data');
}

export async function ensureBridgeDir(): Promise<string> {
  const dir = getBridgeDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Sends a command to the Lua bridge and waits for a response.
 *
 * Instrumented with:
 * - A CLIENT span named `mcp.bridge {type}` capturing the full file-IPC round-trip.
 * - A duration histogram `mcp.bridge.command.duration`.
 * - A command counter `mcp.bridge.command.count`.
 * - A timeout counter `mcp.bridge.timeout.count` (incremented on timeout).
 */
export async function sendCommand(
  type: CommandType,
  params: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<BridgeResponse> {
  const tracer = getTracer();
  const startMs = Date.now();
  const t: Record<string, number> = {};
  const profiling = PROFILE_BRIDGE;
  const now = profiling ? () => performance.now() : () => 0;
  const t0 = now();

  return tracer.startActiveSpan(
    `mcp.bridge ${type}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'mcp.command.type': type,
        'mcp.bridge.timeout_ms': timeoutMs,
      },
    },
    async (span) => {
      if (profiling) t['spanSetup'] = now() - t0;

      const tDir = now();
      const dir = await ensureBridgeDir();
      if (profiling) t['ensureDir'] = now() - tDir;

      const id = randomUUID();

      // Record command ID after it's generated — keep span name low-cardinality
      span.setAttribute('mcp.command.id', id);

      const command: BridgeCommand = {
        id,
        type,
        params,
        timestamp: Date.now(),
      };

      // Write command file, then notify file so Lua can find it without directory listing.
      // macOS/APFS caches directory listings for ~300-400ms, so reaper.EnumerateFiles
      // would not see the command file for many defer cycles. The notify file is read
      // directly by io.open(), bypassing the directory cache entirely.
      const tWrite = now();
      const commandPath = join(dir, `command_${id}.json`);
      await writeFile(commandPath, JSON.stringify(command, null, 2), 'utf-8');
      const notifyPath = join(dir, '_notify');
      await appendFile(notifyPath, id + '\n');
      if (profiling) t['write'] = now() - tWrite;

      const tLog = now();
      const traceCtx = getTraceContext();
      console.error(
        JSON.stringify({
          msg: 'bridge_command_sent',
          commandType: type,
          commandId: id,
          ...traceCtx,
        })
      );
      if (profiling) t['log'] = now() - tLog;

      // Poll for response
      const responsePath = join(dir, `response_${id}.json`);
      const deadline = Date.now() + timeoutMs;
      const tPoll = now();
      let pollAttempts = 0;

      while (Date.now() < deadline) {
        try {
          pollAttempts++;
          const tRead = now();
          const data = await readFile(responsePath, 'utf-8');
          const response: BridgeResponse = JSON.parse(data);
          if (profiling) t['readParse'] = now() - tRead;
          if (profiling) t['pollWait'] = now() - tPoll - (t['readParse'] ?? 0);

          // Cleanup files
          const tCleanup = now();
          await Promise.allSettled([unlink(commandPath), unlink(responsePath)]);
          if (profiling) t['cleanup'] = now() - tCleanup;

          // Extract bridge-side timing from response (piggybacked by Lua)
          // These fields are at the response root, not inside .data
          const rawResponse = response as unknown as Record<string, unknown>;
          const handlerMs = rawResponse['_handlerMs'] as number | undefined;
          const pickupMs = rawResponse['_pickupMs'] as number | undefined;
          const deferCycle = rawResponse['_deferCycle'] as number | undefined;

          const durationMs = Date.now() - startMs;
          const succeeded = response.success;

          span.setAttribute('mcp.response.success', succeeded);

          // Add bridge-side timing as span attributes
          if (handlerMs != null) {
            span.setAttribute('mcp.bridge.handler_ms', handlerMs);
            getHandlerDurationHistogram().record(handlerMs, {
              command_type: type,
              success: String(succeeded),
            });
          }
          if (pickupMs != null) {
            span.setAttribute('mcp.bridge.pickup_ms', pickupMs);
            getPickupDurationHistogram().record(pickupMs, {
              command_type: type,
            });
          }
          if (deferCycle != null) {
            span.setAttribute('mcp.bridge.defer_cycle', deferCycle);
          }

          if (!succeeded) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: response.error ?? 'Bridge error' });
            span.setAttribute('mcp.response.error', response.error ?? 'unknown');
            console.error(
              JSON.stringify({
                msg: 'bridge_command_error',
                commandType: type,
                commandId: id,
                error: response.error,
                durationMs,
                ...traceCtx,
              })
            );
          }

          span.end();

          // Record metrics
          const tMetrics = now();
          getCommandDurationHistogram().record(durationMs, { command_type: type });
          getCommandCounter().add(1, { command_type: type, success: String(succeeded) });
          if (profiling) t['metrics'] = now() - tMetrics;

          if (profiling) {
            lastTimings = {
              spanSetupMs: Math.round(t['spanSetup'] ?? 0),
              ensureDirMs: Math.round(t['ensureDir'] ?? 0),
              writeMs: Math.round(t['write'] ?? 0),
              logMs: Math.round(t['log'] ?? 0),
              pollWaitMs: Math.round(t['pollWait'] ?? 0),
              pollAttempts,
              readParseMs: Math.round(t['readParse'] ?? 0),
              cleanupMs: Math.round(t['cleanup'] ?? 0),
              metricsMs: Math.round(t['metrics'] ?? 0),
              totalMs: Math.round(now() - t0),
            };
          }

          return response;
        } catch {
          // File doesn't exist yet — keep polling
          await sleep(POLL_INTERVAL_MS);
        }
      }

      // Timeout — cleanup command file
      await unlink(commandPath).catch(() => { /* cleanup best-effort */ });

      const durationMs = Date.now() - startMs;
      const timeoutMsg = `Timeout: no response from REAPER Lua bridge after ${timeoutMs}ms. Is the bridge script running in REAPER?`;

      span.setAttribute('mcp.response.success', false);
      span.setAttribute('mcp.response.error', 'timeout');
      span.setStatus({ code: SpanStatusCode.ERROR, message: timeoutMsg });
      span.end();

      // Record metrics
      getCommandDurationHistogram().record(durationMs, { command_type: type });
      getCommandCounter().add(1, { command_type: type, success: 'false' });
      getTimeoutCounter().add(1, { command_type: type });

      console.error(
        JSON.stringify({
          msg: 'bridge_command_timeout',
          commandType: type,
          commandId: id,
          timeoutMs,
          ...traceCtx,
        })
      );

      return {
        id,
        success: false,
        error: timeoutMsg,
        timestamp: Date.now(),
      };
    }
  );
}

/**
 * Check if the bridge appears to be running by looking for a heartbeat file.
 */
export async function isBridgeRunning(): Promise<boolean> {
  const dir = getBridgeDir();
  const heartbeatPath = join(dir, 'heartbeat.json');
  try {
    const info = await stat(heartbeatPath);
    // Consider bridge running if heartbeat was updated in the last 5 seconds
    return Date.now() - info.mtimeMs < 5_000;
  } catch {
    return false;
  }
}

/**
 * Clean up stale command/response files older than maxAge.
 */
export async function cleanupStaleFiles(maxAgeMs = 30_000): Promise<number> {
  const dir = getBridgeDir();
  let cleaned = 0;
  try {
    const files = await readdir(dir);
    const now = Date.now();
    for (const file of files) {
      if (!file.startsWith('command_') && !file.startsWith('response_')) continue;
      const filePath = join(dir, file);
      const info = await stat(filePath);
      if (now - info.mtimeMs > maxAgeMs) {
        await unlink(filePath).catch(() => { /* cleanup best-effort */ });
        cleaned++;
      }
    }
  } catch {
    // Bridge dir might not exist yet
  }
  return cleaned;
}

export function getReaperScriptsPath(): string {
  return join(getReaperResourcePath(), 'Scripts');
}

export function getReaperEffectsPath(): string {
  return join(getReaperResourcePath(), 'Effects');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Bridge telemetry pollers
// ---------------------------------------------------------------------------

/**
 * Read and consume bridge events from the JSONL log file.
 * Emits each event as a structured log to stderr.
 */
export async function readBridgeEvents(): Promise<void> {
  const eventsPath = join(getBridgeDir(), 'bridge_events.jsonl');
  let content: string;
  try {
    content = await readFile(eventsPath, 'utf-8');
  } catch {
    return; // File does not exist — normal on first run
  }

  // Truncate to prevent re-processing
  await writeFile(eventsPath, '', 'utf-8').catch(() => {});

  const lines = content.split('\n').filter((l) => l.trim() !== '');
  for (const line of lines) {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      console.error(JSON.stringify({ msg: 'bridge_event', ...evt }));
    } catch {
      // skip malformed lines
    }
  }
}

let _diagnosticsTimer: ReturnType<typeof setInterval> | null = null;
let _eventsTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically fetch bridge diagnostics and update OTel gauge state.
 */
export function startDiagnosticsPoller(intervalMs = 60_000): void {
  if (_diagnosticsTimer) return;
  _diagnosticsTimer = setInterval(async () => {
    try {
      const res = await sendCommand(
        '_bridge_diagnostics' as Parameters<typeof sendCommand>[0],
        {},
        5_000,
      );
      if (res.success && res.data) {
        const d = res.data as {
          deferIntervals?: { p50Ms: number; p95Ms: number };
          scanDurations?: { avgMs: number; maxMs: number };
        };
        if (d.deferIntervals) {
          updateDeferStats(d.deferIntervals.p50Ms, d.deferIntervals.p95Ms);
        }
        if (d.scanDurations) {
          updateScanStats(d.scanDurations.avgMs, d.scanDurations.maxMs);
        }
      }
    } catch {
      // Diagnostics failure is non-fatal
    }
  }, intervalMs);
}

/**
 * Periodically read bridge event log for crash detection / lifecycle events.
 */
export function startEventsPoller(intervalMs = 30_000): void {
  if (_eventsTimer) return;
  // Read once at startup
  readBridgeEvents().catch(() => {});
  _eventsTimer = setInterval(
    () => readBridgeEvents().catch(() => {}),
    intervalMs,
  );
}

/**
 * Stop all bridge telemetry pollers.
 */
export function stopPollers(): void {
  if (_diagnosticsTimer) {
    clearInterval(_diagnosticsTimer);
    _diagnosticsTimer = null;
  }
  if (_eventsTimer) {
    clearInterval(_eventsTimer);
    _eventsTimer = null;
  }
}
