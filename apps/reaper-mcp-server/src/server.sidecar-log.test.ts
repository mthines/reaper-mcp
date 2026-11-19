import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const logged: Record<string, unknown>[] = [];

vi.mock('./bridge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bridge.js')>()),
  sendCommand: vi.fn(async (type: string, params: Record<string, unknown>) => {
    if (type === '_log_result') logged.push(params);
    return { success: true, data: {} };
  }),
}));

const { instrumentToolHandlers } = await import('./server.js');
const { logToolResult } = await import('./tool-log.js');
const { sidecarNotInstalledMessage } = await import('./sidecar-hint.js');

type ToolCb = (...args: unknown[]) => Promise<unknown>;

function wrapTool(name: string, cb: ToolCb): ToolCb {
  let registered: ToolCb | undefined;
  const server = { tool: (...args: unknown[]) => { registered = args[args.length - 1] as ToolCb; } };
  instrumentToolHandlers(server as unknown as McpServer);
  server.tool(name, 'desc', {}, cb);
  return registered as ToolCb;
}

const fail = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('a tool that fails for a missing sidecar, as the bridge page hears of it', () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it('logs one line that carries the install command of the part the tool needs', async () => {
    const stems = wrapTool('separate_stems', async () => fail('Stem separation is not installed. Run: reaper-mcp setup-sidecar --with-separation (Demucs, ~110 MB)'));
    await stems({}, {});
    await flush();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ command: 'separate_stems', ok: 0 });
    expect(String(logged[0].e)).toContain('reaper-mcp setup-sidecar --with-separation');
  });

  it('logs the plain command when the whole sidecar is missing', async () => {
    const offline = wrapTool('analyze_track_offline', async () => fail(sidecarNotInstalledMessage()));
    await offline({}, {});
    await flush();
    expect(logged).toHaveLength(1);
    expect(String(logged[0].e)).toMatch(/not installed.*reaper-mcp setup-sidecar$/);
  });

  it('adds nothing when the tool already put its own failure on the page', async () => {
    const chords = wrapTool('detect_chords', async () => {
      const message = 'Audio chord detection needs the Python sidecar. Run: reaper-mcp setup-sidecar --with-chords';
      logToolResult('detect_chords', {}, Date.now(), null, message);
      return fail(message);
    });
    await chords({}, {});
    await flush();
    expect(logged).toHaveLength(1);
    expect(String(logged[0].e)).toContain('--with-chords');
  });

  it('says nothing about an ordinary refused request', async () => {
    const add = wrapTool('add_fx', async () => fail('Error: Track 9 not found'));
    await add({}, {});
    await flush();
    expect(logged).toHaveLength(0);
  });
});
