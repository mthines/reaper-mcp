

/** One agent connection (an MCP server process), keyed by Claude Code session id. */
export interface Session {
  id: string;
  /** Project directory the agent runs in */
  dir?: string;
  /** MCP client name, e.g. "claude-code" */
  client?: string;
  first: number;
  last: number;
  commands: number;
  errors: number;
  /** Set when the server said goodbye */
  ended?: boolean;
  /** Display name made unique by labelSessions (page-side, not sent by the bridge) */
  label?: string;
}

/** Sessions ping every 20s; two missed pings (or a goodbye) means the agent is gone. */
export function isConnected(session: Session, now: number): boolean {
  return !session.ended && now - session.last < 45_000;
}

/** An agent that has only pinged (connected, no tool calls yet) is noise next to the ones working. */
export function hasToolCalls(session: Pick<Session, 'commands'>): boolean {
  return session.commands > 0;
}

const pathParts = (dir: string | undefined) => (dir ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);

/** "song-a" from "/work/song-a" (or its unique label), falling back to a short id. */
export function sessionName(session: Pick<Session, 'id' | 'dir' | 'label'>): string {
  return session.label || pathParts(session.dir).pop() || session.id.replace(/^pid-/, 'pid ').slice(0, 8);
}

/**
 * Give every session a distinct label: the folder name, then parent/folder when two folders share a
 * name, then "#1", "#2" (by start time) for agents running in the same folder.
 */
export function labelSessions(sessions: Session[]): Session[] {
  const base = (x: Session) => sessionName({ id: x.id, dir: x.dir });
  const labels = new Map(sessions.map((x) => [x.id, base(x)]));
  const groups = (fn: (x: Session) => string) => {
    const by = new Map<string, Session[]>();
    for (const x of sessions) by.set(fn(x), [...(by.get(fn(x)) ?? []), x]);
    return [...by.values()].filter((g) => g.length > 1);
  };
  for (const group of groups((x) => labels.get(x.id) as string)) {
    for (const x of group) {
      const parts = pathParts(x.dir);
      if (new Set(group.map((y) => y.dir)).size > 1 && parts.length > 1) labels.set(x.id, parts.slice(-2).join('/'));
    }
  }
  for (const group of groups((x) => labels.get(x.id) as string)) {
    [...group].sort((a, b) => a.first - b.first).forEach((x, i) => labels.set(x.id, `${labels.get(x.id)} #${i + 1}`));
  }
  return sessions.map((x) => ({ ...x, label: labels.get(x.id) }));
}

/** Stable color slot (0-5) per session so its dot keeps its color across reloads. */
export function sessionHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 6;
}
