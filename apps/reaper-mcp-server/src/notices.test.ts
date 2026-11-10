import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { instrumentToolHandlers } from './server.js';
import { addNotice, NOTICE_HEADING } from './notices.js';

type ToolCb = (...args: unknown[]) => Promise<unknown>;
type Result = { content: { type: string; text: string }[]; isError?: boolean };

function wrapTool(name: string, cb: ToolCb): ToolCb {
  let registered: ToolCb | undefined;
  const server = { tool: (...args: unknown[]) => { registered = args[args.length - 1] as ToolCb; } };
  instrumentToolHandlers(server as unknown as McpServer);
  server.tool(name, 'desc', {}, cb);
  return registered as ToolCb;
}

describe('notices in tool results', () => {
  it('reaches the agent once, after the result, then never again', async () => {
    const delivered = vi.fn();
    addNotice({ text: 'reaper-mcp 9.9.9 is out.', onDelivered: delivered });
    const cb = wrapTool('list_tracks', async () => ({ content: [{ type: 'text', text: '[]' }] }));

    const first = (await cb({}, {})) as Result;
    const second = (await cb({}, {})) as Result;

    expect(first.content[0].text).toBe('[]');
    expect(first.content.at(-1)?.text).toBe(`${NOTICE_HEADING}\n- reaper-mcp 9.9.9 is out.`);
    expect(second.content).toEqual([{ type: 'text', text: '[]' }]);
    expect(delivered).toHaveBeenCalledTimes(1);
  });

  it('rides on a failed call too, keeping the error first', async () => {
    addNotice({ text: 'Start or restart REAPER.' });
    const cb = wrapTool('get_project_info', async () => ({ content: [{ type: 'text', text: 'Bridge not running: …' }], isError: true }));

    const result = (await cb({}, {})) as Result;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Bridge not running: …');
    expect(result.content.at(-1)?.text).toContain('Start or restart REAPER.');
  });
});
