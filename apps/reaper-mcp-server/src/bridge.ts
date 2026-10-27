import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { BridgeCommand, CommandType } from '@reaper-mcp/protocol';
import type { BridgeResponse } from '@reaper-mcp/protocol';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  getTracer,
  emitLog,
  exceptionAttributes,
  redactHome,
  getCommandDurationHistogram,
  getHandlerDurationHistogram,
  getPickupDurationHistogram,
  updateBridgeDiagnostics,
  type LogLevel,
} from './telemetry.js';

const POLL_INTERVAL_MS = 10;

// RPC identity for bridge spans: Dash0 classifies them as RPC and groups by command.
const BRIDGE_RPC_SYSTEM = 'reaper_bridge';
const BRIDGE_RPC_SERVICE = 'reaper.Bridge';
const DEFAULT_TIMEOUT_MS = 10_000;
const PROFILE_BRIDGE = process.env['BRIDGE_PROFILE'] === '1';

/** Per-command phase timing, exported for profiling tests. */
export interface BridgePhaseTimings {
  spanSetupMs: number;
  ensureDirMs: number;
  writeMs: number;
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
export function getReaperResourcePath(): string {
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

// Bounded `error.type` values for bridge commands (metric + span attribute).
export type BridgeErrorType = 'timeout' | 'handler_crash' | 'unknown_command' | 'command_failed';

/** Classify a failed bridge response by the error prefixes mcp_bridge.lua writes. */
export function classifyBridgeError(error: string | undefined): BridgeErrorType {
  if (error?.startsWith('Handler error:')) return 'handler_crash';
  if (error?.startsWith('Unknown command type')) return 'unknown_command';
  return 'command_failed';
}

/**
 * Sends a command to the Lua bridge and waits for a response.
 *
 * Instrumented with:
 * - A CLIENT span `reaper.Bridge/{type}` (RPC conventions: `rpc.system`,
 *   `rpc.service`, `rpc.method`) covering the full file-IPC round-trip.
 * - `reaper.bridge.command.duration` — round-trip histogram by `rpc.method`
 *   and `error.type`; its count is the command rate and error rate.
 * - `reaper.bridge.handler.duration` / `reaper.bridge.pickup.duration` from
 *   the timing Lua piggybacks on the response.
 * - A warn/error log on failure, correlated to the span.
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
    `${BRIDGE_RPC_SERVICE}/${type}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'rpc.system': BRIDGE_RPC_SYSTEM,
        'rpc.service': BRIDGE_RPC_SERVICE,
        'rpc.method': type,
        'peer.service': 'reaper',
        'reaper.bridge.timeout_ms': timeoutMs,
      },
    },
    async (span) => {
      const finish = (errorType?: string): void => {
        const attrs: Record<string, string> = { 'rpc.method': type };
        if (errorType) {
          attrs['error.type'] = errorType;
          span.setAttribute('error.type', errorType);
        }
        span.end();
        getCommandDurationHistogram().record((Date.now() - startMs) / 1000, attrs);
      };

      try {
        if (profiling) t['spanSetup'] = now() - t0;

        const tDir = now();
        const dir = await ensureBridgeDir();
        if (profiling) t['ensureDir'] = now() - tDir;

        const id = randomUUID();
        // High-cardinality — span attribute only, never a metric attribute or span name.
        span.setAttribute('reaper.bridge.command.id', id);

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

            const errorType = response.success ? undefined : classifyBridgeError(response.error);

            span.setAttribute('reaper.bridge.poll_attempts', pollAttempts);
            if (handlerMs != null) {
              span.setAttribute('reaper.bridge.handler_ms', handlerMs);
              getHandlerDurationHistogram().record(handlerMs / 1000, {
                'rpc.method': type,
                ...(errorType && { 'error.type': errorType }),
              });
            }
            if (pickupMs != null) {
              span.setAttribute('reaper.bridge.pickup_ms', pickupMs);
              getPickupDurationHistogram().record(pickupMs / 1000);
            }
            if (deferCycle != null) {
              span.setAttribute('reaper.bridge.defer_cycle', deferCycle);
            }

            if (errorType) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: redactHome(response.error ?? 'Bridge error') });
              // A handler returning an error (bad track index, missing FX) is an
              // expected rejection — warn. A Lua crash or unknown command is a bug — error.
              emitLog(
                errorType === 'command_failed' ? 'warn' : 'error',
                `Bridge command ${type} failed: ${response.error ?? 'unknown error'}`,
                {
                  'rpc.method': type,
                  'reaper.bridge.command.id': id,
                  'error.type': errorType,
                  'reaper.bridge.duration_ms': Date.now() - startMs,
                },
                { eventName: 'reaper.bridge.command.failed' },
              );
            }

            const tMetrics = now();
            finish(errorType);
            if (profiling) t['metrics'] = now() - tMetrics;

            if (profiling) {
              lastTimings = {
                spanSetupMs: Math.round(t['spanSetup'] ?? 0),
                ensureDirMs: Math.round(t['ensureDir'] ?? 0),
                writeMs: Math.round(t['write'] ?? 0),
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
            // File doesn't exist yet (or is mid-write) — keep polling
            await sleep(POLL_INTERVAL_MS);
          }
        }

        // Timeout — cleanup command file
        await unlink(commandPath).catch(() => { /* cleanup best-effort */ });

        const timeoutMsg = `Timeout: no response from REAPER Lua bridge after ${timeoutMs}ms. Is the bridge script running in REAPER?`;

        span.setAttribute('reaper.bridge.poll_attempts', pollAttempts);
        span.setStatus({ code: SpanStatusCode.ERROR, message: timeoutMsg });
        emitLog(
          'error',
          `Bridge command ${type} timed out after ${timeoutMs}ms`,
          { 'rpc.method': type, 'reaper.bridge.command.id': id, 'error.type': 'timeout', 'reaper.bridge.timeout_ms': timeoutMs },
          { eventName: 'reaper.bridge.command.timeout' },
        );
        finish('timeout');

        return {
          id,
          success: false,
          error: timeoutMsg,
          timestamp: Date.now(),
        };
      } catch (err) {
        // Writing the command file failed (permissions, disk full, bad REAPER_RESOURCE_PATH)
        const errorType = (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.name : 'Error');
        span.setStatus({ code: SpanStatusCode.ERROR, message: redactHome(err instanceof Error ? err.message : String(err)) });
        emitLog('error', `Bridge command ${type} could not be sent`, {
          'rpc.method': type,
          'error.type': errorType,
          ...exceptionAttributes(err),
        });
        finish(errorType);
        throw err;
      }
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

