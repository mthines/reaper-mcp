import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { instrumentToolHandlers } from './server.js';
import { notePageLink } from './page-link.js';

type Reply = { isError?: boolean; content: { type: string; text: string }[] };

/** A tool, through the server's wrapper, whose handler stands in for sendCommand(): it notes the given links, then replies. */
function tool(links: string[], reply: Reply): () => Promise<Reply> {
  let registered: ((...a: unknown[]) => Promise<Reply>) | undefined;
  const server = { tool: (...args: unknown[]) => { registered = args[args.length - 1] as typeof registered; } };
  instrumentToolHandlers(server as unknown as McpServer);
  server.tool('demo', 'desc', {}, async () => {
    for (const l of links) notePageLink(l);
    return reply;
  });
  return () => (registered as NonNullable<typeof registered>)({}, {});
}

const OK: Reply = { content: [{ type: 'text', text: '{"ok":true}' }] };
const page = (n: number) => `http://localhost:8099/mcp_bridge.html?view=calls&entry=${n}`;

describe('bridge page link in tool replies', () => {
  it("adds the last write's page link after the tool's own reply", async () => {
    const res = await tool([page(1), page(2)], OK)();
    expect(res.content[0].text).toBe('{"ok":true}');
    expect(res.content[1].text).toBe(`Bridge page (before/after view): ${page(2)}`);
  });

  it('leaves a reply with no write, or an error, unchanged', async () => {
    expect((await tool([], OK)()).content).toEqual(OK.content);
    const err: Reply = { isError: true, content: [{ type: 'text', text: 'Error: nope' }] };
    expect((await tool([page(3)], err)()).content).toEqual(err.content);
  });

  it("never carries one call's link into another", async () => {
    await tool([page(4)], OK)();
    notePageLink(page(5)); // outside any tool call: dropped
    expect((await tool([], OK)()).content).toEqual(OK.content);
  });
});
