import { isBridgeRunning, sendCommand } from './bridge.js';

/**
 * Which agent session this server process belongs to. Claude Code spawns one MCP server per
 * session and passes CLAUDE_CODE_SESSION_ID / CLAUDE_PROJECT_DIR in its environment, so every
 * command can be tagged without any hook. Other clients fall back to the process id and cwd.
 */
export interface SessionInfo {
  id: string;
  dir: string;
  client: string;
}

const session: SessionInfo = {
  id: process.env['CLAUDE_CODE_SESSION_ID'] || `pid-${process.pid}`,
  dir: process.env['CLAUDE_PROJECT_DIR'] || process.cwd(),
  client: process.env['CLAUDECODE'] === '1' ? 'claude-code' : '',
};

export function getSessionInfo(): SessionInfo {
  return session;
}

/** Record the MCP client's name once the initialize handshake has told us. */
export function setSessionClient(name: string | undefined): void {
  if (name) session.client = name;
}

const SESSION_PING_MS = 20_000;
let pingTimer: ReturnType<typeof setInterval> | null = null;

async function ping(ended = false): Promise<void> {
  // Skip while the bridge is down so pings never pile up as stale command files
  if (!(await isBridgeRunning())) return;
  await sendCommand('_session' as Parameters<typeof sendCommand>[0], ended ? { ended: 1 } : {}, ended ? 1_000 : 5_000);
}

/** Announce this session to the bridge now and every 20s, so the status page can show who's connected. */
export function startSessionPing(): void {
  if (pingTimer) return;
  const pingQuietly = () => ping().catch(() => { /* best-effort: the page just shows the session as idle */ });
  pingQuietly();
  pingTimer = setInterval(pingQuietly, SESSION_PING_MS);
  pingTimer.unref();
}

/** Best-effort goodbye so the page marks the session disconnected right away. */
export async function endSession(): Promise<void> {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  await ping(true).catch(() => { /* best-effort: exiting anyway */ });
}
