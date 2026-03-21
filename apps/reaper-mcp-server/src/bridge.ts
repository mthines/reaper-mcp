import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
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
} from './telemetry.js';

const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

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
      const dir = await ensureBridgeDir();
      const id = randomUUID();

      // Record command ID after it's generated — keep span name low-cardinality
      span.setAttribute('mcp.command.id', id);

      const command: BridgeCommand = {
        id,
        type,
        params,
        timestamp: Date.now(),
      };

      // Write command file
      const commandPath = join(dir, `command_${id}.json`);
      await writeFile(commandPath, JSON.stringify(command, null, 2), 'utf-8');

      const traceCtx = getTraceContext();
      console.error(
        JSON.stringify({
          msg: 'bridge_command_sent',
          commandType: type,
          commandId: id,
          ...traceCtx,
        })
      );

      // Poll for response
      const responsePath = join(dir, `response_${id}.json`);
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        try {
          const data = await readFile(responsePath, 'utf-8');
          const response: BridgeResponse = JSON.parse(data);

          // Cleanup files
          await Promise.allSettled([unlink(commandPath), unlink(responsePath)]);

          const durationMs = Date.now() - startMs;
          const succeeded = response.success;

          span.setAttribute('mcp.response.success', succeeded);

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
          getCommandDurationHistogram().record(durationMs, { command_type: type });
          getCommandCounter().add(1, { command_type: type, success: String(succeeded) });

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
