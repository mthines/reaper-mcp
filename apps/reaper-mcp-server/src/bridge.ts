import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { BridgeCommand, CommandType } from '@reaper-mcp/protocol';
import type { BridgeResponse } from '@reaper-mcp/protocol';

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
 */
export async function sendCommand(
  type: CommandType,
  params: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<BridgeResponse> {
  const dir = await ensureBridgeDir();
  const id = randomUUID();

  const command: BridgeCommand = {
    id,
    type,
    params,
    timestamp: Date.now(),
  };

  // Write command file
  const commandPath = join(dir, `command_${id}.json`);
  await writeFile(commandPath, JSON.stringify(command, null, 2), 'utf-8');

  // Poll for response
  const responsePath = join(dir, `response_${id}.json`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const data = await readFile(responsePath, 'utf-8');
      const response: BridgeResponse = JSON.parse(data);

      // Cleanup files
      await Promise.allSettled([unlink(commandPath), unlink(responsePath)]);

      return response;
    } catch {
      // File doesn't exist yet — keep polling
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // Timeout — cleanup command file
  await unlink(commandPath).catch(() => { /* cleanup best-effort */ });

  return {
    id,
    success: false,
    error: `Timeout: no response from REAPER Lua bridge after ${timeoutMs}ms. Is the bridge script running in REAPER?`,
    timestamp: Date.now(),
  };
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
