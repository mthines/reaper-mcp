import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

vi.mock('../bridge.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../bridge.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PlanOp } from '@reaper-mcp/protocol';
import { registerActionTools } from './actions.js';
import { registerSelectionTools } from './selection.js';
import { runPlanShape, validatePlanRefs } from './plan.js';
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
  registerActionTools(mockServer);
  registerSelectionTools(mockServer);
  return tools;
}

const NEW_TOOLS = ['search_actions', 'get_action', 'run_action', 'set_selected_tracks', 'set_selected_items'];

describe('actions tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendCommand.mockResolvedValue({ id: 't', success: true, data: { ok: true }, timestamp: 0 });
  });

  it('actions tools: registered, allow-listed and categorized', () => {
    const tools = captureTools();
    for (const name of NEW_TOOLS) {
      expect(tools[name], name).toBeDefined();
      expect(MCP_TOOL_NAMES as readonly string[]).toContain(name);
    }
    expect(TOOL_CATEGORIES.actions.tools).toEqual(['search_actions', 'get_action', 'run_action']);
    expect(TOOL_CATEGORIES.selection.tools).toEqual(expect.arrayContaining(['set_selected_tracks', 'set_selected_items']));
  });

  it('search_actions passes query, section and limit through', async () => {
    const tools = captureTools();
    const args = z.object(tools['search_actions'].schema).parse({ query: 'track insert', section: 'main', limit: '5' });
    await tools['search_actions'].handler(args);
    expect(mockedSendCommand).toHaveBeenCalledWith('search_actions', { query: 'track insert', section: 'main', limit: 5 });
  });

  it('run_action keeps a numeric id a number and a named id a string', async () => {
    const tools = captureTools();
    const schema = z.object(tools['run_action'].schema);
    expect(schema.parse({ action: 40001 }).action).toBe(40001);
    expect(schema.parse({ action: '_SWS_UNSELALL' }).action).toBe('_SWS_UNSELALL');
    expect(() => schema.parse({ action: 40001, section: 'inline' })).toThrow();
    expect(() => schema.parse({ action: 40001, allowDialog: 'yes' })).toThrow();
    await tools['run_action'].handler({ action: 40022, allowDialog: true });
    expect(mockedSendCommand).toHaveBeenCalledWith('run_action', { action: 40022, section: undefined, allowDialog: true });
  });

  it('run_action propagates a refusal as an error', async () => {
    mockedSendCommand.mockResolvedValue({ id: 't', success: false, error: "refused: 'File: Quit' would close…", timestamp: 0 });
    const tools = captureTools();
    const res = await tools['run_action'].handler({ action: 40004 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('refused');
  });

  it('selection setters send their lists as JSON strings', async () => {
    const tools = captureTools();
    await tools['set_selected_tracks'].handler({ tracks: ['Kick', 3], mode: 'add' });
    expect(mockedSendCommand).toHaveBeenCalledWith('set_selected_tracks', { tracks: '["Kick",3]', mode: 'add' });
    const items = z.object(tools['set_selected_items'].schema).parse({ items: [{ trackIndex: '1', itemIndex: 0 }] });
    await tools['set_selected_items'].handler(items);
    expect(mockedSendCommand).toHaveBeenCalledWith('set_selected_items', { items: '[{"trackIndex":1,"itemIndex":0}]', mode: undefined });
    expect(() => z.object(tools['set_selected_tracks'].schema).parse({ tracks: [] })).toThrow();
  });

  it('run_plan accepts select_tracks and run_action ops and checks their refs', () => {
    const ops = z.object(runPlanShape).parse({
      ops: [
        { op: 'add_track', name: 'Temp', as: '$t' },
        { op: 'select_tracks', tracks: ['$t', 'Old'], mode: 'replace' },
        { op: 'run_action', action: 40005 },
      ],
    }).ops as PlanOp[];
    expect(validatePlanRefs(ops)).toEqual([]);
    expect(validatePlanRefs([{ op: 'select_tracks', tracks: ['$later'] }])).toEqual([
      'op 0 (select_tracks): tracks[0] $later is not defined by an earlier op',
    ]);
  });
});
