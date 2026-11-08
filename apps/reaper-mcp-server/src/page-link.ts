import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Links to the bridge status page for the writes one tool call made.
 *
 * The bridge answers every successful write with `_page`, the URL of that command's entry on the status page
 * (its before/after view, at the port REAPER serves the page on). `sendCommand()` notes it here and the tool
 * wrapper in `server.ts` adds the last one to the tool's reply, so an agent can offer "see it on the bridge page".
 */
const store = new AsyncLocalStorage<string[]>();

/** Runs one tool call, collecting the page links of the writes it makes. */
export function collectPageLinks<T>(fn: () => Promise<T>): Promise<{ result: T; links: string[] }> {
  const links: string[] = [];
  return store.run(links, async () => ({ result: await fn(), links }));
}

/** Notes the page link a bridge response carried (no-op outside a tool call). */
export function notePageLink(url: unknown): void {
  if (typeof url === 'string' && url.startsWith('http')) store.getStore()?.push(url);
}

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
}

/** The tool's reply with the last write's page link added as its own text block; unchanged on an error or no write. */
export function withPageLink<T>(result: T, links: string[]): T {
  const res = result as ToolResult | undefined;
  const last = links[links.length - 1];
  if (!last || !res || res.isError || !Array.isArray(res.content)) return result;
  return { ...res, content: [...res.content, { type: 'text', text: `Bridge page (before/after view): ${last}` }] } as T;
}
