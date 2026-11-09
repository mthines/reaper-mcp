/**
 * Things the user should hear about once per server process, such as a REAPER bridge this server just
 * updated or a newer release. Nothing else reaches them: a server started by Claude Code has no terminal,
 * and its stderr goes to a log nobody reads. So the first tool result after a notice is added carries it
 * to the agent as one extra text block, phrased for the agent to pass on, and each notice goes out once.
 */
export interface Notice {
  /** One or two plain sentences for the user, with the step that acts on it. */
  text: string;
  /** Called once the notice went out in a tool result (e.g. to remember the user was told). */
  onDelivered?: () => void;
}

/** First line of the block, so the agent tells the user rather than acting on it. */
export const NOTICE_HEADING = 'Note from reaper-mcp for the user (pass this on; it is not part of the result):';

const pending: Notice[] = [];

export function addNotice(notice: Notice): void {
  pending.push(notice);
}

/**
 * The tool result with every pending notice appended as a last text block, and the notices cleared;
 * the result unchanged when none are pending. A result without a content array keeps them pending.
 */
export function withNotices<T>(result: T): T {
  if (pending.length === 0) return result;
  const res = result as { content?: unknown[] } | undefined;
  if (!res || !Array.isArray(res.content)) return result;
  const notices = pending.splice(0);
  const text = [NOTICE_HEADING, ...notices.map((n) => `- ${n.text}`)].join('\n');
  for (const n of notices) n.onDelivered?.();
  return { ...res, content: [...res.content, { type: 'text', text }] } as T;
}