export function getReaperWwwPath(): string {
  return join(getReaperResourcePath(), 'reaper_www_root');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Bridge telemetry pollers
// ---------------------------------------------------------------------------

// Lua lifecycle/crash events written by log_event() in mcp_bridge.lua.
const BRIDGE_EVENTS: Record<string, { level: LogLevel; body: string }> = {
  bridge_start: { level: 'info', body: 'Lua bridge started in REAPER' },
  bridge_stop: { level: 'warn', body: 'Lua bridge stopped — commands will time out until it is restarted' },
  handler_error: { level: 'error', body: 'Lua bridge handler crashed' },
  handler_unknown: { level: 'error', body: 'Lua bridge received an unknown command type' },
};

// Lua payload keys → semconv / `reaper.*` attribute names. `null` drops the key:
// bridgeDir is an absolute path containing the OS username (PII, no triage value).
const BRIDGE_EVENT_ATTRIBUTES: Record<string, string | null> = {
  commandType: 'rpc.method',
  commandId: 'reaper.bridge.command.id',
  error: 'exception.message',
  reaperVersion: 'reaper.version',
  bridgeDir: null,
};

/**
 * Read and consume bridge events from the JSONL log file.
 * Emits each as an OTel log event `reaper.bridge.{type}` (plus stderr),
 * timestamped with the time Lua recorded it rather than when it was read.
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
  await writeFile(eventsPath, '', 'utf-8').catch((err: unknown) => {
    emitLog('warn', 'Could not truncate bridge event log; events may be re-reported', exceptionAttributes(err));
  });

  const lines = content.split('\n').filter((l) => l.trim() !== '');
  for (const line of lines) {
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // partial line from a concurrent Lua write
    }
    const { type, ts, ...payload } = evt;
    const eventType = typeof type === 'string' ? type : 'unknown';
    const known = BRIDGE_EVENTS[eventType] ?? { level: 'info' as const, body: `Lua bridge event ${eventType}` };
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      const name = key in BRIDGE_EVENT_ATTRIBUTES ? BRIDGE_EVENT_ATTRIBUTES[key] : `reaper.bridge.${key}`;
      if (name) attributes[name] = value;
    }
    if (eventType === 'handler_error') attributes['error.type'] = 'handler_crash';
    if (eventType === 'handler_unknown') attributes['error.type'] = 'unknown_command';
    emitLog(known.level, known.body, attributes, {
      eventName: `reaper.bridge.${eventType}`,
      timestampMs: typeof ts === 'number' ? ts : undefined,
    });
  }
}

let _diagnosticsTimer: ReturnType<typeof setInterval> | null = null;
let _eventsTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Fetch bridge diagnostics once and update the OTel gauge state. Skipped while
 * the heartbeat is stale — `reaper.bridge.up` already reports that, and a
 * timeout every interval would only be noise.
 */
export async function pollBridgeDiagnostics(): Promise<void> {
  if (!(await isBridgeRunning())) return;
  await getTracer().startActiveSpan('poll bridge diagnostics', { kind: SpanKind.INTERNAL }, async (span) => {
    try {
      const res = await sendCommand('_bridge_diagnostics' as CommandType, {}, 5_000);
      if (!res.success) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: redactHome(res.error ?? 'diagnostics failed') });
        return;
      }
      const d = (res.data ?? {}) as {
        deferIntervals?: { p50Ms: number; p95Ms: number };
        scanDurations?: { avgMs: number; maxMs: number };
      };
      if (d.deferIntervals && d.scanDurations) {
        updateBridgeDiagnostics({
          deferP50Ms: d.deferIntervals.p50Ms,
          deferP95Ms: d.deferIntervals.p95Ms,
          scanAvgMs: d.scanDurations.avgMs,
          scanMaxMs: d.scanDurations.maxMs,
        });
      }
    } finally {
      span.end();
    }
  });
}

/**
 * Periodically fetch bridge diagnostics and update OTel gauge state.
 */
export function startDiagnosticsPoller(intervalMs = 60_000): void {
  if (_diagnosticsTimer) return;
  _diagnosticsTimer = setInterval(() => {
    pollBridgeDiagnostics().catch((err: unknown) => {
      emitLog('warn', 'Bridge diagnostics poll failed', exceptionAttributes(err));
    });
  }, intervalMs);
}

/**
 * Periodically read bridge event log for crash detection / lifecycle events.
 */
export function startEventsPoller(intervalMs = 30_000): void {
  if (_eventsTimer) return;
  // Read once at startup
  const read = () =>
    readBridgeEvents().catch((err: unknown) => {
      emitLog('warn', 'Reading the bridge event log failed', exceptionAttributes(err));
    });
  void read(); // once at startup — picks up events from before the server started
  _eventsTimer = setInterval(read, intervalMs);
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
