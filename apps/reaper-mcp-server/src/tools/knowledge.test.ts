import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerKnowledgeTools, clearKnowledgeCache, BUILTIN_SCOPE } from './knowledge.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function captureTools() {
  const tools: Record<string, Handler> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: Handler) => {
      tools[name] = handler;
    }),
  } as unknown as McpServer;
  registerKnowledgeTools(mockServer);
  return tools;
}

/** A LoreKit JSON-RPC success whose tool payload is `payload`. */
function rpc(payload: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }));
}

const fetchMock = vi.fn();

describe('knowledge tools', () => {
  let tools: Record<string, Handler>;

  beforeEach(() => {
    clearKnowledgeCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('REAPER_MCP_LOREKIT_TOKEN', 'lk_ro_test');
    tools = captureTools();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('lists summaries and drops rows that are not built-in', async () => {
    fetchMock.mockResolvedValue(rpc({ entries: [
      { key: 'plugins::fabfilter/pro-q-3', tags: ['plugin-knowledge', 'layer::built-in'], preview: 'EQ' },
      { key: 'user::plugins::fabfilter/pro-q-3', tags: ['plugin-knowledge', 'layer::user'], preview: 'mine' },
      { key: 'plugins::x/y', tags: ['plugin-knowledge'], preview: 'untagged' },
    ] }));

    const res = await tools['list_builtin_knowledge']({ kind: 'plugins', tags: ['category::eq'] });
    const body = JSON.parse(res.content[0].text);
    expect(body.entries.map((e: { key: string }) => e.key)).toEqual(['plugins::fabfilter/pro-q-3']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/functions/v1/mcp');
    expect(init.headers.Authorization).toBe('Bearer lk_ro_test');
    const sent = JSON.parse(init.body);
    expect(sent.params).toEqual({ name: 'memory.list', arguments: { scope: BUILTIN_SCOPE, tags: ['category::eq'], view: 'summary', limit: 50 } });
  });

  it('searches with the built-in tag AND-ed in', async () => {
    fetchMock.mockResolvedValue(rpc({ entries: [{ key: 'mixing-lessons::a', value: 'body', tags: ['layer::built-in'] }] }));
    const res = await tools['list_builtin_knowledge']({ query: 'drum bus', kind: 'lessons' });
    expect(JSON.parse(res.content[0].text).entries[0].value).toBe('body');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.params.arguments).toEqual({ q: 'drum bus', scopes: [BUILTIN_SCOPE], tags: ['layer::built-in', 'loop::mixing-lessons'], limit: 5 });
  });

  it('reads one record and caches it', async () => {
    fetchMock.mockImplementation(async () => rpc({ value: '# Pro-Q 3', updated_at: 't' }));
    await tools['get_builtin_knowledge']({ key: 'plugins::fabfilter/pro-q-3' });
    const res = await tools['get_builtin_knowledge']({ key: 'plugins::fabfilter/pro-q-3' });
    expect(JSON.parse(res.content[0].text).record.value).toBe('# Pro-Q 3');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses user:: keys without calling LoreKit', async () => {
    const res = await tools['get_builtin_knowledge']({ key: 'user::plugins::a/b' });
    expect(res.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a token that is not read-only', async () => {
    vi.stubEnv('REAPER_MCP_LOREKIT_TOKEN', 'lk_rw_oops');
    const res = await tools['get_builtin_knowledge']({ key: 'plugins::a/b' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('lk_ro_');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing token clearly', async () => {
    vi.stubEnv('REAPER_MCP_LOREKIT_TOKEN', '');
    const res = await tools['list_builtin_knowledge']({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not configured');
  });

  it('surfaces LoreKit tool errors', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'scope denied' }] } })));
    const res = await tools['list_builtin_knowledge']({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('scope denied');
  });
});
