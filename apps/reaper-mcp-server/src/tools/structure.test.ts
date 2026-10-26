import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStructureTools, registerRoutingSetters } from './structure.js';

const mockedSendCommand = vi.mocked(sendCommand);

type Tool = { schema: z.ZodObject; handler: (args: Record<string, unknown>) => Promise<unknown> };

function captureTools() {
  const tools: Record<string, Tool> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, shape: z.ZodRawShape, handler: Tool['handler']) => {
      tools[name] = { schema: z.object(shape), handler };
    }),
  } as unknown as McpServer;
  registerStructureTools(mockServer);
  registerRoutingSetters(mockServer);
  return tools;
}

const ok = (data: unknown) => ({ id: 't', success: true, data, timestamp: Date.now() });

/** Parse like the MCP SDK does, then call the handler. */
async function call(tool: Tool, args: Record<string, unknown>) {
  return tool.handler(tool.schema.parse(args));
}

describe('structure + routing setter tools', () => {
  let tools: Record<string, Tool>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = captureTools();
  });

  it('registers all 10 tools', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'add_hardware_output', 'add_send', 'add_track', 'delete_track', 'move_track',
      'remove_send', 'set_send', 'set_track_folder', 'set_track_group', 'set_track_info',
    ]);
  });

  it.each([
    ['add_track', { name: 'Vox', index: '2' }, { name: 'Vox', index: 2 }],
    ['delete_track', { track: 'Old Gtr' }, { track: 'Old Gtr' }],
    ['move_track', { track: 3, toIndex: '0' }, { track: 3, toIndex: 0 }],
    ['set_track_folder', { track: 'Drums', mode: 'folder', collapsed: '2' }, { track: 'Drums', mode: 'folder', collapsed: 2 }],
    ['set_track_info', { track: 'master', color: '#FF8000' }, { track: 'master', color: '#FF8000' }],
    ['add_send', { from: 'Kick', to: 'Bass', mode: 'pre-fx', destChannel: '3', volume: '-6' },
      { from: 'Kick', to: 'Bass', mode: 'pre-fx', destChannel: 3, volume: -6 }],
    ['add_hardware_output', { track: 0, outputChannel: '3', mono: true }, { track: 0, outputChannel: 3, mono: true }],
    ['set_send', { track: 'Bus', category: 'receive', index: '0', pan: '0.5' },
      { track: 'Bus', category: 'receive', index: 0, pan: 0.5 }],
    ['remove_send', { track: 'Kick', index: 1 }, { track: 'Kick', index: 1 }],
  ])('%s dispatches its coerced params', async (name, args, sent) => {
    mockedSendCommand.mockResolvedValue(ok({ done: true }));
    const result = await call(tools[name], args);
    expect(mockedSendCommand).toHaveBeenCalledWith(name, sent);
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ done: true }, null, 2) }] });
  });

  it('set_track_group sends roles as a JSON string', async () => {
    mockedSendCommand.mockResolvedValue(ok({ roles: ['vca_follow'] }));
    await call(tools['set_track_group'], { track: 'Snare', group: '1', roles: ['vca_follow'], enable: false });
    expect(mockedSendCommand).toHaveBeenCalledWith('set_track_group', {
      track: 'Snare', group: 1, roles: '["vca_follow"]', enable: false,
    });
  });

  it('rejects invalid input before reaching the bridge', () => {
    expect(tools['add_send'].schema.safeParse({ from: 'Kick', to: 'Bus', pan: 2 }).success).toBe(false);
    expect(tools['add_send'].schema.safeParse({ from: 'Kick', to: 'Bus', mode: 'pre-fader' }).success).toBe(false);
    expect(tools['set_track_info'].schema.safeParse({ track: 0, channels: 1 }).success).toBe(false);
    expect(tools['set_track_group'].schema.safeParse({ track: 0, group: 65, roles: ['vca_lead'] }).success).toBe(false);
    expect(tools['delete_track'].schema.safeParse({ track: -2 }).success).toBe(false);
    expect(tools['delete_track'].schema.safeParse({ track: '' }).success).toBe(false);
  });

  it('propagates bridge errors', async () => {
    mockedSendCommand.mockResolvedValue({ id: 't', success: false, error: 'the master track cannot be deleted', timestamp: 0 });
    const result = await call(tools['delete_track'], { track: 'master' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'Error: the master track cannot be deleted' }], isError: true });
  });
});
