import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerItemTools } from './items.js';
import { registerFxHousekeepingTools } from './fx-housekeeping.js';
import { TOOL_CATEGORIES } from './categories.js';
import { MCP_TOOL_NAMES } from '../cli.js';

const mockedSendCommand = vi.mocked(sendCommand);
type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function captureTools() {
  const tools: Record<string, { schema: Record<string, z.ZodType>; handler: Handler }> = {};
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, schema: Record<string, z.ZodType>, handler: Handler) => {
      tools[name] = { schema, handler };
    }),
  } as unknown as McpServer;
  registerItemTools(mockServer);
  registerFxHousekeepingTools(mockServer);
  return tools;
}

const TAKES = [
  'insert_audio_file', 'list_takes', 'set_active_take', 'get_take_fx', 'add_take_fx', 'remove_take_fx',
  'set_take_fx_parameter', 'get_item_appearance', 'set_item_color', 'set_item_fades',
];
const FX_FILES = [
  'move_fx', 'copy_fx', 'rename_fx', 'save_fx_chain', 'load_fx_chain', 'list_fx_chains',
  'save_track_template', 'insert_track_template', 'list_track_templates',
];

async function call(name: string, raw: Record<string, unknown>) {
  const tools = captureTools();
  const args = z.object(tools[name].schema).parse(raw);
  return tools[name].handler(args);
}

describe('items and FX housekeeping tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendCommand.mockResolvedValue({ id: 't', success: true, data: { ok: true }, timestamp: 0 });
  });

  it('items tools: registered, allow-listed and categorized', () => {
    const tools = captureTools();
    expect(Object.keys(tools).sort()).toEqual([...TAKES, ...FX_FILES].sort());
    for (const name of [...TAKES, ...FX_FILES]) {
      expect(MCP_TOOL_NAMES as readonly string[]).toContain(name);
    }
    expect(TOOL_CATEGORIES.takes.tools).toEqual(TAKES);
    expect(TOOL_CATEGORIES.fx_files.tools).toEqual(FX_FILES);
  });

  it('insert_audio_file coerces numbers and passes the path through', async () => {
    await call('insert_audio_file', { trackIndex: '2', filePath: '/a/b.wav', position: '1.5' });
    expect(mockedSendCommand).toHaveBeenCalledWith('insert_audio_file', { trackIndex: 2, filePath: '/a/b.wav', position: 1.5 });
  });

  it('take tools address a take and default to the active one', async () => {
    await call('set_take_fx_parameter', { trackIndex: 0, itemIndex: '1', fxIndex: '0', paramIndex: '3', value: '0.5' });
    expect(mockedSendCommand).toHaveBeenCalledWith('set_take_fx_parameter', {
      trackIndex: 0, itemIndex: 1, fxIndex: 0, paramIndex: 3, value: 0.5,
    });
    await call('set_active_take', { trackIndex: 0, itemIndex: 0, takeIndex: '2' });
    expect(mockedSendCommand).toHaveBeenLastCalledWith('set_active_take', { trackIndex: 0, itemIndex: 0, takeIndex: 2 });
  });

  it('set_item_fades validates shapes and curves', async () => {
    const tools = captureTools();
    const schema = z.object(tools['set_item_fades'].schema);
    expect(() => schema.parse({ trackIndex: 0, itemIndex: 0, fadeInShape: 7 })).toThrow();
    expect(() => schema.parse({ trackIndex: 0, itemIndex: 0, fadeOutCurve: 2 })).toThrow();
    await call('set_item_fades', { trackIndex: 0, itemIndex: 0, fadeInLength: '0.25', fadeInShape: '5' });
    expect(mockedSendCommand).toHaveBeenCalledWith('set_item_fades', { trackIndex: 0, itemIndex: 0, fadeInLength: 0.25, fadeInShape: 5 });
  });

  it('fx file tools pass names, modes and flags through', async () => {
    await call('load_fx_chain', { trackIndex: 1, name: 'Vocals/Lead', mode: 'replace' });
    expect(mockedSendCommand).toHaveBeenCalledWith('load_fx_chain', { trackIndex: 1, name: 'Vocals/Lead', mode: 'replace' });
    await call('save_track_template', { trackIndex: 0, name: 'Bass', includeItems: true });
    expect(mockedSendCommand).toHaveBeenLastCalledWith('save_track_template', { trackIndex: 0, name: 'Bass', includeItems: true });
    await call('move_fx', { trackIndex: 0, fxIndex: '2', toTrackIndex: '1', toIndex: '0' });
    expect(mockedSendCommand).toHaveBeenLastCalledWith('move_fx', { trackIndex: 0, fxIndex: 2, toTrackIndex: 1, toIndex: 0 });
    const tools = captureTools();
    expect(() => z.object(tools['load_fx_chain'].schema).parse({ trackIndex: 0, name: 'x', mode: 'merge' })).toThrow();
  });

  it('a bridge refusal comes back as an error', async () => {
    mockedSendCommand.mockResolvedValue({ id: 't', success: false, error: "'../x' is outside REAPER's FXChains folder", timestamp: 0 });
    const res = await call('save_fx_chain', { trackIndex: 0, name: '../x' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('outside');
  });
});
